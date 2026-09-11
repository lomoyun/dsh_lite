export function mountAttachmentDrop({ root, dialog, onFiles, onError, isLocked, showDrop }) {
  let depth = 0
  const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const inside = (target) => root.contains(target) || dialog.contains(target)
  const reset = () => { depth = 0; showDrop(false) }
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault(); depth++
    if (inside(event.target) && !isLocked()) showDrop(true)
  })
  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return
    depth = Math.max(0, depth - 1)
    if (!depth) reset()
  })
  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    const allowed = inside(event.target) && !isLocked()
    event.dataTransfer.dropEffect = allowed ? 'copy' : 'none'
    showDrop(allowed)
  })
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault(); reset()
    if (isLocked()) { onError('当前无法添加附件，请等待发送结束或新建可用对话'); return }
    if (!inside(event.target)) { onError('请把文件拖到对话区域或输入框中'); return }
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) { onError('未读取到文件，请选择具体文件，暂不支持文件夹'); return }
    onFiles(files)
  })
  window.addEventListener('blur', reset)
  document.addEventListener('dragend', reset)
}
