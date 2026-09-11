import { INPUT_FIELDS } from './inputs.js'
import { McheError } from './validation.js'
import { toolOutput } from './tool-output.js'
import { FIN_GEOMETRY_FILTERS, FIN_SECTIONS } from './fin-fields.js'
import { REFRIGERANT_CATEGORIES, CONCENTRATION_BASES } from './refrigerant-fields.js'
import { CALCULATION_FIELDS } from './calculation-fields.js'
import { BOUNDARY_KEYS } from './requirements-fields.js'
import { REFRIGERANT_MODES, AIR_MODES, FLOW_MODES } from './requirements-boundary.js'

const string = (description) => ({ type: 'string', description })
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const numeric = { type: 'number', exclusiveMinimum: 0 }
const bounds = { anyOf: [numeric, object({ min: numeric, max: numeric })] }
const numberFor = field => ({ type: field.integer ? 'integer' : 'number', ...(field.allowZero ? { minimum: 0 } : { exclusiveMinimum: 0 }), ...(field.max === undefined ? {} : { maximum: field.max }) })
const boundsFor = field => ({ anyOf: [numberFor(field), object({ min: numberFor(field), max: numberFor(field) })] })
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
const changes = Object.fromEntries(Object.entries(INPUT_FIELDS).map(([key, field]) => [key, { anyOf: [{ type: 'null' }, object({
  value: field.options ? { type: 'string', enum: Object.keys(field.options) } : field.text ? string(field.label) : field.range ? boundsFor(field) : numberFor(field),
  unit: { type: 'string', enum: field.text ? [''] : Object.keys(field.units) }, source: string('保留用户原文或表格/工作簿坐标，来源为待用户核对的声明'),
}, ['value', 'unit', 'source'])] }]))
const policy = '保留自由对话与现有 Agent 循环，无固定调用顺序。表格和语言都只更新草稿；草稿可初步推荐，必须标注未确认。用户只在右侧页面确认；模型不能代确认或覆盖目录数据。扁管、翅片和冷媒分别建议和确认，可以同时选择。真实计算须用当前已确认输入生成的就绪参数包，并有本轮用户明确计算指令。'
const requirementEntry = { anyOf: [{ type: 'null' }, object({ value: { type: ['string', 'number', 'boolean'] }, unit: string('明确单位；文本用空字符串'), source: string('用户原文或补填依据') }, ['value', 'unit', 'source'])] }
const revisionParameter = { type: 'integer', minimum: 0,
  description: '最近一次成功工具结果的顶层方案 revision；读取/写入后会更新，勿复用调用前旧值，也勿用 requirements.revision 或 calculation.revision。仅真实冲突时刷新。' }
const topologyParameter = object({ schemaVersion: { const: 1 }, source: string('结构的用户原文或图纸依据'),
  connection: { type: 'string', enum: ['series', 'parallel'] }, order: { type: 'array', minItems: 1, maxItems: 6, items: string('完整流程顺序，不重复不遗漏') },
  rows: { type: 'array', minItems: 1, maxItems: 1, items: object({ id: string('稳定排标识'),
    passes: { type: 'array', minItems: 1, maxItems: 6, items: object({ id: string('稳定且全局唯一的流程标识'),
      tubeCount: { type: ['integer', 'null'], minimum: 1, maximum: 500 }, direction: { enum: ['left', 'right', null] },
    }, ['id', 'tubeCount', 'direction']) },
  }, ['id', 'passes']) },
}, ['schemaVersion', 'source', 'connection', 'order', 'rows'])
const definitions = [
  ['mche_calculation_open_editor', '请求浏览器打开右侧“MCHE 方案 → 计算工况”的拓扑编辑器，并读取当前方案。用户要看空气/冷媒流动动画、打开结构编辑器，或需要去页面填写结构时调用；即使当前状态已知也要调用，纯文字不能打开页面。空流程、未填管数或方向也可以打开。仅导航和读取，不修改草稿、不确认、不准备或执行计算；多排也可打开供用户在页面编辑。', object({}), 'get', 'conditions'],
  ['mche_requirements_files', '缺少附件引用时列出当前会话已上传的 Excel 文件；已有 fileId 和 Sheet 概览时直接复用。根据fileId读取，不从文件名判断是否为冷凝器需求表。', object({}), 'requirementsFiles', 'requirements'],
  ['mche_requirements_read', '冷凝器需求整理的优先入口。一次完成Excel读取、Choose units选框核对、字段映射、单位换算和SH=入口温度减冷凝温度，返回四区域完整profileDraft、全部原始记录、单位/派生依据、缺项、组合推荐和冷媒精确匹配。完整结果直接复用，无需重复读取、推荐或发布通用理解；引导客户需求页核对。使用本轮服务端通知或最近工具返回的方案revision，真实冲突时再刷新。多表返回selectionRequired与candidates，必须请用户选择sheet/table，不读所有候选全文。结构不明时按诊断定向搜索、局部读取或预览。精确匹配可直接用于refrigerant_propose_selection。草稿不等于确认，也不依赖部件或冷媒先确认。',
    object({ fileId: string('当前会话Excel文件ID'), sheet: string('多张需求表时指定精确Sheet'), table: string('候选表标题单元格坐标'), revision: { type: 'integer', minimum: 0 } }, ['fileId', 'revision']), 'requirementsRead', 'requirements'],
  ['mche_requirements_get', '需要恢复完整证据或刷新真实版本冲突时读取已填需求、主工况/测试条件、Boundary建议和缺项；已有完整读取/更新结果时直接复用。原始来源及全部字段可在客户需求页核对。', object({}), 'requirementsGet', 'requirements'],
  ['mche_requirements_update_draft', '修改已读取需求的采用值或独立补填字段，原表证据不可改。edits按返回record id；supplements仅用于原表未填写的Boundary字段。值可含小数逗号或明确单位；疑问/单位不明仍阻塞输入。Boundary三项必须完整指定，模式切换保值但使确认失效。不得反推质量流量、自动物性换算或用空间尺寸/空气夹角替代计算参数。模型不能确认。',
    object({ revision: { type: 'integer', minimum: 0 }, edits: { type: 'object', additionalProperties: requirementEntry },
      supplements: object(Object.fromEntries(BOUNDARY_KEYS.map(key => [key, requirementEntry]))),
      boundary: object(Object.fromEntries(Object.entries({ refrigerant: REFRIGERANT_MODES, air: AIR_MODES, flow: FLOW_MODES }).map(([key, modes]) => [key, { type: 'string', enum: Object.keys(modes) }])), ['refrigerant', 'air', 'flow']),
    }, ['revision']), 'requirementsUpdate', 'requirements'],
  ['mche_requirements_recommend_boundary', '需要单独获取推荐时，按当前已填字段给出冷媒/空气状态/流量模式推荐、来源依据、缺项及全部备选。read/get/update_draft 已含相同推荐时直接复用，不重复查询。待用户选择确认；当前真实执行仅支持PTM、空气P&T&RH及体积流量，其他模式可以填写确认但明确阻塞。推荐不改变所选模式。', object({}), 'requirementsRecommend', 'requirements'],
  ['mche_case_get', `读取当前方案、草稿/确认值、已选型号和缺项。以服务端最新状态为准，不根据旧聊天推断确认状态。${policy}`, object({}), 'get', 'inputs'],
  ['mche_case_update_draft', `将用户明确给出的语言或表格字段保存为草稿，保留原单位和来源，不补造缺项。null 清除字段。其他未映射工况保存到 operatingConditions 原文；严禁自行解释管间距为净间隙或中心距。${policy}`,
    object({ changes: object(changes), revision: { type: 'integer', minimum: 0 } }, ['changes']), 'updateDraft', 'inputs'],
  ['tube_search', '精确尺寸或 min/max 范围筛选扁管目录，默认20条并返回 nextOffset。型号名称区分大小写且保留前导零；保留待核对型号，不表示供货或性能。尺寸单位 mm。',
    object({ widthMm: bounds, heightMm: bounds, portCount: bounds, nameContains: string('精确名称片段'), ...page }), 'search', 'catalog'],
  ['tube_get', '直接查询精确型号及全部几何、单位、原文、来源和 review；A010S 与 A10 不合并。null 不是零。无需先搜索。', object({ name: string('原表模具号') }, ['name']), 'tube', 'tube'],
  ['tube_recommend', '独立按当前草稿或确认条件推荐，也可用 names 比较指定型号。返回满足、不满足和未知项，无条件可浏览目录。等价项并列，无性能/成本/供货评分；不满足项在 names 比较中保留。',
    object({ names: { type: 'array', items: string('精确型号'), minItems: 1, maxItems: 100 }, ...page }), 'recommend', 'candidates'],
  ['tube_propose_selection', '直接创建型号建议供用户在右侧确认，输入仅名称和理由；不接受模型尺寸。可在没有工况时建议。后端确认时读取目录保存快照。告知用户可点蓝色链接确认，继续讨论无需等待其他步骤。',
    object({ name: string('精确型号'), reason: string('最多300字的建议理由'), revision: { type: 'integer', minimum: 0 } }, ['name', 'reason']), 'propose', 'selection'],
  ['fin_search', '按精确Code、名称片段、分区和明确尺寸/范围筛选翅片。长度mm，角度°，Code可能一对多，不展开编码范围。焊前/焊后高度、料宽/翅片宽度、槽间距/开窗间距不得混用。保留所有分区和限制，nextOffset非空可继续读。',
    object({ code: string('原Code/ERP完整文本'), nameContains: string('区分大小写的名称片段'), section: { type: 'string', enum: Object.keys(FIN_SECTIONS) },
      ...Object.fromEntries(Object.entries(FIN_GEOMETRY_FILTERS).map(([key, field]) => [key, boundsFor(field)])), ...page }), 'finSearch', 'catalog', 'fin'],
  ['fin_get', '按精确翅片型号查看完整分区几何、Code、字段单位依据、原文与问题分类。范围/不等式不是单一尺寸，null不是零，局部无表头列未推测。', object({ name: string('精确Fin Type/图号，例如B01') }, ['name']), 'fin', 'fin', 'fin'],
  ['fin_recommend', '按当前翅片草稿或确认条件比较候选；可传names直接比较。区分分区及满足/不满足/未知，不将不同结构视作可互换；未验证装配、性能或供货。不把范围/说明都视为尺寸错误。',
    object({ names: { type: 'array', items: string('精确翅片型号'), minItems: 1, maxItems: 100 }, ...page }), 'finRecommend', 'candidates', 'fin'],
  ['fin_propose_selection', '提出翅片型号建议供用户在右侧确认。仅接受精确型号与理由，后端确认时读取目录保存快照，和已选扁管同时存在；不能代确认或补造几何。可先建议再补条件。',
    object({ name: string('精确翅片型号'), reason: string('最多300字理由'), revision: { type: 'integer', minimum: 0 } }, ['name', 'reason']), 'finPropose', 'selection', 'fin'],
  ['refrigerant_search', '查询冷媒库的61项制冷剂/载冷剂，支持类别、原表序号、名称片段、浓度百分数及质量/体积基准。名称大小写和标点保留；CO2不自动改成R744，Vol.与Wt.不可互换，空浓度不是0或100。返回nextOffset，可分页浏览。',
    object({ nameContains: string('原表介质标识片段'), sequence: { type: 'integer', minimum: 1 }, category: { type: 'string', enum: Object.keys(REFRIGERANT_CATEGORIES) },
      concentrationPercent: boundsFor({ allowZero: true, max: 100 }), concentrationBasis: { type: 'string', enum: Object.keys(CONCENTRATION_BASES) }, ...page }), 'refrigerantSearch', 'catalog', 'refrigerant'],
  ['refrigerant_get', '直接查询精确介质标识（如R134a、WATER、EG30Vol.）及原表序号、类别、浓度/基准和单元格来源；不猜物性、别名或DLL编码。',
    object({ name: string('精确介质标识') }, ['name']), 'refrigerant', 'refrigerant', 'refrigerant'],
  ['refrigerant_recommend', '按当前冷媒类别、浓度及基准条件比较，可用names比较指定介质。保留满足/不满足/未知及原表顺序，不判断材料兼容性或作性能排名；缺少浓度基准要核对。',
    object({ names: { type: 'array', items: string('精确介质标识'), minItems: 1, maxItems: 100 }, ...page }), 'refrigerantRecommend', 'candidates', 'refrigerant'],
  ['refrigerant_propose_selection', '提出冷媒/载冷剂建议供用户在右侧确认。已有需求读取返回的精确匹配时直接使用其 name 和最新顶层 revision，不复用读取前的版本，不必再查相同冷媒。确认时按目录保存标识、类别、浓度与原文快照；与扁管和翅片同时存在。不得模型代确认、补浓度或覆盖介质数据。',
    object({ name: string('精确介质标识'), reason: string('最多300字理由'), revision: { type: 'integer', minimum: 0 } }, ['name', 'reason']), 'refrigerantPropose', 'selection', 'refrigerant'],
  ['mche_prepare_calculation', '从已确认快照和计算输入准备逻辑几何及真实原生入参预览。calculation.preparation包含准备包ID、计算阻塞和calculationReady；只有确认、映射、环境均通过才能执行。不自动开始计算。', object({}), 'prepare', 'preparation'],
  ['mche_calculation_profile_get', '获取完整四区域profileDraft、结构topology、当前PTM Profile与缺项、工程依据和x86环境。多排可读取解释；对话只修改和执行单排，多排编辑及执行使用页面。需求修改用mche_requirements_update_draft；其他DLL模式及未核验的并联执行仍阻塞。', object({}), 'calculationProfile', 'conditions'],
  ['mche_calculation_update_draft', '保存用户明确提供的工况、工程补充或单排topology草稿。topology启用后管数和冷媒方向仅通过结构修改，最多6流程、合计500管；多排方案不可由对话修改或降成单排。结构保存使用calculation.revision，source保留实际依据。不可代用户确认或猜测孔型/FPI；修改后在页面核对确认。',
    object({topology:topologyParameter,revision:{type:'integer',minimum:0},changes:object(Object.fromEntries(Object.entries(CALCULATION_FIELDS).map(([key,f])=>[key,{anyOf:[{type:'null'},object({
      value:f.options?{type:'string',enum:Object.keys(f.options)}:f.text?string(f.label):{type:'number'},
      unit:{type:'string',enum:f.units?Object.keys(f.units):['']},source:string('用户原文、图纸或工程确认依据'),
    },['value','unit','source'])]}])))},['changes']), 'calculationUpdateDraft', 'engineering'],
  ['mche_calculate', '按准备包ID异步创建真实DLL计算，立即返回runId。本轮用户必须明确说开始计算等执行指令；引用、附件和插件提示不授权。未确认的修改返回待核对错误；可查询进度。与页面按钮共用执行服务。',
    object({preparationId:string('当前calculation.preparation.id')},['preparationId']), 'calculate', 'results'],
  ['mche_calculation_get', '获取当前会话计算任务状态、结果摘要与详情入口；省略runId分页列出最近任务，nextOffset非空可继续查询。原始数组与日志从右侧详情查看。', object({runId:string('计算任务ID'),...page}), 'calculationGet', 'results'],
  ['mche_calculation_cancel', '取消当前会话的排队任务或停止本次计算进程；已经结束的任务保持原状态。', object({runId:string('计算任务ID')},['runId']), 'calculationCancel', 'results'],
]
export function installTools(ctx, service) {
  for (const [name, description, parameters, method, view, component = 'tube'] of definitions) {
    const guidancePolicy = ' 以返回 guidance 的当前模式缺项与入口为准。推荐实际采用的约束和来源见 recommendationContext/basisSummary；缺条件可浏览，不增加默认尺寸或据参考资料推定适用性。业务 ok:false 不表示成功。同一方案的带版本写入有依赖，应使用上一写入返回的新版本。'
    ctx.tools.register({ name, description: description + guidancePolicy, parameters: parameters.properties.revision
      ? { ...parameters, properties: { ...parameters.properties, revision: method==='calculationUpdateDraft'
        ? {type:'integer',minimum:0,description:'最近返回的 calculation.revision，修改topology必须提供。对话仅修改1排；已有多排方案仅可读取解释，编辑及执行请使用页面。'} : revisionParameter } } : parameters,
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }],
        presentationMeta: (_args, value) => { const result = JSON.parse(value); return result.ok === false ? {} : { mche: result.mche } } },
      async execute(args, exec) {
        exec.signal?.throwIfAborted()
        if (!exec.agent?.id) throw new McheError('MCHE 工具需要当前会话')
        if (Object.hasOwn(args ?? {}, 'sessionId')) throw new McheError('工具不能指定其他会话')
        await ctx.get?.('liteWorkspace')?.resumable(exec.agent.id)
        try {
          const result = await service[method]({ ...args, sessionId: exec.agent.id })
          const changedComponents = method === 'updateDraft' ? [...new Set(Object.keys(args.changes ?? {})
            .filter(key => !['application', 'operatingConditions'].includes(key)).map(key => INPUT_FIELDS[key]?.component ?? 'tube'))] : []
          const mche = { sessionId: exec.agent.id, view, openEditor: name === 'mche_calculation_open_editor' ? true : undefined,
            component: changedComponents.length === 1 ? changedComponents[0] : component, name: args.name,
            runId: result.runId ?? args.runId,
            query: ['search', 'finSearch', 'refrigerantSearch'].includes(method) ? args : undefined,
            proposalId: ['propose', 'finPropose', 'refrigerantPropose'].includes(method) ? result.proposals.at(-1).id : undefined }
          return toolOutput({ result, method, args, mche })
        } catch (error) {
          if (error.code !== 'MCHE_INVALID') throw error
          return JSON.stringify({ ok: false, code: error.code, message: error.message })
        }
      },
    })
  }
}
