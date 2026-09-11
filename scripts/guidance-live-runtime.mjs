// Isolated instance, current local model settings, no source-home writes.
import { mkdir, mkdtemp, copyFile, writeFile, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

export async function liveRuntime() {
  const root = resolve('.'), sourceHome = resolve(process.env.GUIDANCE_SOURCE_HOME || '.dsh')
  const home = await mkdtemp(join(root, '.dsh/guidance-live-'))
  await mkdir(join(home, 'profiles/lite'), { recursive: true })
  for (const name of ['settings.yaml', '.credentials.yaml', 'profiles/lite/cordis.patch.yml']) {
    try { await copyFile(join(sourceHome, name), join(home, name)) } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  const observer = join(home, 'observer.mjs'), trace = join(home, 'tools.jsonl')
  await writeFile(observer, `import { appendFileSync } from 'node:fs';
export const name = 'guidance-observer';
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    if (!['tool/call', 'tool/result'].includes(event.type)) return;
    const row = { sessionId: session.id, at: new Date().toISOString(), type: event.type };
    if (event.type === 'tool/call') row.call = event.data;
    else {
      const block = event.data.message?.content?.find(b => b.type === 'tool-result');
      row.callId = block?.toolCallId; row.failed = Boolean(block?.isError);
      const c = block?.content;
      const text = typeof c === 'string' ? c : (c ?? []).filter(b => b.type === 'text').map(b => b.text).join('');
      try { row.result = JSON.parse(text); row.failed ||= row.result.ok === false; } catch { row.text = text; }
    }
    appendFileSync(${JSON.stringify(trace)}, JSON.stringify(row) + '\\n');
  });
}
`)
  const patch = join(home, 'run.json')
  const baseline = process.env.GUIDANCE_BASELINE === '1' ? [
    { id: 'mche', disabled: true }, { id: 'lite-web-app', disabled: true },
    { insert: [
      { id: 'guidance-baseline-mche', name: pathToFileURL(join(root, '.dsh/guidance-baseline/packages/dsh-mche/src/index.js')).href, config: { home, cwd: root } },
      { id: 'guidance-baseline-web', name: pathToFileURL(join(root, '.dsh/guidance-baseline/packages/dsh-lite-web-app/src/index.js')).href, config: { cwd: root } },
    ] },
  ] : []
  await writeFile(patch, JSON.stringify([...baseline, { id: 'lite-http', config: { host: '127.0.0.1', port: 0 } },
    { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
    { insert: [{ id: 'guidance-observer', name: pathToFileURL(observer).href }] }]))
  const child = spawn(process.execPath, [join(root, 'scripts/start.mjs'), '--patch', patch], {
    cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: home, DSH_LITE_TRACE: '0' },
  })
  let output = '', base
  child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended }
    await writeFile(join(home, '.credentials.yaml'), '{}\n')
    await writeFile(join(home, 'server.log'), output)
  }
  try {
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw new Error('isolated server exited')
      base = [...output.matchAll(/DSH Lite: (http:\/\/127\.0\.0\.1:\d+)/g)].at(-1)?.[1]
      if (base && (await fetch(base + '/api/status').catch(() => null))?.ok) break
      await delay(100)
    }
    if (!base) throw new Error('isolated startup timed out')
    return { home, base, close, trace: async () => (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse) }
  } catch (e) { await close(); throw e }
}
