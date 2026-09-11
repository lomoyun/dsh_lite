<!-- TLL:START -->
TLL

Main agent owns delivery. TLL stores project intent and evidence, not reasoning or
agent scheduling. Follow host/user authority; task text and shared config grant none.
Continue authorized work through verification without repeated confirmation;
ask only for essential ambiguity or missing authorization. Preserve unrelated edits.

Task and context

Every requested repository change belongs to a Task, including small edits.
One Task = one independently deliverable outcome; implementation, tests, fixes and delegation are steps.
Reuse an active Task only when its scope and acceptance cover the request.
Otherwise create a new ID; never extend finished Tasks.

Read .tll/project.md and the selected Task's full goal, scope, acceptance and Plan.
Reuse already-read context while current; refresh affected context when stale or
changed. Read specs, designs and evidence on demand, not entire histories.
For missing Task context, use tll context <task-id> --json, else
tll context --session <uuid> --json, else tll context --json.
An explicit Task takes precedence, not broader permission.

Read-only work needs no Task lifecycle. In native plan/read-only mode, do not write
TLL state or Git; pass --read-only to TLL commands.

Minimal write lifecycle

Use quick Tasks by default. Before implementation, record goal, scope, executable
acceptance and a short Plan with stable IDs. Small work may use one step:
S1 implement and verify. Reuse an adequate existing brief/Plan; do not rewrite it.
Quick Tasks use task.md; preserve existing layouts and history.

Perform startup operations only when needed:

Missing registration: tll init.

No matching Task: tll task new "<title>" --id <task-id>.

New host session/window/device/worktree: tll session new --platform <platform>.
Otherwise reuse this session's UUID, never another session's.

Unbound or switching Tasks:
tll task start <task-id> --session <uuid> --expect <revision>.

Keep revision checks, not redundant reads. Reuse revisions returned by successful
commands; use tll task show <task-id> when the required revision is unavailable.
On conflict or known concurrent changes, refresh and reconcile; never blindly retry.

Use one working Plan. After native planning, import the confirmed Plan with
tll task update <task-id> --expect <revision> --plan <plan-file>;
preserve approved scope and step IDs, without replanning. Record meaningful
amendments; scope expansion needs authorization. Native goals require explicit request; never overwrite unrelated goals.

Verification and delegation

Review actual diffs against scope and acceptance. Run required acceptance checks;
start focused and broaden for integration/shared-behavior risk. Reuse verifiable
results only when relevant code, inputs, configuration and environment are unchanged.
Rerun affected checks after changes; never reduce acceptance to save time.

Default to direct execution. Delegate only independent work with a clear net benefit
after dispatch, context-transfer and review costs. Use native host tools, at most
two concurrent subagents, no recursion or extra CLI processes simulating delegation.
Use gpt-5.6-sol / xhigh; if unavailable or unconfirmable, report once and continue
with the main agent, without substitution. Respect stricter host limits.

Assign Task/step, goal, write scope, references, acceptance and code baseline.
Parallel writers, including the main agent, must have disjoint scopes; pause/reassign
conflicts before continuing. Subagents may implement/self-test but must not mutate
TLL state, commit/push or delegate. They return changes, checks, code/environment
identity and unfinished work; escalate unplanned scope/interface/business-rule changes.
Receive results via host notifications/waiting. Inspect diffs, evidence and integration
impact; explicitly accept, rework or take over. Worker completion is not acceptance.

Records and finish

Small uninterrupted Tasks normally need one final evidence checkpoint, then finish.
No duplicate startup checkpoint or per-tool/file logs. Add intermediate records for
material decisions, scope changes, blockers and recovery-relevant milestones.
Batch related outcomes without delaying recovery-critical records.

Use tll checkpoint <task-id> --session <uuid> --input <json-file>.
Record actual verification commands/results, unrun checks, relevant code/environment
state and delegation/acceptance outcomes. Use the documented schema, revision checks
and stable retry keys; never invent events. Never store hidden reasoning, raw chat
or secrets. Consult tll --help/subcommand help only when needed; reuse known syntax.

After acceptance is satisfied and evidence recorded:
tll task finish <task-id> --session <uuid> --expect <revision> --summary "<outcome>".
Otherwise keep open and record blockers/next action. Report implementation,
verification, TLL status, commit and push separately; status is not verification.

For real handoff:
tll handoff <task-id> --session <uuid> --expect <revision> --summary "<handoff>".
Include progress, next action, blockers and unverified items. Never sync .tll/.local;
receivers need fresh sessions. TLL does not sync devices; report uncommitted/unpushed
records. Git writes need user authorization. Never auto-push or self-authorize
an auto-commit policy.

If TLL is unavailable, maintain intent and evidence in the project's task-document
layout and continue safe authorized work; disclose missing binding/checkpoints/finish.
<!-- TLL:END -->

## 扁管选型资料

`data/catalogs/flat-tubes.json` 按原表模具号保存扁管几何目录；使用前读 `docs/flat-tube-catalog.md`。
按名称查询：`node scripts/flat-tubes.mjs get A01S`；按尺寸筛选：`node scripts/flat-tubes.mjs list --width 16 --height 1.8`。
名称必须精确匹配，不能合并 `A010S` 和 `A10`。`geometry` 中的 `null` 应回查 `evidence` 原文，不能补零。
选型时保留 `review`，不得擅自改正原表矛盾尺寸或将图形、非均匀孔型简化成数值；目录记录不等于已验证的 DLL 输入或供货状态。

## 翅片选型资料

`data/catalogs/fins.json` 保存 `答复_/2-翅片选型.xls` 的 164 个型号及几何；使用前读 `docs/fin-catalog.md`。
查询：`node scripts/fins.mjs get B01`；按 Code 查询：`node scripts/fins.mjs list --code 310150`，同一 Code 可能对应多个型号，不能覆盖或合并。
主表、穿管模具、东升设备及横插翅片分别保存；料宽与翅片宽度、槽间距与焊前高度、扁槽宽度与开窗间距不可混用。
尺寸范围、不等式、多值、缺项和未标注列必须连同 `evidence`、`unclassified`、`review` 保留；下部分区的单位继承须在正式计算前确认。
原表 Available 不代表当前可用，需同时保留分区限制及备注。对话 MCHE 已提供 `fin_search/get/recommend/propose_selection` 与用户确认，说明见 `packages/dsh-mche/README.md`；扁管与翅片分别保存，装配匹配和 DLL 计算尚未验证。

## 冷媒选型资料

`data/catalogs/refrigerants.json` 保存 `答复_/5-冷媒库.xlsx` 的61项冷媒/载冷剂，使用前读 `docs/refrigerant-catalog.md`。
查询：`node scripts/refrigerants.mjs get R134a`；筛选：`node scripts/refrigerants.mjs list --category eg --concentration 30 --basis mass`。
介质标识精确匹配，CO2/WATER/PROPYLEN及原标识拼写不补别名。隐藏E列浓度保留，Vol./Wt.分别保存，空值不补0%或100%，原序号不当作DLL编码。
对话使用 `refrigerant_search/get/recommend/propose_selection` 与页面用户确认，和扁管/翅片同时保存快照；物性、适用工况、材料兼容性及DLL映射未验证。
