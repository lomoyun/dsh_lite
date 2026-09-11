const HEARTBEAT_MS = 15000
const MAX_BUFFER_BYTES = 1024 * 1024

// 与原 JSON 请求共用执行入口；断连只停止传输，正在进行的 Agent 继续完成并保存。
export async function respondRun({ request, response, execute, json, fail }) {
  if (!request.headers.accept?.includes('text/event-stream')) return json(response, 200, await execute())
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' })
  response.flushHeaders()
  const send = (event) => {
    if (response.destroyed || response.writableEnded) return
    if (response.writableLength > MAX_BUFFER_BYTES) { response.destroy(); return }
    response.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const timer = setInterval(() => send({ type: 'heartbeat' }), HEARTBEAT_MS)
  try { send({ type: 'done', data: await execute(send) }) }
  catch (error) { send({ type: 'error', ...fail(error) }) }
  finally { clearInterval(timer); response.end() }
}
