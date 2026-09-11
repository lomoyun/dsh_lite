export async function workbookInput(ctx, agent, files = []) {
  if (!files.length) return []
  const excel = ctx.get?.('excelUnderstanding')?.service
  if (!excel) throw new Error('Excel 理解插件未启用')
  return Promise.all(files.map(async (file) => {
    const info = await excel.inspect({ fileId: file.fileId, sessionId: agent.id })
    return { fileId: info.file.fileId, sessionId: agent.id, name: info.file.name, sha256: info.file.sha256,
      status: info.file.status, error: info.file.error,
      sheets: info.sheets.map(({ name, range, hidden }) => ({ name, range, hidden })) }
  }))
}
