import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readObjects } from '../src/ooxml.js'
import { parseWorkbook } from '../src/parser.js'
import { overviewSheets, rangeMetadata } from '../src/overview.js'
import { bounds } from '../src/ranges.js'

test('OOXML 图片锚点、VML 勾选、控件和外部链接均显式呈现；XML 实体不执行', () => {
  const files = new Map(Object.entries({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="输入&amp;说明" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="sheet"/></Relationships>',
    'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml" Type="drawing"/><Relationship Id="rId2" Target="../drawings/vml1.vml" Type="vmlDrawing"/><Relationship Id="rId3" Target="../ctrlProps/ctrlProp1.xml" Type="ctrlProp"/><Relationship Id="rId4" Target="https://example.invalid/external" TargetMode="External" Type="hyperlink"/></Relationships>',
    'xl/drawings/drawing1.xml': '<xdr:wsDr xmlns:xdr="xdr" xmlns:a="a" xmlns:r="r"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:row>5</xdr:row></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
    'xl/drawings/_rels/drawing1.xml.rels': '<Relationships><Relationship Id="rId1" Type="image" Target="../media/image1.png"/></Relationships>',
    'xl/drawings/vml1.vml': '<xml xmlns:v="v" xmlns:x="x"><v:shape><x:ClientData ObjectType="Checkbox"><x:Row>1</x:Row><x:Column>0</x:Column><x:Checked>1</x:Checked><x:FmlaLink>Sheet1!B2</x:FmlaLink></x:ClientData></v:shape></xml>',
    'xl/ctrlProps/ctrlProp1.xml': '<formControlPr objectType="CheckBox" checked="Unchecked" fmlaLink="B3"/>',
  }).map(([path, value]) => [path, Buffer.from(value)]))
  const result = readObjects(files), objects = result.sheets.get('输入&说明')
  assert.equal('B3:D6', objects.find((item) => item.kind === 'image').anchor)
  assert.equal('xl/media/image1.png', objects[0].mediaPart)
  assert.equal(true, objects.find((item) => item.basis === 'vml').checked)
  assert.equal(false, objects.find((item) => item.basis === 'ooxml_control').checked)
  assert.equal('not_loaded', objects.find((item) => item.kind === 'external_link').status)
  files.set('xl/workbook.xml', Buffer.from('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x/>'))
  assert.throws(() => readObjects(files), /外部实体/)
})
test('超过行索引上限时明确保留未处理范围，不能把它标为空白或完整解析', () => {
  const bytes = Buffer.from(Array.from({ length: 50003 }, (_, i) => `项目,${i}`).join('\n'))
  const index = parseWorkbook({ name: '大表.csv', bytes })
  assert.equal(false, index.sheets[0].complete)
  assert.ok(index.issues.some((issue) => issue.code === 'index_limit'))
  assert.equal('A1:B50003', index.sheets[0].range)
  assert.equal('A1:B50000', index.sheets[0].indexedRange)
})

test('概览保留全部 Sheet，合并和对象使用可继续的分页，避免一次挤入上下文', () => {
  const index = parseWorkbook({ name: 'data.csv', bytes: Buffer.from('字段;值\n型号;00123') })
  index.sheets[0].objects = Array.from({ length: 30 }, (_, i) => ({ kind: 'image', anchor: `A${i + 1}` }))
  const state = { reads: [], previews: [] }
  const first = overviewSheets(index, state)[0], second = overviewSheets(index, state, first.nextMetadataOffset)[0]
  assert.equal(12, first.objects.length); assert.equal(30, first.metadataCounts.objects)
  assert.equal('A13', second.objects[0].anchor)
  assert.equal(null, overviewSheets(index, state, second.nextMetadataOffset)[0].nextMetadataOffset)
  const associated = rangeMetadata(index.sheets[0], bounds('A1:A30'))
  assert.equal(true, associated.metadataPartial); assert.equal(12, associated.objects.length)
  assert.equal(30, associated.metadataCounts.objects)
})
