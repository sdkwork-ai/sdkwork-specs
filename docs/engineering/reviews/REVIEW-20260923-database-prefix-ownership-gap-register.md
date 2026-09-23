# REVIEW-20260923 — 数据库前缀归属差距登记（DATABASE_SPEC §7 / §29，DB061–DB069）

Owner: sdkwork-platform ｜ Status: open（P0 第一条已处置，其余待裁决）
触发事件：`sdkwork-webserver` 启动失败 —— `selected API assembly \`sdkwork-mcp\` is unavailable (code 50301)`。

## 1. 触发事件与因果链（逐环有证据）

| 环 | 事实 | 证据位置 |
| --- | --- | --- |
| 1 | `ai_mcp_` **未登记**在 `tools/database-module-registry.json` ⇒ 该前缀没有归属权威 | 修复前门禁输出 `F1_UNREGISTERED_PREFIX ai_mcp_` |
| 2 | 兄弟仓 `sdkwork-cloudrouter` 的迁移 0041 用 `CREATE TABLE IF NOT EXISTS` 建了 4 张 `ai_mcp_*` 表（cloudrouter 形态） | `sdkwork-cloudrouter/database/migrations/postgres/0041_ai_mcp_registry_and_gateway_membership.up.sql:22,54,93,131` |
| 3 | 迁移 0042 退役 cloudrouter 的 ai-mcp registry，**故意留下** `ai_mcp_server`/`ai_mcp_tool`（其头注释称这两张属于 `sdkwork-mcp`） | `0042_retire_ai_mcp_runtime_registry.up.sql:5-29,48-55` |
| 4 | 2026-09-23 20:47:43 cloudrouter 全量迁移落库 ⇒ 活库留下 **cloudrouter 形态**的 `ai_mcp_server`（29 列：`status`/`latest_revision_id`/`published_revision_id`/`metadata`/`tags`，无 `latest_connector_id`） | `ops_schema_migration_history` + `information_schema.columns` |
| 5 | mcp 网关启动：`baselineAnchorTable = ai_mcp_server` **纯按名字命中** ⇒ 整份 mcp baseline 被跳过，却写入 `ops_database_installation_state.mcp = bootstrapped` | `sdkwork-database/crates/sdkwork-database-lifecycle/src/orchestrator.rs:82-140,433-499` |
| 6 | `migrate()` 执行 `0001_organization_id_not_null.up.sql` 的 `ALTER TABLE ai_mcp_server_category` ⇒ `relation does not exist` | `sdkwork-mcp/database/migrations/postgres/0001_organization_id_not_null.up.sql:24` |

**违反条款**：§7「`<module_prefix>` MUST be a registered business module or bounded-context prefix」；
DB061（首段须为已登记模块前缀）；DB064（前缀必须登记 owner / bounded context / 示例表）；
**DB065（跨模块共享表使用 source-of-record 模块前缀）**；**DB067（多实体契约映射同一物理表须有共享语义证明或冲突整改）**；
§29「Register module prefixes and ownership before creating tables」。

**订正记录（不可就地改 0042 的原因）**：迁移文件校验和覆盖**全文含注释**
（`DATABASE_FRAMEWORK_SPEC.md:563`；`orchestrator.rs` 的 `file_checksum(&migration.up_path)`），
且 0042 已在活库应用 ⇒ 改注释会触发 `checksum_mismatch`。故本文件的第 3 环订正即为其法定记录：
**0042 头注释对活库形态的断言（"live `ai_mcp_server` carries `latest_connector_id` …"）与实测相反**，
实测那张是 cloudrouter 形态；该注释会误导后续修库者，需在下一轮 forward-fix 时于新迁移的 `purpose` 里一并澄清。

## 2. 复现与计数方法

```bash
# 现成门禁（F1–F4），零依赖、只读
node sdkwork-webserver/scripts/check-database-prefix-ownership.mjs --workspace D:/sdkwork-space [--json]
# 本轮补算 F5（登记了但无人声明）、F6（moduleId 重名）：见 §3 计数脚注
```

工作区规模：`registeredPrefixes = 34`（本次登记 mcp 前为 33）、`reposWithPrefixRegistry = 68`。

## 3. 现状计数（2026-09-23 22:0x，登记 mcp 之后）

| 类 | 含义 | 条数 |
| --- | --- | --- |
| F1 | 仓声明了注册表里没有的前缀 | **34** |
| F2 | 同一前缀被 ≥2 个仓声明 | **4**（`ai_`×5、`commerce_`×6、`game_`×2、`platform_`×2） |
| F3 | 仓声明的前缀在注册表里归属**另一个仓** | **1**（`iam_`） |
| F4 | 同一张表被 ≥2 个仓的 table-registry 声明 | **2**（`game_catalog`、`game_room`） |
| F5 | 注册表登记的前缀**没有任何仓声明**（陈旧登记） | **7**（`birdcoder_`、`cloud_`、`drive_`、`generations_`、`memory_`、`videocut_`、`aiot_`） |
| F6 | 两个仓声明**同一个 moduleId** | **1**（`games` = sdkwork-gameengine + sdkwork-games） |

> 修复前 F1 为 35（含 `ai_mcp_`），修复后 34 ⇒ 现成门禁 findings 42 → 41。

## 4. 分级与处置

### P0-a 已处置：登记 `ai_mcp_`

`tools/database-module-registry.json` 新增（字段由 `sdkwork-mcp/database/database.manifest.json` 派生，非猜测）：

```json
{ "repo": "sdkwork-mcp", "moduleId": "mcp", "serviceCode": "MCP", "tablePrefix": "ai_mcp_",
  "ownerTeam": "mcp-platform", "engines": ["postgres"],
  "legacySqlGlobs": ["database/ddl/baseline/postgres/0001_mcp_baseline.sql"] }
```

验收：`check-database-prefix-ownership.mjs` 中 `ai_mcp_` 命中数 **0**；`sdkwork-mcp` 的
`check-database-framework-standard.mjs --root .` → `Database framework standard passed`。

### P0-b 待裁决：`game_` 双仓 + `games` moduleId 重名（**同事故机制的潜在雷，尚未引爆**）

- `sdkwork-gameengine` 与 `sdkwork-games` **同声明** `moduleId=games`、前缀 `game_`、表 `game_catalog`/`game_room`；
  两者的锚表回退值（manifest 无 `baselineAnchorTable` ⇒ 取 table-registry 首表）**都是 `game_catalog`**。
  ⇒ 一旦两个仓指向同一个 PostgreSQL database module，先跑者建 `game_catalog`，后跑者锚表命中 ⇒
  **整份 baseline 被跳过 + 写假 `bootstrapped`**，与 mcp 事故逐条同构。
- 尚**未引爆**的判据（2026-09-23 实测）：活库无 `game_*` 表；`ops_schema_migration_history` /
  `ops_database_installation_state` 均无 `games` 行。
- 且 `sdkwork-games` **没有 postgres baseline**（只有 `tests/fixtures/database/sqlite/...`），
  其 authoritative-server 路径本身不完整。
- **需要裁决**：`games` 的 source-of-record 是哪个仓？另一仓应退役还是改用自有前缀（DB065/DB067）。

### P1：`ai_` 五仓共用通用前缀（本次事故的**使能条件**）

| 仓 | 声明前缀 | 实际 `ai_*` 表数 |
| --- | --- | --- |
| sdkwork-cloudrouter | `ai_`, `iam_user_`, `integration_` | 36（`ai_chat_`/`ai_upstream_`/`ai_metering_`/`ai_routing_`… 共 11 族） |
| sdkwork-agents | `ai_` | 30（全部 `ai_agent*`） |
| sdkwork-memory | `ai_` | 28（`ai_space`/`ai_event`/`ai_record`…） |
| sdkwork-models | `ai_` | 22（`ai_model_vendor`/`ai_modality`/`ai_api_endpoint`…） |
| sdkwork-prompts | `ai_` | 6（全部 `ai_prompt*`） |

- 表名**无实际撞车**（F4 未报任何 `ai_*`），冲突只在**前缀声明**层；但 `ai_ ⊃ ai_mcp_` 这种
  **super-prefix 覆盖**正是 0041 能被写出并通过本地 `db:validate` 的使能条件。
- §7：「Existing project-level prefixes may be registered only as L0 migration facts. New/pre-launch tables
  MUST NOT keep them.」⇒ 属遗留事实，**不得** rename（§29「do not rename physical tables without a separate plan」）。
- **需要裁决**：选 A（各仓改用自有的有界上下文前缀 + 分区迁移计划）或 B（承认 `ai_` 为共享命名空间，
  在注册表里按**子族**登记为 L0 事实：`ai_agent_`→agents、`ai_prompt_`→prompts 可直接分区；
  cloudrouter/memory/models 的表族无单一共同子前缀，B 方案对它们不成立）。**推荐 A，但按模块分批**。

### P1：`commerce_` 六仓共用（同 F2 类，未做逐表比对）

`sdkwork-inventory`、`sdkwork-invoice`、`sdkwork-merchandise`、`sdkwork-order`、`sdkwork-payment`、
`sdkwork-shop` 同时声明 `commerce_`。**需先做一次与 §4-P1 同形的按表比对**（判定是仅声明重叠，还是 F4 级实撞），
再决定归属；本轮未做，列为待办。

### P1：`iam_` 归属不一致（F3）

注册表：`sdkwork-appbase | moduleId=iam | iam_`；而 `sdkwork-iam` 也声明 `iam_`（且 `sdkwork-appbase`
另有一个 `moduleId=base-data` 模块，前缀 `base_`）。⇒ 同为 IAM 的两套实现并存，权威归属不明。
**需要裁决**：`iam` 的 source-of-record 是 `sdkwork-iam` 还是 `sdkwork-appbase`（若是仓库改名，直接更新
`repo` 字段；若真是两套，按 DB065/DB067 整改）。

### P1：注册表陈旧登记（F5，7 条）

`birdcoder_`、`cloud_`、`drive_`、`generations_`、`memory_`、`videocut_`、`aiot_` 在注册表里是"权威"，
但**没有任何仓声明它们**；对应仓实际声明的是别的前缀（`cloudrouter`→`ai_`、`drive`→`dr_`、
`aiot`→`iot_`、`generations`→`generation_`、`memory`→`ai_`）。
⇒ 权威表的 1/5 与事实不符，"sole authority" 名存实亡。**需按模块逐个确认后更新**（不得批量覆盖）。

### P2：`platform_` 双仓（仅声明重叠，无事故机制）

`sdkwork-manager` 表集 `platform_manager_*`（3 张）、`sdkwork-portal` 表集 `platform_portal_*`（1 张），
互斥；锚表回退值分别为 `platform_manager_preference` / `platform_portal_preference`，**不同**
⇒ 不会触发锚表闸门故障。按 DB064 各自登记（`platform_manager_` / `platform_portal_`）即可。

### P2：其余 34 条 F1（机械可登记，但需 owner 复核）

本轮已算出**由各仓 manifest 派生**的候选条目 31 条（`acct_`/`canvas_`/`company_`/`documents_`/`ddz_`/
`dezhou_`/`drama_`/`dr_`/`feeds_`/`generation_`/`github_`/`iot_`/`llm_`/`log_`/`mail_`/`media_`/`membership_`/
`mj_`/`mk_`/`ops_`/`partner_`/`promotion_`/`sandbox_`/`skills_`/`stg_`/`studio_`/`xq_` +
cloudrouter 的 `iam_user_`/`integration_` 等）。**本轮未批量写入**，原因见 §5：
若不过 owner 复核就写，会把 §P1 的陈旧/冲突状态固化成"权威"。

## 5. 为什么本轮不再往下动手

- DB069：`MUST` — owner-review tables confirm system-of-record owner **before** target name approval；
  上列 P1 各条都是"两个仓都自称所有者"，没有 owner 裁决就不存在正确答案。
- §29：分类与优先级先于 rename；不得无计划改物理表名。
- 并行会话正在改 `sdkwork-cloudrouter` 的 `database/contract/prefix-registry.json` /
  `database.manifest.json` / `database/migrations/postgres/metadata.json`（工作树均 ` M`）⇒ 同文件改动会互相覆盖。

## 6. 并发的平台级缺陷：锚表闸门可被外部表"焊死"（建议按规范修正）

**机制**：`apply_baseline_if_needed_locked()` 只用
`information_schema.tables WHERE table_schema=$1 AND table_name=$2` 判 `baselineAnchorTable` 是否存在，
**不校验归属、不比对期望表集**；命中即 `Ok(0)` 跳过整份 baseline；随后 `init_locked()` **无条件**
写入 `installation_state = bootstrapped`；`migrate_locked()` 再走一遍同一闸门，
其中还有 `fetch_installation_state().is_some() ⇒ Ok(0)` 作为**第二道**闸。
⇒ 任何"外部仓先建了同名表"的情形都会让模块**永远装不上自己的 schema，且账本声称已装**。

**建议（三选一，需规范裁决）**：

1. **最小**：`init_locked()` 在 `apply_baseline_if_needed_locked()` 返回 `Ok(0)` 而
   `installation_state` 不存在时，**不得**写成 `bootstrapped`（写 `skip-baseline-unverified` 或直接 fail closed），
   使账本不再说谎。
2. **中**：锚表命中后追加**契约表集校验**（用 `contract/table-registry.json` 的 `tables` 与活库做集合包含），
   缺表即 fail closed 并指名缺哪些表 —— 把今天这种"启动期 `relation does not exist`"提前成一条可读诊断。
3. **强**：锚表命中时校验**已登记归属**（读 `tools/database-module-registry.json` 的 `tablePrefix` 与
   `contract/prefix-registry.json`），表名前缀不属于本模块即拒绝跳过。

配套：`check-database-prefix-ownership.mjs` 目前**刻意未进 `_sdkwork:check`**（见项目记忆），
建议至少在 DB 相关 CI 任务里挂上，否则本条只能靠人工巡检。

## 7. 验收与回归

```bash
# 归属门禁（登记 mcp 后应无 ai_mcp_ 命中）
node sdkwork-webserver/scripts/check-database-prefix-ownership.mjs --workspace D:/sdkwork-space
# 模块契约门禁
node sdkwork-specs/tools/check-database-framework-standard.mjs --root sdkwork-mcp
# 运行态（修复 mcp 事故后的实测结果）
cd sdkwork-webserver && (nohup pnpm dev > .workbuddy/tmp/dev-verify.log 2>&1 &)
#   → 3800/5182 = 200；日志含本次 management listener started；50301|drift|startup failed 计数 0
```

## 8. 待办清单（按上表顺序）

- [ ] P0-b：裁决 `games` 归属（并消除 `moduleId=games` 重名）
- [ ] P1：`ai_` 五仓方案选型（推荐 A，分批）
- [ ] P1：`commerce_` 六仓按表比对后归类
- [ ] P1：`iam_` 归属裁决（`sdkwork-iam` vs `sdkwork-appbase`）
- [ ] P1：F5 七条陈旧登记逐模块确认
- [ ] P2：`platform_` 双仓各自登记
- [ ] P2：其余 F1 逐模块 owner 复核后登记
- [ ] 平台侧：锚表闸门修正方案 1/2/3 选型
