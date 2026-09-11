export async function reveal(locator) {
  await locator.waitFor({ state: 'attached' })
  for (const details of await locator.locator('xpath=ancestor::details').all()) {
    if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click()
  }
}
export async function navigate(page, label) {
  const main = { '客户需求': '需求', '计算工况': '计算', '工况与结构': '计算', '工程核对': '计算', '参数准备': '计算', '候选比较': '部件', '型号确认': '部件', '输入核对': '部件', '计算结果': '结果' }[label] ?? label
  const pane = page.locator('#detail-drawer .detail-entry:not([hidden]) .mche-view')
  await pane.getByRole('button', { name: main, exact: true }).click()
  const sub = { '计算工况': '工况与结构', '输入核对': '选型条件' }[label] ?? label
  if (!['客户需求', '计算结果', '需求', '部件', '计算', '结果'].includes(label)) await pane.getByRole('button', { name: sub, exact: true }).click()
  await pane.locator(':scope > [role="status"]').filter({ hasText: '已更新。' }).waitFor()
}
export async function confirmRequirements(page) {
  await page.getByRole('button', { name: '核对并确认', exact: true }).click()
  await page.getByRole('button', { name: '确认需求并应用当前工况草稿', exact: true }).click()
}
