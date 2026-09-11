import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { McheError, session } from './validation.js'

const workerPath = fileURLToPath(new URL('./worker/worker.py', import.meta.url))
export const unfinished = status => ['queued', 'running'].includes(status)
let nativeTail = Promise.resolve()
const now = () => new Date().toISOString()

// An instance owns one process only. No shell, DLL paths or positional arrays come from model arguments.
export class NativeProcess {
  constructor({ python, runtimeRoot, timeoutMs = 120000, workerFile = workerPath }) { Object.assign(this, { python, runtimeRoot, timeoutMs, workerFile }) }
  start({ runId, request, probe = false, onEvent = () => {} }) {
    let child, stopReason, killTimer, timer, closed = false
    const cancel = (reason = 'cancelled') => {
      if (closed || stopReason) return
      stopReason = reason
      if (child?.stdin.writable) child.stdin.write(JSON.stringify({ protocolVersion: 1, type: 'cancel', runId })+'\n')
      killTimer = setTimeout(() => child?.kill(), 2000)
    }
    const promise = new Promise(resolve => {
      const events = [], logs = []; let result, error, environment, buffer = '', bytes = 0
      const finish = (code, signal) => {
        if (closed) return
        closed = true; clearTimeout(timer); clearTimeout(killTimer)
        const status = stopReason ?? ((!error && (probe ? environment?.ready : environment?.ready && result?.success === true && result.rawResult?.length === 64 && result.rawResult.every(Number.isFinite))) && code === 0 ? 'succeeded' : 'failed')
        resolve({ status, result, environment, error: error ?? result?.error ?? (status === 'failed' ? `Worker exited ${code ?? signal}` : null), exitCode:code, signal, events, logs })
      }
      try { child = spawn(this.python, ['-E', '-B', '-X', 'utf8', '-u', this.workerFile], { cwd:this.runtimeRoot, windowsHide:true, stdio:['pipe','pipe','pipe'] }) }
      catch (e) { error = e.message; finish(null, null); return }
      child.on('error', e => { error = e.message; finish(null,null) })
      child.stdin.on('error', e => { error ??= e.message })
      child.on('close', finish)
      child.stderr.on('data', chunk => { if (bytes < 2*1024*1024) logs.push(chunk.toString()); bytes += chunk.length; if (bytes > 2*1024*1024) cancel('failed') })
      child.stdout.on('data', chunk => {
        bytes += chunk.length
        if (bytes > 2*1024*1024) { error='Worker output limit exceeded'; cancel('failed'); return }
        buffer += chunk.toString('utf8')
        let pos
        while ((pos = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,pos); buffer=buffer.slice(pos+1)
          try {
            const event = JSON.parse(line)
            if (event.protocolVersion !== 1 || event.runId !== runId) throw new Error('Unexpected worker event')
            events.push(event); onEvent(event)
            if (event.type === 'result') { if (result) throw new Error('Duplicate worker result'); result=event }
            if (event.type === 'environment') environment=event.environment
            if (event.type === 'error') error=event.error
          } catch (e) { error=`Invalid JSONL: ${e.message}`; logs.push(line); cancel('failed') }
        }
      })
      timer=setTimeout(() => cancel('timed_out'), probe ? Math.min(this.timeoutMs,30000) : this.timeoutMs)
      child.stdin.write(JSON.stringify({ protocolVersion:1,type:probe?'probe':'run',runId,runtimeRoot:this.runtimeRoot,...(probe?{}:{request}) })+'\n')
    })
    return { promise, cancel }
  }
  async probe() {
    const result=await this.start({runId:randomUUID(),probe:true}).promise
    return result.status === 'succeeded' ? {...result.environment,checkedAt:now()} : {ready:false,error:result.error ?? result.status,checkedAt:now()}
  }
}

export class CalculationRuns {
  constructor({ root, process }) { this.root=root; this.process=process; this.lock=Promise.resolve(); this.active=new Map(); this.closed=false; this.initialized=null }
  serial(work) { const next=this.lock.then(work); this.lock=next.catch(()=>{}); return next }
  directory(sessionId,runId) { return join(this.root,session(sessionId),session(runId)) }
  async read(sessionId,runId) {
    const dir=this.directory(sessionId,runId)
    try {
      const files=(await readdir(dir)).filter(x=>/^\d{12}\.json$/.test(x)).sort()
      const data=JSON.parse(await readFile(join(dir,files.at(-1)),'utf8'))
      if(data.sessionId!==sessionId || data.runId!==runId) throw new Error('ownership')
      return data
    } catch(e) { throw new McheError(e.code==='ENOENT'?'计算记录不存在或不属于当前会话':'计算记录无法读取',e.code==='ENOENT'?404:503) }
  }
  async save(record) {
    const dir=this.directory(record.sessionId,record.runId); await mkdir(dir,{recursive:true})
    record.revision=(record.revision??0)+1; record.updatedAt=now()
    const temp=join(dir,randomUUID()+'.tmp')
    await writeFile(temp,JSON.stringify(record),{flag:'wx',mode:0o600})
    await rename(temp,join(dir,String(record.revision).padStart(12,'0')+'.json'))
  }
  async listRaw(sessionId) {
    session(sessionId); let names
    try { names=await readdir(join(this.root,sessionId)) } catch(e) { if(e.code==='ENOENT') return []; throw e }
    const records=await Promise.all(names.filter(x=>/^[a-zA-Z0-9_-]+$/.test(x)).map(id=>this.read(sessionId,id)))
    return records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  initialize() {
    return this.initialized ??= this.serial(async()=>{
      await mkdir(this.root,{recursive:true})
      for (const dir of await readdir(this.root,{withFileTypes:true})) if(dir.isDirectory()) {
        for(const record of await this.listRaw(dir.name)) if(unfinished(record.status)) {
          record.status='interrupted'; record.finishedAt=now(); record.error='服务重启：未完成计算已中断，未自动重跑'; await this.save(record)
        }
      }
    })
  }
  async list(sessionId) { await this.initialize(); await this.lock; return this.listRaw(sessionId) }
  async enqueue(sessionId, preparation, trigger, requestId, snapshots) {
    await this.initialize()
    return this.serial(async()=>{
      if(this.closed) throw new McheError('计算服务正在关闭',503)
      const previous=await this.listRaw(sessionId)
      const retried=previous.find(r=>r.requestIds.includes(requestId))
      if(retried) {
        if(retried.preparation.id!==preparation.id) throw new McheError('触发标识已用于其他参数包',409)
        return retried
      }
      const running=previous.find(r=>unfinished(r.status)&&r.preparation.fingerprint===preparation.fingerprint)
      if(running) { running.requestIds.push(requestId); running.triggers.push(trigger); await this.save(running); return running }
      const record={schemaVersion:1,runId:randomUUID(),sessionId,status:'queued',requestIds:[requestId],triggers:[trigger],
        preparation:structuredClone(preparation),snapshots:structuredClone(snapshots),createdAt:now(),startedAt:null,finishedAt:null,result:null,error:null,logs:[]}
      await this.save(record)
      const work=nativeTail.then(()=>this.execute(sessionId,record.runId))
      nativeTail=work.catch(async(error)=>{
        await this.serial(async()=>{ const failed=await this.read(sessionId,record.runId); if(unfinished(failed.status)) {failed.status='failed';failed.error=`计算持久化或执行失败：${error.message}`;failed.finishedAt=now();await this.save(failed)} }).catch(()=>{})
      })
      return structuredClone(record)
    })
  }
  async execute(sessionId,runId) {
    let handle
    await this.serial(async()=>{
      const record=await this.read(sessionId,runId)
      if(this.closed || record.status!=='queued') return
      record.status='running';record.startedAt=now();await this.save(record)
      handle=this.process.start({runId,request:record.preparation.native})
      this.active.set(runId,handle)
    })
    if(!handle) return
    const output=await handle.promise
    await this.serial(async()=>{
      const record=await this.read(sessionId,runId)
      Object.assign(record,output,{finishedAt:now(),elapsedMs:Date.now()-Date.parse(record.startedAt)})
      if(record.cancelRequested) record.status='cancelled'
      if(record.interruptRequested) record.status='interrupted'
      await this.save(record);this.active.delete(runId)
    })
  }
  async cancel(sessionId,runId) {
    await this.initialize()
    return this.serial(async()=>{
      const record=await this.read(sessionId,runId)
      if(!unfinished(record.status)) return record
      record.cancelRequested=true;record.cancelRequestedAt=now()
      if(record.status==='queued') {record.status='cancelled';record.finishedAt=now()}
      await this.save(record);this.active.get(runId)?.cancel();return record
    })
  }
  async close() {
    await this.initialize();this.closed=true
    await this.serial(async()=>{
      for(const dir of await readdir(this.root,{withFileTypes:true})) if(dir.isDirectory()) for(const r of await this.listRaw(dir.name)) if(unfinished(r.status)) {
        r.interruptRequested=true
        if(r.status==='queued') {r.status='interrupted';r.finishedAt=now()}
        await this.save(r);this.active.get(r.runId)?.cancel('interrupted')
      }
    })
    await Promise.all([...this.active.values()].map(h=>h.promise));await this.lock
  }
}

export function runSummary(record,fingerprint) {
  return {runId:record.runId,status:record.status,createdAt:record.createdAt,startedAt:record.startedAt,finishedAt:record.finishedAt,
    elapsedMs:record.elapsedMs,historical:record.preparation.fingerprint!==fingerprint,error:record.error,
    actual:record.result?.actual ?? null,preparationId:record.preparation.id,detail:{view:'results',runId:record.runId}}
}
