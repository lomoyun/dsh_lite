import { pathToFileURL } from 'node:url'
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { reveal, navigate } from './mche-browser-helpers.mjs'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'
const { chromium } = await import(pathToFileURL(process.argv[2] ?? 'C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const out=resolve('docs/verification/evidence/flow-topology'),cleanup=[],errors=[],checks=[]
await mkdir(out,{recursive:true})
const f=await nativeFixture({after:fn=>cleanup.push(fn)},false,{respond:()=>({delta:{role:'assistant',content:'流向结构浏览器验收会话'},finishReason:'stop'})})
let browser,context,page
const checked=(name)=>{checks.push(name);console.log(name)}
try {
  const {sessionId}=await post(f,'/api/chat',{prompt:'流向结构验收'})
  browser=await chromium.launch({headless:true,executablePath:process.env.MCHE_BROWSER_EXECUTABLE??'C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'})
  context=await browser.newContext({viewport:{width:1440,height:1050},recordVideo:{dir:out,size:{width:1440,height:1050}}})
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
  await page.goto(f.base);await page.waitForLoadState('networkidle')
  await page.getByRole('button',{name:'流向结构验收',exact:true}).click()
  await page.getByRole('button',{name:'MCHE 方案',exact:true}).click()
  await navigate(page, '计算工况')
  const flow=page.locator('.mche-flow')
  await flow.waitFor()
  assert.equal(await page.getByLabel('第1排流程1管数',{exact:true}).inputValue(),'')
  checked('新方案单排单流程，管数和方向不预填')
  const responseTo=async(path,action)=>{
    const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/mche/'+path)&&r.request().method()==='POST'),action()])
    const data=await response.json();assert.equal(response.status(),200,JSON.stringify(data));return data
  }
  async function save(){return responseTo('calculation-draft',()=>page.getByRole('button',{name:'保存计算草稿',exact:true}).click())}
  async function fillPass(r,p,n,d){await page.getByLabel(`第${r}排流程${p}管数`,{exact:true}).fill(String(n));await page.getByLabel(`第${r}排流程${p}方向`,{exact:true}).selectOption(d)}
  async function scrollScene(){await flow.locator('.flow-toolbar').scrollIntoViewIfNeeded();await page.waitForTimeout(150)}
  async function expandRows() {
    if (!await flow.evaluate(n => n.classList.contains('flow-enlarged'))) await flow.getByRole('button', { name: '放大查看', exact: true }).click()
    const button = flow.getByRole('button', { name: '展开各排', exact: true })
    if (await button.count()) await button.click()
  }
  await page.getByLabel('第1排流程数',{exact:true}).selectOption('2')
  await fillPass(1,1,43,'left');await fillPass(1,2,20,'right')
  await page.getByLabel('结构来源依据',{exact:true}).fill('浏览器合成夹具；2Pass管数来自原软件样例，非用户工程确认')
  await page.getByLabel('空气流向',{exact:true}).selectOption('left_to_right')
  await reveal(page.getByLabel('空气流向依据',{exact:true}))
  await page.getByLabel('空气流向依据',{exact:true}).fill('浏览器方向验收')
  assert.match(await flow.innerText(),/未保存/)
  let state=await save();assert.deepEqual(state.calculation.topologyLayout.header,[[1,43,1,0],[44,63,-1,0]])
  await scrollScene();await page.waitForTimeout(1600)
  const first=await flow.evaluate(n=>n.flowController.state.frames);await page.waitForTimeout(400)
  assert.ok(await flow.evaluate(n=>n.flowController.state.frames)>first)
  await page.screenshot({path:out+'/single-row-desktop.png'})
  const version=state.calculation.revision
  await flow.getByRole('button',{name:'暂停',exact:true}).click()
  const paused=await flow.evaluate(n=>({frames:n.flowController.state.frames,transforms:[...n.querySelectorAll('.flow-particle')].map(p=>p.getAttribute('transform'))}))
  await page.waitForTimeout(400)
  assert.deepEqual(await flow.evaluate(n=>({frames:n.flowController.state.frames,transforms:[...n.querySelectorAll('.flow-particle')].map(p=>p.getAttribute('transform'))})),paused)
  assert.ok(await flow.locator('path[marker-end]').count()>0)
  await flow.getByRole('button',{name:'播放',exact:true}).click()
  await flow.getByRole('button', { name: '放大查看', exact: true }).click()
  await page.getByLabel('播放速度',{exact:true}).selectOption('2')
  await page.getByLabel('显示空气',{exact:true}).uncheck();assert.equal(await flow.locator('.flow-air').evaluate(n=>getComputedStyle(n).visibility),'hidden')
  await page.getByLabel('显示空气',{exact:true}).check()
  const current=await post(f,'/api/mche/case',{sessionId});assert.equal(current.calculation.revision,version)
  checked('实际持续播放、暂停静止及静态箭头；速度/显隐不改变计算版本')
  await navigate(page, '工程核对')
  await page.getByRole('heading',{name:'工程核对',exact:true}).waitFor()
  state=await responseTo('calculation-confirm',()=>page.getByRole('button',{name:'确认计算输入与工程核对',exact:true}).click())
  assert.equal(state.calculation.confirmed,true)
  assert.deepEqual(state.calculation.confirmation.topology,state.calculation.topology)
  await navigate(page, '参数准备')
  await page.getByRole('heading',{name:'实际计算参数准备',exact:true}).waitFor()
  state=await responseTo('prepare',()=>page.getByRole('button',{name:'准备计算参数',exact:true}).click())
  assert.equal(state.calculation.preparation.calculationReady,false,'missing engineering inputs must not become executable')
  await navigate(page, '计算工况');await flow.waitFor()
  await page.getByLabel('排数',{exact:true}).selectOption('2')
  await page.getByLabel('第2排流程数',{exact:true}).selectOption('2')
  await fillPass(2,1,28,'right');await fillPass(2,2,12,'left')
  await flow.getByText('串联经过顺序', { exact: true }).click()
  await page.getByRole('button',{name:'跨排交替串联',exact:true}).click()
  state=await save();const top=state.calculation.topology,ids=top.rows.map(r=>r.passes.map(p=>p.id))
  assert.equal(state.calculation.confirmed,false);assert.equal(state.calculation.preparation.stale,true)
  checked('页面确认保存对应结构；缺工程输入仍阻塞；修改结构使确认和准备包失效')
  assert.deepEqual(top.order,[ids[0][0],ids[1][0],ids[0][1],ids[1][1]])
  await scrollScene();await expandRows();await page.waitForTimeout(1300)
  await page.screenshot({path:out+'/alternating-expanded-desktop.png'})
  const rendered=await flow.locator('.flow-connection').evaluateAll(nodes=>nodes.map(n=>[n.dataset.from,n.dataset.to]))
  assert.deepEqual(rendered,[['inlet',top.order[0]],...top.order.slice(1).map((id,i)=>[top.order[i],id]),[top.order.at(-1),'outlet']])
  await page.getByRole('button',{name:'选择第2排流程1',exact:true}).focus();await page.keyboard.press('Enter')
  assert.equal(await page.getByRole('button',{name:'选择第2排流程1',exact:true}).getAttribute('aria-pressed'),'true')
  await flow.locator('.flow-pass-target').first().focus();await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('flow-pass-target')),true)
  checked('不同排管数、交替顺序、绘图连边与服务端一致，键盘高亮')
  const headers=state.calculation.topologyLayout.header
  await page.getByLabel('空气流向',{exact:true}).selectOption('right_to_left');state=await save()
  assert.deepEqual(state.calculation.topologyLayout.header,headers)
  assert.match(await flow.locator('.flow-air-label').textContent(),/排 2 → 排 1/)
  await page.getByLabel('排间连接',{exact:true}).selectOption('parallel');state=await save()
  assert.equal(state.calculation.topology.connection,'parallel')
  assert.ok(state.calculation.blockers.some(b=>b.code==='dll_parallel_distribution_unverified'))
  await scrollScene();await expandRows();await page.waitForTimeout(1600)
  await page.screenshot({path:out+'/parallel-desktop.png'})
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  assert.equal(await flow.evaluate(n=>n.flowController.state.running),false)
  await page.getByRole('button',{name:'MCHE 方案',exact:true}).click();await flow.waitFor()
  assert.equal(await page.getByLabel('排间连接',{exact:true}).inputValue(),'parallel')
  await page.reload();await page.getByRole('button',{name:'流向结构验收',exact:true}).click()
  await page.getByRole('button',{name:'MCHE 方案',exact:true}).click();await navigate(page, '计算工况')
  assert.equal(await page.getByLabel('第2排流程1管数',{exact:true}).inputValue(),'28')
  checked('空气反转保留物理编号；并联明确验证阻塞；关闭暂停、刷新恢复')
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100)
  assert.equal(await flow.evaluate(n=>n.flowController.state.running),false)
  await page.screenshot({path:out+'/reduced-motion.png'})
  await page.emulateMedia({reducedMotion:'no-preference'})
  const controllers=[]
  for(let i=0;i<5;i++){
    controllers.push(await flow.evaluateHandle(n=>n.flowController))
    await navigate(page, '工程核对')
    await page.getByRole('heading',{name:'工程核对',exact:true}).waitFor()
    assert.equal(await controllers.at(-1).evaluate(c=>c.state.disposed),true)
    await navigate(page, '计算工况')
    await flow.waitFor()
  }
  checked('减少动态即时停止；连续5次切页后旧控制器全部释放')
  await page.setViewportSize({width:390,height:844});await scrollScene()
  await expandRows();await page.waitForTimeout(700)
  await page.screenshot({path:out+'/narrow-expanded.png'})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
  assert.equal(overflow,false)
  await flow.getByRole('button',{name:'收起放大',exact:true}).click()
  await flow.getByRole('button',{name:'放大查看',exact:true}).click();assert.equal(await flow.evaluate(n=>n.classList.contains('flow-enlarged')),true)
  await flow.getByRole('button',{name:'收起放大',exact:true}).click()
  await page.getByLabel('排数',{exact:true}).selectOption('5')
  for(let r=1;r<=5;r++)await page.getByLabel(`第${r}排流程数`,{exact:true}).selectOption('6')
  for(let r=1;r<=5;r++)for(let p=1;p<=6;p++)await fillPass(r,p,10,p%2?'left':'right')
  state=await save();assert.equal(state.calculation.topologyLayout.passes.length,30)
  assert.equal(await page.locator('.flow-pass-editor').count(),30)
  checked('390px窄屏无页面溢出，展开/放大可滚动，30个流程可逐一编辑核对')
  await page.getByLabel('结构来源依据',{exact:true}).scrollIntoViewIfNeeded();await page.waitForTimeout(150)
  assert.equal(await flow.evaluate(n=>n.flowController.state.running),false)
  await scrollScene();await page.waitForTimeout(700)
  const perf=await flow.evaluate(n=>n.flowController.state)
  assert.ok(perf.frames>0);assert.ok(perf.paths<=100)
  const intervals=await page.evaluate(()=>new Promise(resolve=>{const times=[];let last;function frame(t){if(last!==undefined)times.push(t-last);last=t;if(times.length===60)resolve(times);else requestAnimationFrame(frame)}requestAnimationFrame(frame)}))
  perf.frameIntervalMs={median:[...intervals].sort((a,b)=>a-b)[30],max:Math.max(...intervals),samples:60}
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  const oldController=await flow.evaluateHandle(n=>n.flowController)
  await page.locator('#new-chat').click()
  await page.locator('#prompt').fill('新会话结构隔离验收')
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await page.getByRole('button',{name:'MCHE 方案',exact:true}).click()
  await navigate(page, '计算工况')
  await flow.waitFor()
  assert.equal(await oldController.evaluate(c=>c.state.disposed),true)
  assert.equal(await page.getByLabel('排数',{exact:true}).inputValue(),'1')
  assert.equal(await page.getByLabel('第1排流程1管数',{exact:true}).inputValue(),'')
  checked('图离开可视区域停止动画；会话切换释放旧控制器且新方案无旧结构')
  assert.deepEqual(errors,[])
  const video=page.video();await context.close();context=null
  await video.saveAs(out+'/flow-playback.webm')
  await writeFile(out+'/browser.json',JSON.stringify({createdAt:new Date().toISOString(),checks,errors,viewport:{desktop:[1440,1050],narrow:[390,844]},performance:perf,video:'flow-playback.webm',synthetic:true},null,2))
} catch(e) {
  const setupErrors=[]
  for(const file of await readdir(f.home,{recursive:true})) {
    if(!/\.(jsonl|ndjson)$/.test(file))continue
    for(const line of (await readFile(resolve(f.home,file),'utf8')).split('\n')) {
      try{const event=JSON.parse(line);if(/error|turn\/end/.test(event.type??''))setupErrors.push({type:event.type,data:event.data})}catch{}
    }
  }
  if(page)await page.screenshot({path:out+'/browser-failure.png'}).catch(()=>{})
  await writeFile(out+'/browser-failure.json',JSON.stringify({message:e.message,stack:e.stack,checks,errors,setupErrors,modelRequestCount:f.received.length},null,2));throw e
} finally {if(context)await context.close();await browser?.close();for(const fn of cleanup)await fn()}
