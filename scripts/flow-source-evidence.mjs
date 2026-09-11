import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const source = 'E:/projects_related_files/微通道/MCHE2026/MCHE2026/Template File/'
const records = []
for (const name of ['2Pass_Opti.sh', '3Pass_Opti.sh']) {
  const bytes = await readFile(source + name), data = JSON.parse(bytes)
  records.push({ name, source: source + name, sha256: createHash('sha256').update(bytes).digest('hex'),
    software: data.Software, version: data.Version, general: Object.values(data.InputData[0]).sort((a,b)=>a.iIndex-b.iIndex).map(v=>v.dValue),
    header: data.Pass.HeadInf, connection: data.Pass.ConnectInf, airDirection: data.Pass.AirFlowInf })
}
await mkdir('docs/verification/evidence/flow-topology', { recursive: true })
await writeFile('docs/verification/evidence/flow-topology/source-samples.json', JSON.stringify(records, null, 2))
console.log(records.map(r=>({name:r.name,sha256:r.sha256,passes:r.header.length,twisted:r.general[4]})))
