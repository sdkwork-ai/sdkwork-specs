# REVIEW-2026-0911 — 全舰队标准对齐审计（门禁矩阵 + bin/ 放置通道）

Status: **in-progress**（标准侧缺陷已修，模块侧债务已度量并部分清偿）
Date: 2026-09-11
Authority: `MODULE_BIN_SPEC.md` §2 / §2.1 / §2.2 / §7、`sdkwork-specs/gates.manifest.json`

## 1. 审计范围与方法

- **受治理仓库谓词**：`sdkwork-*` 目录且带根 `AGENTS.md` → **100 个**，全部命中。
  其中带 `sdkwork.app.config.json`（产品模块）的为 **79 个**；21 个为库/工具
  （无 manifest，多数无 `bin/`）。非 `sdkwork-` 前缀但带 manifest 的
  `hub-installer`、`magic-studio` 属 off-fleet，只列出不受审。
- **门禁运行**：`node sdkwork-specs/tools/run-gate-matrix.mjs --workspace . --json`
  （一次跑完 40 条门禁；`contract` 层必须 exit 0，`guardrail` 层条目数不得超基线）。

## 2. 舰队门禁矩阵结果（40 条）

**6 条 contract 门禁为红（必须 exit 0）**，1 条 guardrail 越基线：

| 门禁 | 层 | exit | 条目 | 归属模块与事实 |
| --- | --- | --- | --- | --- |
| `check:sdk-standard` | contract | 1 | 486 | 全部位于 `sdkwork-birdcoder2/packages/client/ui-sdkwork-*/lib/client.js` —— **git 忽略的构建产物**，见 §4.1 |
| `check:database-initialization` | contract | 1 | 156 | 待逐模块归因 |
| `check:packages-layout` | contract | 1 | 4 | agentstudio（仓库根 `packages/` 禁用）、birdcoder2（缺 `repository-kind: application`；根 `packages/` 禁用；`pnpm-workspace.yaml` 遗留 glob） |
| `check:tailwind-integration` | contract | 1 | 2 | appstore（`…-pc-host/src/styles.css`）、birdcoder2（`ui-sdkwork-apikey/src/client/apiKeysView.css`）均 `@import "tailwindcss"` |
| `check:database-bootstrap-references` | contract | 1 | 2 | documents（`databaseRole` 未分类为 authoritative-server/client-local）、drama（postgres 缺 `0001_*_baseline.sql`） |
| `check:cors-standard` | contract | 1 | — | appstore 的 `agents-open-test.*` 派生 origin 缺失 + 白名单顺序非规范；10 个模块缺 pnpm 聚合入口；tts 无 `package.json`。官方修复器：`node tools/align-cors-standard.mjs --workspace . --fix` |
| `check:rust-crate-naming-standard` | guardrail | 1 | **706 > 704** | 100 仓 / 1146 crate；error 10 + warn 696，较基线 +2 |

guardrail 层其余 12 条均在基线内（`items ≤ baseline` 即为通过，exit 1 属既有债务的正常表现）。

## 3. 标准与门禁缺陷（本轮已修）

### 3.1 §2.2 要求 `.cmd` 伴随件，门禁却审计不到 `.cmd`/`.bat`

`MODULE_BIN_SPEC.md` §2.2 明确“`.ps1`/`.cmd` 伴随件保持同一 stem”，
`checks-script-placement.mjs` 的 `SCRIPT_SUFFIXES` 却止步于 `.ps1`。
后果：**任何模块在 Windows 上的第二个脚本家目录完全不可见**。

修复：`SCRIPT_SUFFIXES` 增补 `.cmd`/`.bat`；`gradlew`/`mvnw` 及其 `.bat`/`.cmd`
孪生体作为生成工具包装豁免（`isToolWrapper`）。同时把“被审计文件类”
显式写入 §2.1：shell 家族 + 带 `#!` 的无扩展名文件；语言原生工具
（`.mjs`/`.js`/`.ts`/`.py`）明确不在范围内——否则 `scripts/**` 的字面表述
会被误读为连 `node --test` 套件也违规。

### 3.2 放置门禁“声明的唯一执行面”根本没接线

`MODULE_BIN_SPEC.md` §2.1 称 `check-script-placement.mjs` 是
“Single enforcement surface … refuses a silent pass”，但两条门禁
（`check:script-placement`、`check:module-bin`）只声明在
`sdkwork-specs/package.json` 里，**既不在根 `check:all`（contract 层），
也不在 `gates.manifest.json`（guardrail 层）**。即整个舰队可以回归而无人察觉。

修复：两条门禁按 `workspace` scope 晋升为 guardrail，基线取实测值
（放置 157、bin 家族 0）。同时给 `check-module-bin.mjs` 增加
`violations : N` 汇总行——`run-gate-matrix.mjs#countItems` 按该标签计数，
缺行则每次记 0，门禁会退化为装饰。

### 3.3 §7 的仓库谓词与实现自相矛盾

§7 原文称两种模式“apply the same fleet predicate … carrying
`sdkwork.app.config.json`”，把 §2.1 与 §2 的谓词合并成一个。实际：

- `check-script-placement.mjs` 用 `listWorkspaceRepositoryRoots()`
  （`sdkwork-*` + `AGENTS.md`）→ **100** 仓；
- `check-module-bin.mjs`、`check-operations-conformance.mjs`、
  `application-deploy-layout/discover.mjs` 用 manifest 谓词 → **79** 仓。

这不只是文档笔误：21 个无 manifest 的库（`sdkwork-utils`、`sdkwork-core`、
`sdkwork-test`、`sdkwork-ui`…）**根本没有 `bin/` 目录**，若把 §2 的九入口家族
套到它们身上会产生 21 个假失败；反之 §2.1 的放置规则必须覆盖它们
（`sdkwork-superpowers` 就有 33 处 `bin/` 外脚本）。

修复：§2、§2.1、§7 分别写明各自的 scope 与谓词，并在 §7 用一张表固定：

| 条款 | 治理对象 | 谓词 | 工具 |
| --- | --- | --- | --- |
| §2.1 放置 | 全部受治理仓库 | `sdkwork-*` + `AGENTS.md` | `check-script-placement.mjs` |
| §2 入口家族 / §2.2 命名 | 产品模块 | `sdkwork-*` + manifest | `check-module-bin.mjs` |

### 3.4 自我更正：`check:sdkwork-subpath-exports` 并无静默通过缺陷

本轮我曾据“manifest 传 `--repo <path>`”判定该门禁扫描 0 文件、永久静默通过。
**该判断错误**：manifest 里 `argv` 是 `["{repo}"]`（位置参数），矩阵展开后
`process.argv[2]` 正是仓库路径；实测 `sdkwork-im` 扫描 919 个文件、exit 0，
`check:sdkwork-subpath-exports` 的 `items=0 baseline=0` 是真实的干净结果。
当时我误把 `argv: {repo}` 读成 `--repo {repo}`，并据此改了工具；
该改动已用 `git checkout` 还原，未留在工作区。全工作区单次运行（27,656 个文件）
确认为 0 违规。

## 4. 待决缺陷（已证据化，未改动）

### 4.1 `check:sdk-standard` 对构建产物报 486 违规（最高优先级）

全部 486 条 `consumer-generated-transport-alias` 落在
`sdkwork-birdcoder2/packages/client/ui-sdkwork-*/lib/client.js`。事实链：

- 该 `lib/` 由 `tsdown` 生成（`"bundle": "tsdown"`，`main: lib/index.js`）；
- git 忽略：`git check-ignore -v packages/client/ui-sdkwork-apikey/lib/client.js`
  → `.gitignore:15:lib/`（`ui-sdkwork-feedback` 同）；
- 扫描器 `tools/lib/app-sdk-consumer-import-patterns.mjs` 的
  `IGNORE_DIRS = {node_modules, .git, dist, build, target, artifacts,
  .pnpm-store, .runtime}` —— **跳过 `dist`/`build`，却没有 `lib`**；
- 判定函数末行 `return /(^|\/)apps\/|(^|\/)packages\//u.test(norm)` 使
  `packages/**` 下任何文件都算“消费侧源文件”。

即：一条 **contract 门禁**因为一个仓库的打包产物而全舰队永久为红。
建议修复（择一，需决策后实施）：遍历时按仓库 git-ignore 裁剪（与
`check-script-placement.mjs` 同口径，最精确），或将 `lib` 并入 `IGNORE_DIRS`
（需先确认舰队内 `lib/` 均为构建产物）。**未擅自放宽 contract 门禁**：
放宽会掩盖真实违规，与 §2.1 禁止静默通过的原则冲突。

### 4.2 新暴露的 `.cmd`/`.bat` 与 scratch 放置项（共 22 条）

放置门禁现审计到 157 违规 / 71 个模块对齐（此前 137 / 75）。
新增项分两类：

- **15 条 PLACEMENT**：`sdkwork-agentstudio` ×7（`sdkwork-run-node.cmd`、
  `sdkwork-run-pnpm.cmd`、`tauri-dev-fast.cmd` 及 4 个包级 `sdkwork-run-node.cmd`）、
  `sdkwork-tts` ×2（`launch_ui.bat`、`scripts/start_server.bat`）、
  `sdkwork-superpowers`（`hooks/run-hook.cmd`）、`sdkwork-birdcoder2`
  （`apps/desktop/scripts/windows-sign.cmd`）、`sdkwork-terminal`（`prepack.cmd`）、
  `sdkwork-forum` / `sdkwork-prompts`（`start-server.bat`）。
- **7 条 SCRATCH-NOT-IGNORED**：`sdkwork-{assets,community,news}` 的生成 SDK 树内
  `generated/server-openapi/.sdkwork/manual-backups/bin/sdk-gen.bat` ——
  生成器把 scratch 写进了未忽略的 `.sdkwork/`，会被 `git add .` 提交。

跨模块共性：这些多为 **npm 生命周期钩子**（`prepack`）与**跨平台 node/pnpm
启动垫片**，以及**工具强制的 hook 路径**（`hooks/session-start`）。标准目前
只规定“脚本住在 `bin/`”，未说明这类工具绑定路径的合规形态——属标准待补项。

### 4.3 模块级归属分布（放置门禁 Top）

`sdkwork-superpowers` 33、`sdkwork-tts` 17、`sdkwork-im` 5、
`sdkwork-agentstudio` 9、`sdkwork-birdcoder2` 8、`sdkwork-specs` 7、
`sdkwork-terminal` 7、`sdkwork-birdcoder` 6、`sdkwork-knowledgebase` 6、
`sdkwork-skills-private` 6。

## 5. `sdkwork-im` 模块对齐明细（12 → 5）

### 5.1 已删除（9 个文件，逐项证据）

| 文件 | 删除依据 |
| --- | --- |
| `scripts/backup.sh`（647 行） | 被规范入口取代：`bin/backup.sh` → `SDKWORK_ENTRY=backup` → specs 共享库 `ops-backup.sh`（create/list/verify/restore）。`package.json`/CI 零引用 |
| `scripts/restore.sh`（237 行） | 同上，`restore` 是 `bin/backup.sh` 的 action；生产恢复走 `--yes` 门禁 |
| `scripts/migrate-database.sh`（225 行） | 迁移已由 `db:migrate` → `scripts/dev/sdkwork-im-database-cli.mjs` 与部署期 `migrationMode: apply` 承担 |
| `scripts/verify-deployment.sh`（185 行） | 文件本身 GBK/UTF-8 **乱码损坏**；覆盖被 `bin/verify-server.sh` + `bin/doctor.sh` 取代 |
| `tools/converge-repo.sh` | agent scratch：硬编码 `C:/Users/admin/AppData/Local/Temp/` 与 `E:/sdkwork-space/…`，零引用 |
| `docs/sites/scripts/run-docs-task.{sh,ps1,cmd}`、`run-node.cmd` | 零消费者启动垫片；`docs/sites/package.json` 直接调 `run-docs-task.mjs` |

删除前已备份 14 个文件至 `.workbuddy/backup/im-placement-20260911/`（git 忽略的
scratch），且该仓库 `HEAD` 未出生（0 commit），故另留副本以防不可恢复。

### 5.2 保留待转换（4 个文件，**不可直接删除**）

`scripts/check-security-config.sh`、`scripts/daily-security-check.sh`、
`tools/smoke/{local_stack_smoke.sh,local_stack_smoke.ps1,end_to_end_smoke.ps1}`。

保留理由（已核实，此前“已被取代”的假设不成立）：

- `bin/config.sh validate` 委派 `sdkwork_module_config_validate`，而 im 的实现
  只校验 5 个数据库必需键；
- `bin/doctor.sh` 检查工具链、bundle、容器健康、日志，**不覆盖**
  签名校验/HTTPS/证书有效期/异常登录/审计日志完整性。

按 §2.1“断言行为属测试，不属 shell 脚本（即便放在 `bin/` 内也违规）”，
正确出路是把它们改写为 `tests/` 下的 `node --test`，而不是保留 shell 或删除。

### 5.3 文档连带更新（§2.1 禁止文档引用已移除脚本）

- `docs/operations/OPERATIONS_MANUAL.md`：顶部加“规范入口 MUST 为 `bin/`”提示；
  §1.4 部署验证、§6.2 备份、§6.3 恢复、§7.2 迁移、§8 执行脚本五处内嵌的
  历史脚本体改为 `bin/verify-server.sh` / `bin/doctor.sh` / `bin/backup.sh` /
  `pnpm db:migrate` 的规范调用，并补迁移前向兼容与回滚口径。
- `docs/sites/reference/cli-and-scripts.md`、`docs/architecture/tech/TECH-cli-and-scripts.md`：
  `tools/smoke/*` 行改为 `bin/verify-server.sh` 与语言原生 smoke 测试。
- `docs/architecture/tech/TECH-architecturedesign-2026-04-06.md`：
  保留历史陈述并标注 `tools/smoke/*` 于 2026-09-11 退休及其替代测试。

## 6. 验证证据

| 检查 | 结果 |
| --- | --- |
| `check-script-placement.mjs --root sdkwork-im` | 12 → **5** 违规（183 → 160 个受审脚本） |
| `check-script-placement.mjs --workspace .` | 1850 脚本 / **157** 违规 / 71 模块对齐 |
| `check-module-bin.mjs --workspace .` | 79 模块 / 79 通过 / **0 违规**；`sdkwork-im` 49 条 §2.2 命名告警 |
| `gates.manifest.json` | JSON 有效；门禁 13 → **15**（新增两条 guardrail，基线 157 / 0） |
| `node --check`（修改过的两个门禁工具） | 语法通过 |

## 7. 后续待办（按优先级）

1. ~~决策并修复 §4.1~~ **已完成，但根因在 §8.3**（非 §4.1 所判）：`listWorkspaceRepos` 把工作区根当仓库导致整棵下钻 submodule。
   现 `check:sdk-standard` 舰队全量 **0 违规、exit 0**。
2. ~~`check:tailwind-integration`（2）~~ **已完成**，见 §8.2（两条真缺陷，allowlist 无需放宽）。
2. `check:database-initialization`（156）逐模块归因。
3. `sdkwork-im` 命名家族选题（`bin/` 顶层 49 个宿主脚本待归入 §2.2 家族）后统一改名。
4. §4.2 的 22 条 `.cmd`/`.bat` 与 scratch 项逐模块处置。
5. 标准补项：npm 生命周期钩子、跨平台启动垫片、工具强制 hook 路径的合规形态。
6. `check:cors-standard` 走官方 `align-cors-standard.mjs --fix`（影响面大，待确认后执行）。

---

## 8. 第四轮：契约门禁收口（2026-09-11 续）

### 8.1 修正第 4.1 节的结论（我的上一轮判断不充分）

第 4.1 节把 `check:sdk-standard` 的 486 条 `consumer-generated-transport-alias` 归因为"扫描器未裁剪 `lib/` 构建产物"，
并加了"按仓库自身 git 忽略规则裁剪"。**该修复是必要的，但不是根因**：修完之后门禁**仍然红**（486 → 255，且条数随磁盘上
是否存在 `lib/` 构建产物而变化）。真正的根因见 §8.3。

教训：**契约门禁的结果不得依赖构建状态**。当时 255 这个"变小了但没归零"的数字本身就说明归因不完整，应继续追到底。

### 8.2 `check:tailwind-integration` 2 → 0（两条都是真缺陷，不需要放宽 allowlist）

**判据（权威展开）**：`@import "tailwindcss"` 解析到 `tailwindcss/index.css`，其 `@layer base` 块内联的就是**完整 preflight**
（8489 B）：`*,::after,::before,::backdrop,::file-selector-button{box-sizing:border-box;margin:0;padding:0;border:0 solid}`、
`ol,ul,menu{list-style:none}`、`button,input,select,optgroup,textarea{font:inherit;border-radius:0;background-color:transparent}`、
`[hidden]{display:none!important}`、`html,:host{line-height:1.5;font-family:…}`。

| 模块 | 事实 | 判定 | 处置 |
| --- | --- | --- | --- |
| `sdkwork-birdcoder2` `packages/client/ui-sdkwork-apikey/src/client/apiKeysView.css` | 该 sheet 由 `tsdown.config.ts` 的 `virtualStyleModule` 编译后经 `document.head` 全局注入 `<style data-plugin-css>` | 裸 `@import "tailwindcss"` ⇒ **把 preflight 灌进整个 harness**（不止该嵌入视图） | 改用**同仓先例**：`tokenPlan.css` 的 `@import "tailwindcss/theme.css" layer(theme)` + `tailwindcss/utilities.css`（**刻意不含 preflight**） |
| `sdkwork-appstore` `apps/sdkwork-appstore-pc/packages/sdkwork-appstore-pc-host/src/styles.css` | `main.tsx` 引 `./index.css`（应用根，allowlist 命中，`@source "../packages"` 已覆盖 host 包 `src`）；`App.tsx:5` 又引 host 的 `styles.css` ⇒ **同一 Vite 图两个 bootstrap** | 违反 §4 第 1 条「每个可运行应用图只允许一个 Tailwind 引导」；且 host 的 `@source "../../../../src｜packages"` 解析到**不存在的** `apps/src`、`apps/packages`（死行） | 改为纯 CSS（保留 scrollbar/`@layer utilities` 等 plain CSS），引导权归应用根 |

**验证**：`check-tailwind-integration.mjs --workspace .` → `passed (100 repository root(s))`，exit 0。
birdcoder2 重跑 `tsdown` 后（exit 0）产物实测：preflight 特征 `-webkit-text-size-adjust:100%`、`tab-size:4`、
`-webkit-inner-spin-button{height:auto}`、`list-style:none` **全部消失**；`.bg-slate-50`、`animate-in`、`data-plugin-css` **全部保留**。

**结论：allowlist 无需放宽。** 两条都能按既有标准修好——避免了一次"为个例削弱契约门禁"。

### 8.3 `check:sdk-standard` 根因：`listWorkspaceRepos()` 把**工作区根**当成仓库

- `isRepoRoot(repoRoot)` = `AGENTS.md || package.json || Cargo.toml || pnpm-workspace.yaml`；`E:\sdkwork-space` 同时具备
  `AGENTS.md` 与 `package.json` ⇒ 被当作一个仓库根入列（实测 107 个根，第 1 个就是工作区根本身）。
- **后果链**：工作区根把每个 `sdkwork-*` 声明为 **git submodule** ⇒ `git ls-files --others --ignored --exclude-standard --directory`
  在工作区根只返回 168 条**根目录自有的**垃圾（`.pnpm-store/`、`.pub-*.log`…），**永不包含 submodule 内部**
  （`git check-ignore` 对该路径直接报 `is in submodule 'sdkwork-birdcoder2'`）⇒ 忽略集对这个子树为空 ⇒ `walkFiles` **零剪枝整棵下钻**。
- 两个可测后果：
  1. **255 条伪造违规** —— 全部是 submodule 里 `lib/*.js` 打包内联的生成传输文本；条数随谁 `build` 过而变化（非确定性）。
  2. **工作区每个文件被读两遍**（一遍在根下无效地读，一遍在属主仓下正确地读）。
- **判据**：`--repo sdkwork-birdcoder2` 通过（exit 0）、`--workspace .` 报 255，二者唯一差异就是仓库枚举 ⇒ 锁定工作区根。
- **修法**：`walkFiles` 新增 `options.skipDirs`；gate 用 `nestedRepositoryRoots(root, repoRoots)` 跳过其直接子仓库根，
  使**每个仓库工作树只被遍历一次、且只用它自己的忽略规则**。
- **实测**：2m22s → **1m13s**；舰队全量 12 → **0**、`exit 0`、1m0.8s。

### 8.4 `sdkwork-im` 索引卫生：忽略规则与舰队标准／自身声明冲突

| 测项 | 数值 |
| --- | --- |
| `git ls-files -i -c --exclude-standard`（被规则忽略却仍被跟踪） | **5382**（`sdks/` 5019、`apps/` 271、`bin/` 57、`.zcode/` 33） |
| `git ls-tree -r HEAD` 对这些分组 | **全部为 0**（唯一提交 `08418d2` 不含它们） |
| 结论 | 提交后一次整批 `git add -A/-f` **击穿了所有忽略规则** ⇒ 属**意外索引噪声**，不是提交决策 |

**两处 `.gitignore` 规则本身是错的（已删）：**

- **`/bin/`（原第 126 行）**：与 `MODULE_BIN_SPEC.md` §2 直接矛盾——仓库根 `bin/` 是模块的**规范入口目录**
  （实测含 `build/doctor/backup/apps-build/apps-deploy/…` 69 个条目 + `bin/lib` 共享库 + `bin/container`，
  `chat-cli`/`chat-window` 均有 §2.2 要求的同干 `.sh/.ps1/.cmd` 伴生）。规范中**没有任何**要求忽略 `bin/` 的条文，
  `bin/` 内也**无任何**二进制产物。留着它 ⇒ 规范入口永远无法通过正常 git 流程提交。
  舰队抽样：`/bin/` 标记率 **6/8**（`sdkwork-agents`、`sdkwork-ui` 无此规则）⇒ 这是**普遍性**技术债，非 im 独有。
- **`sdks/**/generated/`（原第 134 行）**：`AGENTS.md` 把 `sdks/` 定义为"SDK 家族、OpenAPI authority、路由清单**及生成 SDK 产物**"；
  `SDK_WORKSPACE_GENERATION_SPEC.md` 第 282/386 行**明确规范"已提交的 `generated/server-openapi` 产物"**；
  舰队实测 **7/9** 仓（agents 537、community 602、cloudrouter 4386、order 156、drive 1009、iam 1091、assets 234）
  HEAD 里都有该类文件 ⇒ 忽略规则是错的一侧。

**已取消暂存**（`git rm --cached`，文件全部保留在磁盘）：`apps/*/types/siblings` **260**（本地 codegen，规则保留）、
`.zcode/` **34**、`apps/sdkwork-im-h5/.env.{cloud,standalone}.*` **8**（`.env.*` 由第 16 行忽略、`.env.*.example` 才是提交模板；
经查内容**无凭据**，仅 `VITE_*` 公开变量）、`scripts/dev/_tmp-agent-test.mjs` **1**。5382 → **3**。

**文档与规则对齐**：两个 app 的 `tsconfig.json` 原写"**The snapshots are committed**"，与 `.gitignore` 直接冲突，
已改为"generated locally and git-ignored (`**/types/siblings/`)"。

**未动（留决策）**：`apps/sdkwork-im-flutter-mobile/**/lib/l10n/generated/*.dart` ×3——被 `**/lib/l10n/generated/` 忽略却已跟踪，
但 Flutter 构建期可能依赖其存在，需产品侧决定"提交生成物"还是"构建前生成"。

### 8.5 本轮新增的标准缺口

`MODULE_BIN_SPEC` / `SDKWORK_WORKSPACE_SPEC` **没有**任何门禁检查"模块 `.gitignore` 是否与舰队标准一致"。
于是模块可以一边用忽略规则把 `bin/` 规范入口、`sdks/**/generated/` 生成产物挡在提交之外，一边**不触发任何门禁**——
舰队 `/bin/` 标记率 6/8 即此缺口在舰队尺度上的证据。建议补一条 `check:gitignore-standard`（或并入既有门禁）。

### 8.6 环境注意

- `.gitignore` 与两个 `tsconfig.json` 均为 **CRLF**：行级改动用 `split(/\r?\n/)` + 探测 eol 回写；Edit 直接匹配会失配。
- `sdkwork-im` 执行 `git diff` 报 `fatal: unable to read <sha>` ⇒ 该整批索引里**有对象缺失**，索引本身不健康。
- `git -C /e/sdkwork-space/...` 会触发 MSYS 路径改写而失败（`cannot change to '/e/...'`）；舰队循环里必须用 `cd`。

## 9. 第五轮：`check:database-initialization` 的判据缺陷与收口（2026-09-11 续）

本轮处理 `check:database-initialization`（矩阵时刻仍红）。结论是**门禁侧有缺陷**，不是 51 个模块有缺陷。
门禁从 `Modules 70 / Pass 9 / Fail 61` 收敛到 **`Pass 62 / Fail 8`**（9 条的下降全部来自删除伪判据 + 官方对齐器，无一条来自削弱真实断言）。

### 9.1 缺陷本质：门禁执行了一套**规范里不存在的教义**

`tools/verify-database-initialization-state.mjs` 强制三件事，而这三件事的术语在**整个规范集里出现 0 次**：

| 门禁断言 | 在 `sdkwork-specs/*.md` 的出现次数 |
| --- | --- |
| `## Initialization state`（README 必需章节） | `Initialization state` = **0** |
| `migration-debt`（`migrations/<engine>/*.sql` 存在即债） | `migration-debt` = **0** |
| retired stub（补充基线不得含 `CREATE TABLE`） | `retired stub` = **0** |

即 `I18N_SPEC §16.2` 式缺陷：**占据契约位、却在执行规范未授权的规则**。§8.1/§8.3 已两度记录同类，这是第三次。

### 9.2 形式化矛盾证明：`migrations-only` 在两个门禁间**不可满足**

`DATABASE_FRAMEWORK_SPEC.md` §6.1 明确声明三选一的 `baselineStrategy`。两个门禁合取后：

- **门禁 A** `check-database-framework-standard.mjs:461-465`
  `migrations-only` ⇒ 必须有 ≥1 个 `.up.sql`（此时**不要求**基线）；`baseline-plus-migrations|baseline-only-dev` ⇒ 必须有基线。
- **门禁 B** `verify-database-initialization-state.mjs`
  必须 `baselineStrategy === 'baseline-plus-migrations'`；且 `migrations/<engine>/*.sql` **任一存在即债**；且必须有基线。

于是对任一必须同时通过两门禁的模块，可行集只剩 `{strategy=baseline-plus-migrations, |baseline|=1, |migrations|=0}`。
`migrations-only` 成为**死策略**：声明它 → 门禁 B 判错；为满足 A 放一个迁移 → 门禁 B 判为 debt。
`baseline-only-dev` 同理被判错。**三选一的规范 + 只允许一种的门禁 = 规范自相矛盾。**

`grep -n "may be empty" DATABASE_FRAMEWORK_SPEC.md` §6.1 原文为 *"Post-baseline migrations **may be empty** until the contract evolves"*——**允许**为空，不是**必须**为空。门禁把许可读成了禁止。

### 9.3 实测反驳：迁移不是债，其中 4 个仓**删了会丢 schema**

对全舰队 51 个含迁移的仓做「迁移效果是否已在基线中」的逐列测量（`.workbuddy/scratch/migration-overlap.mjs`，
按 `ALTER TABLE … ADD COLUMN` 目标逐表在基线 `CREATE TABLE` 体内比对）：

| 判定 | 仓数 | 含义 |
| --- | --- | --- |
| `fully-folded` | **45** | 所有目标列都已存在于基线 ⇒ 对全新安装是幂等重放，但**仍是既有部署的升级路径** |
| `partial` | **4** | 部分目标列**不在**基线中 ⇒ 删除/折叠即丢 schema |
| `no-add-column` | 2 | 迁移不使用 `ADD COLUMN` |

`partial` 的 4 个仓（`sdkwork-im` / `sdkwork-appstore` / `sdkwork-cloudrouter` / `sdkwork-order`）**不可机械折叠**。
硬证据（`sdkwork-im`）：迁移 `0002_im_notification_tasks_worker_columns.up.sql` 添加
`im_notification_tasks.attempt_count` 与 `.available_at`，而基线中该表**既无这两个列**——直接删除迁移即丢列。

> 注：我第一版的 awk 范围匹配给全表都返回了 `orgNotNull=0`（错误的"全冗余"结论）。
> 直接 `grep -c "organization_id .*NOT NULL"` 基线得 57 次命中，说明 awk 范围判据失效。
> **教训：范围抽取必须用括号配平或逐表 `grep` 交叉验证，不能用 `awk '/start/,/end/'`。**

### 9.4 权威展开点：ADR/MIG 明确要求"用迁移实现"

- `ADR-20260724`：*"Production migrations are forward-first."*；*"Organization-scoped tables carry both `tenant_id` and `organization_id`"*。
- `MIG-2026-0724` §12（迁移序列第 12 步）：**"Add missing `tenant_id`/`organization_id` fields and indexes *through reviewed expand-contract migrations*."**
- 同文 §69：*"Empty bootstrap **and supported-version upgrade migration** pass on real PostgreSQL."*
- `DATABASE_FRAMEWORK_SPEC.md` §7.4：*"…`MUST` be repaired with a reviewed forward migration… **deleting lifecycle history**…is forbidden."*
- 同文 §7.1/§7.2/§7.3：迁移是**一等产物**，有命名、元数据头、checksum 不可变契约。
- 同文 §5.1：*"Crate-local `migrations/` directories `MUST` migrate **into** `database/migrations/`"*——迁移是**归集目标**，不是债。

即全舰队 43 个同名 `0001_organization_id_not_null.up.sql` 正是 `MIG-2026-0724 §12` 的**规定实现**，且其头部带完整 §7.2 元数据。
门禁把它们全部判为 debt，与 ADR/MIG/§7 三处权威**同时**冲突。

### 9.5 收口动作（两侧都改，未削弱任一真实断言）

**规范补全** `DATABASE_FRAMEWORK_SPEC.md`（+约 40 行）：

1. 新增 **§7.5 Initialization State And Baseline Consolidation**：定义"初始化状态"= 资产**集合**性质而非"迁移树为空"；
   固化 `ddl/baseline/postgres/0001_<moduleId>_baseline.sql` 唯一主基线；`migrations-only` **不得**被要求有基线；
   补充基线必须是 retired stub；**明确保留** post-baseline 迁移（§7.3/§7.4 禁止删历史）；给出**收敛后的债清单**五个码
   （`loose-migration` / `engine-mismatch` / `missing-metadata` / `competing-baseline` / `undocumented-state`）；
   并写明 *"The presence of an ordered `migrations/postgres/*.up.sql` file is **not** by itself initialization-state debt."*
2. §5.1 README 规则：加入 `## Initialization state` 章节要求（使门禁的 README 断言**有据**）。
3. §6.4：写明 `localeSets` 必须覆盖 `activeLocales` 每个语言；无内容的活动语言以**空 `files` 数组**声明；
   并锁定 `database.manifest.json#lifecycle.activeSeedLocales` ≡ `seed.manifest.json#activeLocales`
   （实测 69 个模块 **0 不一致** ⇒ 记录既成事实，非新增负担）。
4. §7.1：写明"带 `.down.sql` 的迁移必须声明 `reversible: true` + `rollback: down-migration`"（补上原本只是隐含的规则）。
5. §12：写明 `db:materialize:contract` **必须**物化本仓规范基线、**不得**委派到另一仓的数据库根。
6. §17 清单增一条 §7.5 校验项。

**门禁收窄** `tools/verify-database-initialization-state.mjs`：

- 删除「`migrations/<engine>/**/*.sql` 存在即 debt」的**无条件**循环（这是 138 条伪 find 的来源）。
- 策略断言由「必须 `baseline-plus-migrations`」改为「必须是三选一之一」，并派生 `requiresBaseline`；
  基线的命名/唯一性/大小/retired-stub 检查**仅在 `requiresBaseline` 时执行**。
- **以真实断言替换**被删的判据（不是留空）：§7.1 的版本前缀可排序性、同版本歧义、孤立 `.down.sql`。
  实测全舰队 **0 命中** ⇒ 证明替换判据本身不过严。
- `db:materialize:contract` 的「脚本字符串必须含规范路径」改为「**要么**字面命名规范基线、**要么**本仓自带物化器
  （`tools/`/`scripts/`）」——原来的代理断言对**动态解析路径的正确实现不可满足**，且对委派到他仓的真实缺陷反而漏报。

**模块对齐**：运行官方 `tools/align-database-framework-workspace.mjs --workspace .`（19 仓、74 处改动），
修掉 `localeSets` 集群（17 仓）与占位 README/registry。该器**不**改 `package.json`，故 `db:*` 脚本缺口仍需人工。

### 9.6 结果

| 指标 | 收口前 | 收口后 |
| --- | --- | --- |
| `Pass` | 9 | **62** |
| `Fail` | 61 | **8** |
| `migration-debt` 伪 find | 138 | **0** |
| 含迁移的仓被判错 | 51 | **0** |

`check:database-bootstrap-references` 复跑仍 **PASS**。

### 9.7 剩余 8 个失败模块（全部为**真实模块缺口**，非规范缺陷）

| 仓 | 条数 | 性质 |
| --- | --- | --- |
| `sdkwork-drama` | 15 | 半标准化：缺 `db:materialize:contract`、seeds 全套、两个 registry、README 章节、契约测试 |
| `sdkwork-agentstudio` | 11 | `databaseRole` 非 authoritative-server、`engines` 非 `[postgres]`、无基线 ⇒ **分类未完成** |
| `sdkwork-documents` | 8 | `schemaVersion` 仍为 1、缺 seed manifest/registry/schema 字段 |
| `sdkwork-video-cut` | 4 | 同 agentstudio 形态（分类未完成） |
| `sdkwork-feeds` | 3 | README 缺 `## Initialization state` 与 `db:validate` |
| `sdkwork-iam` | 3 | 3 个 `.down.sql` 的配对元数据矛盾（须走 §7.2 历史元数据侧车，**不得**改写已跟踪迁移） |
| `sdkwork-appbase` | 1 | `db:materialize:contract` 委派到 `../sdkwork-iam` ⇒ 实际物化的是 **IAM 的**契约（真实缺陷） |
| `sdkwork-company` | 1 | 缺 `tests/contract/database-framework.contract.test.mjs` |

### 9.8 方法教训（可复用）

1. **门禁判错时的第一动作**：把它的断言关键词拿去规范集里 `grep -c`。**0 命中**即"执行未授权规则"的铁证，比读散文争论快得多。
2. **先证明"另一侧也不可满足"**：`migrations-only` 的两门禁合取不可满足，是把"门禁过严"从观点变成证明的关键。
3. **用实测量化危害**：45/4/2 的三分类直接决定了"不可机械折叠"，避免了按门禁机械删除而丢 schema。
4. **替换而非删除**：删掉伪判据时必须补上同域的真实断言，并用全舰队 0 命中自证新断言不过严。
5. **代理断言的边界**：断言"脚本文本含某路径"这种**实现细节代理**，对动态解析的正确实现不可满足、对委派他仓的缺陷反而漏报——两边都错。


---

## 10. 第六轮：契约门禁收口与一次**数据丢失缺陷**的拦截（2026-09-11 续）

第 9 轮留下的 8 个失败模块中，`documents`、`drama`、`agentstudio` 三个被本轮清零。过程中发现两类此前未知的缺陷：一类是**门禁执行了规范里不存在的规则**（同 §9.1 形态的第 7 例），另一类是**对齐工具会删除穿过 junction/symlink 抵达的权威源**——后者若先落地，破坏性远大于任何契约不合规。

### 10.1 结果总览

| 门禁 | 轮初 | 轮末 | 说明 |
| --- | --- | --- | --- |
| `check:database-initialization` | 70 / 67 / **3** | 70 / **70** / **0** | §10.2 §10.3 §10.4 |
| `check:cors-standard`（carrier 缺陷） | 10 | **0** | `sdkwork-agents` 10 份 topology env 白名单 |
| `check:packages-layout` | 4 | **3** | `agentstudio` 安全收口；余 3 条全属 `birdcoder2`（owner 决策） |
| `check:rust-crate-naming-standard`（error） | 7 | **4** | `sdkwork-tts/Cargo.toml` 真构建断裂已修；余 4 条全在 vendor 子树 |

`check-database-framework-standard.test.mjs`：**pass 1 / fail 0**（714 → 约 820 行，新增 5 个用例）。

### 10.2 `documents`：陈旧且**非幂等**的生成器（根因，而非表面 8 条）

8 条缺失字段只是症状。根因是 `sdkwork-documents/tools/materialize_phase1_contracts.mjs`——它仍被 `_sdkwork:verify` 调用、且**未被 gitignore**，每次运行都会把仓库拉回 phase-1 形态：

- `database.manifest.json` 写回 `schemaVersion: 1`、`engines: ["postgres","sqlite"]`、`autoMigrate: true`、`activeSeedLocales: ["zh-CN"]`，并抹掉 `databaseRole`；
- `contract/schema.yaml` 重新追加 `- sqlite`；
- 重写 `sdks/**` 清单、向 `docs/schema-registry/` 追加行。

这些产物与已提交的 `standardize-documents-sdk-family.mjs` 形状**从不一致**，于是"门禁红 → 跑 verify → 更红"。

**收口**：修生成器（v2 清单、`engines: [postgres]`、`autoMigrate: false`、`databaseRole`、`activeSeedLocales: ["zh-CN","en-US"]`、`schema.yaml#database_role`、registry 的 `kind` / canonical `table_name`+`owner`+`compliance_level`+`lifecycle_status`、seed manifest 的 `i18nVersion`/`fallbackLocale`/`localeSets`（用 `sha256:4f53cda1…` 即 `[]` 的 sha256 作空集校验和）、README 的 `## Initialization state` 与 `## Related specifications`）；用 `git checkout` 恢复 `sdks/` 与 `docs/schema-registry/` 全部连带污染。

### 10.3 标准缺口收口：§6.1 多前缀家族与 `activeSeedLocales`

门禁**已在执行**一条规范集里**零命中**的规则：`tablePrefixes`（多前缀家族）与 `modules`（多模块 root）。按 §9.8 第 1 条，这是"执行未授权规则"的第 7 例。

**两侧都改**：

1. **规范补齐**（`DATABASE_FRAMEWORK_SPEC.md`）：
   - §1 前缀规则同时点名 `tablePrefixes`；
   - §6.1 新增 "Single-prefix, multi-prefix, and multi-module roots" 块——单家族用 `tablePrefix`；多家族用 `tablePrefixes` 且 `[0]` 为主前缀；两者 `MUST NOT` 并存；皆无 ⇒ 不属 ownership-scoped；主前缀 `MUST` 等于 `schema.yaml#table_prefix`；registry `MUST` 登记**每一个**家族；单模块 root 的 `modules` 为 `[]`；
   - §6.1 新增 `authoritative-server MUST declare lifecycle.activeSeedLocales as a non-empty array`。
2. **实现收紧**（`check-database-framework-standard.mjs`）：`declaredManifestPrefixes()` 统一取前缀集合；改"只校验主前缀"为"登记每一个声明前缀"；新增"无前缀"与"两形式并存"两条拒绝；`activeSeedLocales` 断言落在 `validateDatabaseModuleLayout`（与 `autoMigrate` 同处，**不在** `validateDatabaseModuleContract`）；`L2_DB_SCRIPTS` → `AUTHORITATIVE_DB_SCRIPTS`。

**先量后改**：新规则实施前实测全舰队影响面——`activeSeedLocales ≡ activeLocales` 在 69 个模块上**0 不一致**，多前缀家族 **0 例外**。即两条新 `MUST` 都是**把既成事实写下来**，不是新增负担。

### 10.4 `drama`：前向改名（用户选定策略）

`drama` 的 15 条源于"半标准化"：`database/` 下的表名未带模块前缀，且全套契约件缺失。三条路（改写 `0001` / 前向改名 / 暂缓）中，**用户选择前向改名**——保留数据、`0001` 逐字节不动。

落地：`database/migrations/postgres/0002_drama_prefix_tables.up.sql`（3 条 `ALTER TABLE … RENAME TO` + 3 条 `ALTER INDEX … RENAME TO`，`IF EXISTS`/`IF NOT EXISTS` 幂等）+ 配对 `.down.sql` 记录无损回退；`metadata.json` 增 `0002` 条目（`reversible: true`、`rollback: down-migration`、`transactional: true`、`lock: access-exclusive-rename`、超时）；`tablePrefix: "drama_"`；补齐 lifecycle、seed 校验和（`sha256:template` → 真实哈希）、README 的 `## Initialization state`、`db:materialize:contract`（来源改为 `--migrations database/migrations/postgres`）；源码 8 处 SQL 引用改名（episode/media 两个 sqlx 仓）；`TECH_ARCHITECTURE.md` 与 crate `specs/README.md` 表名同步。

**顺带修好物化器**：原物化器只解析 `CREATE TABLE`，对"只含 RENAME 的迁移"会物化出**改名前的旧表名**。改为**重放解析**——`CREATE` 入栈、`RENAME` 按稳定版本序原位替换、`DROP` 移除：

```js
const statement = /CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z0-9_]+)|ALTER TABLE(?: IF EXISTS)?\s+([a-z0-9_]+)\s+RENAME TO\s+([a-z0-9_]+)|DROP TABLE(?: IF EXISTS)?\s+([a-z0-9_]+)/gi;
```

重生成后校验：作者手写的 `compliance_level: L3`、`id_strategy`、`subject_columns`、`compliance` 头键**全部保留**。

### 10.5 `agentstudio`：**穿 junction 删除会删掉权威源**（本轮最高危）

`sdkwork-agentstudio/packages` 不是目录，是一个指向 `apps/sdkwork-agentstudio-pc/packages` 的 **junction**。对齐器原来的重复清理是 `fs.rmSync(move.fromAbsolute, { recursive: true, force: true })`——通过 junction 递归删除，删掉的是**规范目标（1666 文件权威源）**，并留下断链。

路径校验也确实"看起来通过"过：第一次探针碰巧该路径是指向**同一目录**的 junction，所以看不出异常。后用显式创建的 junction 重跑，才实证破坏行为。

**三处修复**（缺一不可）：

1. **门禁分类**（`lib/packages-layout-patterns.mjs`）：新增 `isRepositoryRootPackagesSymlink()`（用 `fs.lstatSync().isSymbolicLink()`，**不用** `statSync`——后者跟随链接），`forbidden-repo-root-packages` 拆成 `legacy-packages-symlink`（处方是 **unlink**，永不可穿链删除）与原 kind。
2. **对齐器**（`lib/align-packages-layout.mjs`）：`alignRepositoryPackagesLayout` 在 `collectLegacyPackageMoves` 之前，对 `new Set(['packages', ...LEGACY_REPO_PACKAGE_FAMILIES])` 中的链接**只解链**；新增 `isSymbolicLinkPath()` 与 `treesAreIdentical()`（`DUPLICATE_COMPARE_IGNORED_DIRS = {node_modules, dist, target, .turbo, .cache, .next, coverage}`）双重护栏——内容不一致时**报告而非删除**：

   ```js
   if (fs.existsSync(move.toAbsolute)) {
     if (!treesAreIdentical(move.fromAbsolute, move.toAbsolute)) {
       actions.push(`keep legacy source, content differs: ${move.from} (reconcile with ${move.to} before removing)`);
       continue;
     }
     if (!dryRun) fs.rmSync(move.fromAbsolute, { recursive: true, force: true });
     actions.push(`remove legacy duplicate source: ${move.from}`);
   }
   ```
   并给 `collectLegacyFamilyPackageMoves`、`collectLegacyPackageMoves`（repo-root 分支）、`removeOrphanPackageDirectories`、`removeEmptyLegacyDirectories` **每个递归删除点**都加上 `isSymbolicLinkPath` 跳过。
3. **规范**（`DATABASE_FRAMEWORK_SPEC.md` §5.2 布局）：写入规则——仓库根的 `packages/` 式**兼容链接** `MUST` 以**解链链接本身**的方式移除，且 `MUST NOT` 被任何生命周期／打包／清理命令遍历。

**落地结果**：解链该 junction，移除 1661 条陈旧索引路径，校验 `apps/sdkwork-agentstudio-pc/packages` 的 1666 文件权威树**完整无损**；应用后 `apps/` 下 0 变更。

### 10.6 其余增量

- **`check:cors-standard` 10 → 0**：`sdkwork-agents` 的 10 份 `etc/topology/*.env` 白名单为空，对齐器改写为 134/136/70 origins。余 10 条仅为"无聚合脚本"WARN（非阻塞）。
- **`sdkwork-tts/Cargo.toml`**：`[workspace.dependencies]` 缺 `sdkwork-web-core`、`sdkwork-web-bootstrap` 路径项——真构建断裂。补齐后 `cargo metadata` 可解析。
- **`link.exe` 环境限制**：Git Bash 的 `link.exe` 会遮蔽 MSVC 链接器，第三方 crate 的 build-script 链接失败。改用**无链接器**校验器：`rustfmt --check`（exit 0）、`cargo metadata --no-deps`（exit 0）。

### 10.7 方法教训（本轮新增）

1. **写必验**：`Edit` 报 "Successfully edited" 但磁盘无变化，本轮命中两次（`L2_DB_SCRIPTS` 改名、`activeSeedLocales` 收紧）。**每次写入后立即 `grep` 自证落地**，不要信任工具回执。
2. **递归删除点必须过 `lstat`**：`statSync` 跟随链接 ⇒ 判不出符号链接；凡"删目录"的路径都要 `lstatSync().isSymbolicLink()` 前置守卫，否则可能删掉权威源。
3. **探针的陷阱**：当"被删目标"与"链接目标"是同一目录时，破坏性探针会**假通过**。验证破坏性行为必须构造**目标不同**的夹具。
4. **陈旧生成器的识别口径**：被 verify 调用 + 未 gitignore + 产物与权威生成器形状不一致 ⇒ 它会周期性把仓库拉回旧形态；此时修门禁无用，必须先修或废掉生成器。
5. **先量后改的纪律**：新 `MUST` 落地前先测全舰队影响面（本轮两条新规则均实测 0 冲击），避免把"记录既成事实"做成"制造新债"。

### 10.8 遗留 owner 决策（本轮不擅自处置）

1. **`sdkwork-birdcoder2`**（package-layout 余 3 条全在此）：须声明 `repository-kind: application`，把 6241 文件从仓库根 `packages/` 迁出，并修 `pnpm-workspace.yaml` 的 glob。其 README 仍为上游品牌（`# DeepSeek Harness`、`dsh`）——是**架构归属 + 品牌**决策，非机械对齐。
2. **4 条 `rust.package-name-case`**：`sdkwork-mail`（`mail_sdk`、`Mail-sdk-provider-imap`、`Mail-sdk-provider-smtp`）与 `sdkwork-rtc`（`rtc_sdk`），**全在 vendor 的三方 SDK 子树**（`sdks/**/sdkwork-*-sdk-rust/`）。改名会破坏 vendor 契约，建议以 vendor 白名单豁免而非改写。
