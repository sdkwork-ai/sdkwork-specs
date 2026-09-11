#!/usr/bin/env node
/**
 * scaffold-module-runbooks.mjs — generate the OPERATIONS_SPEC.md §7 runbook
 * four-piece (deploy / troubleshooting / backup-restore / log-reference, zh+en)
 * under `docs/runbooks/` for every module that owns the standard `bin/` family.
 *
 * Content is aligned with the bin/ entrypoints (MODULE_BIN_SPEC.md §4) and
 * adapts to the module wiring state:
 *   - wired   (bin/lib/module.sh implements sdkwork_image_build): full usable runbooks
 *   - unwired (scaffold placeholder still in place): docker build/install sections
 *     carry an explicit prerequisite block; everything else stays copy-paste runnable.
 *
 * Existing runbook files are never overwritten unless --force.
 *
 * Usage:
 *   node tools/scaffold-module-runbooks.mjs --root <module-root> [--force]
 *   node tools/scaffold-module-runbooks.mjs --workspace <workspace-root> [--force]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let root = '';
let workspace = '';
let force = false;
let forceHandAuthored = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') root = args[++i];
  else if (args[i] === '--workspace') workspace = args[++i];
  else if (args[i] === '--force') force = true;
  else if (args[i] === '--force-hand-authored') forceHandAuthored = true;
  else if (args[i] === '-h' || args[i] === '--help') { usage(); process.exit(0); }
  else { usage(); process.exit(2); }
}
if (!root && !workspace) { usage(); process.exit(2); }

// Generated files carry this marker; a runbook without it is hand-authored and
// is never overwritten (--force refreshes generated files only).
const GENERATED_MARKER = '<!-- generated: scaffold-module-runbooks.mjs -->';

function usage() {
  console.error('usage: node tools/scaffold-module-runbooks.mjs --root <module-root> | --workspace <workspace-root> [--force] [--force-hand-authored]');
}

const ROOTS = [];
if (root) {
  ROOTS.push(path.resolve(root));
} else {
  for (const entry of fs.readdirSync(path.resolve(workspace), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('sdkwork-')) continue;
    if (entry.name === 'sdkwork-specs') continue;
    ROOTS.push(path.join(path.resolve(workspace), entry.name));
  }
}

// ---------------------------------------------------------------------------
// Fact extraction
// ---------------------------------------------------------------------------
function readModuleFacts(root) {
  const id = path.basename(root);
  const facts = {
    id,
    image: `${id}-standalone`,
    appTypes: 'server',
    primaryService: 'app',
    healthPath: '/healthz',
    version: '0.1.0',
    wired: false,
    hasBundle: false,
    assemblyOnly: false,
    containerInstall: false,
    standaloneDelivery: '',
    cloudDelivery: '',
  };
  const moduleSh = path.join(root, 'bin', 'lib', 'module.sh');
  if (fs.existsSync(moduleSh)) {
    const text = fs.readFileSync(moduleSh, 'utf8');
    const grab = (key) => {
      const m = text.match(new RegExp(`^${key}="([^"]*)"`, 'm'));
      return m ? m[1] : null;
    };
    facts.image = grab('SDKWORK_IMAGE_NAME') || facts.image;
    facts.appTypes = grab('SDKWORK_APP_TYPES') || facts.appTypes;
    facts.primaryService = grab('SDKWORK_PRIMARY_SERVICE') || facts.primaryService;
    facts.healthPath = grab('SDKWORK_HEALTH_PATH') || facts.healthPath;
    // A hook is wired when its body does not fail closed: both the scaffold
    // placeholder and the assembly-only note call sdkwork_die.
    const hook = text.match(/^sdkwork_image_build\(\)\s*\{([\s\S]*?)^\}/m);
    facts.wired = Boolean(hook) && !hook[1].includes('sdkwork_die');
    facts.assemblyOnly = Boolean(hook) && hook[1].includes('assembly-only');
  }
  const appConfig = path.join(root, 'sdkwork.app.config.json');
  if (fs.existsSync(appConfig)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(appConfig, 'utf8'));
      const v = cfg?.release?.currentVersion;
      if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) facts.version = v;
    } catch { /* keep default */ }
  }
  // The bundle exists when a target-side deploy executor exists
  // (MODULE_BIN_SPEC.md §2.2) together with its compose/env inputs. The
  // executor is authored flat in bin/ as docker-bundle-deploy.sh; the legacy
  // locations are still accepted so an un-migrated module is not reported as
  // missing its bundle.
  facts.hasBundle = [
    path.join(root, 'bin', 'docker-bundle-deploy.sh'),
    path.join(root, 'bin', 'bundle', 'deploy.sh'),
    path.join(root, 'deployments', 'docker', 'bundle', 'deploy.sh'),
    path.join(root, 'scripts', 'docker', 'bundle', 'deploy.sh'),
  ].some((candidate) => fs.existsSync(candidate));

  // Delivery posture (DEPLOYMENT_SPEC.md §deliveryKind). The deploy bundle
  // standardises the standalone *container* install path; a module whose
  // standalone profiles deliver host packages does not need one.
  const deployYaml = path.join(root, 'deployments', 'deploy.yaml');
  if (fs.existsSync(deployYaml)) {
    const text = fs.readFileSync(deployYaml, 'utf8');
    const blocks = [...text.matchAll(/^  ([a-z]+)\.([a-z]+):[\s\S]*?^      deliveryKind: ([\w-]+)$[\s\S]*?^      deploymentDriver: ([\w-]+)$/gm)];
    const byProfile = { standalone: new Set(), cloud: new Set() };
    for (const [, profile, , kind, driver] of blocks) {
      if (byProfile[profile]) byProfile[profile].add(`${kind}/${driver}`);
    }
    facts.standaloneDelivery = [...byProfile.standalone].sort().join(', ');
    facts.cloudDelivery = [...byProfile.cloud].sort().join(', ');
    facts.containerInstall =
      byProfile.standalone.size > 0 && [...byProfile.standalone].every((k) => k.startsWith('container-image/'));
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
function wiringBlockZh(f) {
  if (f.wired) {
    if (f.hasBundle) return '';
    if (!f.containerInstall) {
      const standalone = f.standaloneDelivery || 'host-package/host-service';
      const cloud = f.cloudDelivery || 'container-image/kubernetes';
      return `\n> ℹ️ **交付姿态**：本模块 standalone 交付为宿主包（\`${standalone}\`），cloud 交付为容器镜像（\`${cloud}\`）。\n> 本文档 §1 安装 / §2 升级描述的 bundle 容器安装路径（\`deployments/docker/bundle/\`）仅在该模块启用 standalone **容器**安装时适用；\n> 宿主包路径请使用 \`bin/apps-package.sh\` + \`bin/apps-pkg-installer.sh\`，cloud 路径由 kubernetes 编排消费 \`bin/docker-image.sh push\` 产出的镜像。\n`;
    }
    return `\n> ⚠️ 本模块镜像构建已接线，但 \`bin/docker-bundle-deploy.sh\` + \`bin/docker-bundle-release.sh\`（执行器，MODULE_BIN_SPEC.md §2.2）与 \`deployments/docker/bundle/\`（compose + env）尚未落地：\`install\`/\`upgrade\` 前需先补齐 bundle（参照 OPERATIONS_SPEC.md §1.2）。\n`;
  }
  if (f.assemblyOnly) {
    return `
> ℹ️ **模块形态**：本模块为 assembly-only（仅提供装配层 crate，不产出 standalone 服务端二进制），
> 因此镜像构建钩子按“不适用”标注并 fail-closed；若后续落地 standalone gateway 二进制，再按 MODULE_BIN_SPEC.md §4.1 接线。
> 本文档的 §1 安装 / §2 升级 章节在容器镜像产出前不可执行。
`;
  }
  return `
> ⚠️ **接线状态**：本模块的 \`bin/\` 九入口已按 MODULE_BIN_SPEC.md 挂载，但镜像构建钩子与部署 bundle 尚未接线：
> - \`bin/lib/module.sh\` → \`sdkwork_image_build\` 仍是脚手架占位（执行会以明确错误退出）；
> - \`bin/docker-bundle-deploy.sh\` / \`-release.sh\`（执行器，MODULE_BIN_SPEC.md §2.2）与 \`deployments/docker/bundle/\`（compose + env×5）尚未落地。
> 因此 §1 安装 / §2 升级 在接线前**不可执行**；其余章节（status / logs / rollback / down）命令本身可复制即用。
`;
}

function wiringBlockEn(f) {
  if (f.wired) {
    if (f.hasBundle) return '';
    if (!f.containerInstall) {
      const standalone = f.standaloneDelivery || 'host-package/host-service';
      const cloud = f.cloudDelivery || 'container-image/kubernetes';
      return `\n> ℹ️ **Delivery posture**: standalone delivery is a host package (\`${standalone}\`); cloud delivery is a container image (\`${cloud}\`).\n> The bundle container-install path described in sections 1 (install) / 2 (upgrade) (\`deployments/docker/bundle/\`) applies only when the module\n> enables a standalone **container** install; use \`bin/apps-package.sh\` + \`bin/apps-pkg-installer.sh\` for the host package, and let kubernetes\n> orchestration consume the image produced by \`bin/docker-image.sh push\` for the cloud plane.\n`;
    }
    return `\n> ⚠️ The image build hook is wired, but \`bin/docker-bundle-deploy.sh\` + \`bin/docker-bundle-release.sh\` (the executors, MODULE_BIN_SPEC.md §2.2) and \`deployments/docker/bundle/\` (compose + env) are missing yet: complete the bundle before \`install\`/\`upgrade\` (see OPERATIONS_SPEC.md §1.2).\n`;
  }
  if (f.assemblyOnly) {
    return `
> ℹ️ **Module shape**: this is an assembly-only module (it ships assembly crates but no standalone server binary),
> so the image build hook is marked not-applicable and fails closed; wire it per MODULE_BIN_SPEC.md §4.1 if a standalone
> gateway binary lands later. Sections 1 (install) and 2 (upgrade) are not executable until a container image exists.
`;
  }
  return `
> ⚠️ **Wiring status**: the nine \`bin/\` entrypoints are mounted per MODULE_BIN_SPEC.md, but the image build hook and the deploy bundle are not wired yet:
> - \`bin/lib/module.sh\` → \`sdkwork_image_build\` is still the scaffold placeholder (it exits with an explicit error);
> - \`bin/docker-bundle-deploy.sh\` / \`-release.sh\` (executors, MODULE_BIN_SPEC.md §2.2) and \`deployments/docker/bundle/\` (compose + env×5) do not exist yet.
>
> Sections 1 (install) and 2 (upgrade) are therefore **not executable** until wiring lands; every other section (status / logs / rollback / down) is copy-paste runnable as-is.
`;
}

function wiringSectionZh(f) {
  if (f.wired) return '';
  if (f.assemblyOnly) {
    return `
## 6. 接线前置条件（实施清单）

1. 本模块暂无 standalone 服务端二进制（assembly-only）。若产品决定以容器交付，需先落地 standalone gateway crate（参照同族模块的 \`sdkwork-api-<module>-standalone-gateway\`）。
2. 二进制落地后：实现 \`bin/lib/module.sh\` → \`sdkwork_image_build\`，并按 MODULE_BIN_SPEC.md §2.2 / OPERATIONS_SPEC.md §1.2 落地 \`bin/docker-bundle-deploy.sh\` + \`bin/docker-bundle-release.sh\`，以及 \`deployments/docker/bundle/\` 的 compose + env。
3. 验收：\`node ../sdkwork-specs/tools/check-operations-conformance.mjs --root .\` 全绿。
`;
  }
  return `
## 6. 接线前置条件（实施清单）

1. \`bin/lib/module.sh\`：实现 \`sdkwork_image_build\`（对接仓库的容器构建命令）、\`sdkwork_build_app\` / \`sdkwork_package_app\` / \`sdkwork_deploy_app\`（声明了 app 类型：\`${f.appTypes}\`）。
2. \`bin/docker-bundle-deploy.sh\` + \`bin/docker-bundle-release.sh\`（执行器，MODULE_BIN_SPEC.md §2.2），以及 \`deployments/docker/bundle/\` 的 compose + \`env/<environment>.env\`×5（含日志轮转、health 门禁）；模块打包器负责把执行器拷入 bundle 根。
3. 验收：\`node ../sdkwork-specs/tools/check-operations-conformance.mjs --root .\` 全绿。
`;
}

function wiringSectionEn(f) {
  if (f.wired) return '';
  if (f.assemblyOnly) {
    return `
## 6. Wiring prerequisites (implementation checklist)

1. This module has no standalone server binary yet (assembly-only). If the product decides on container delivery, land a
   standalone gateway crate first (mirror the family's \`sdkwork-api-<module>-standalone-gateway\`).
2. Once the binary exists: implement \`bin/lib/module.sh\` → \`sdkwork_image_build\`, and land
   \`bin/docker-bundle-deploy.sh\` + \`bin/docker-bundle-release.sh\` (MODULE_BIN_SPEC.md §2.2)
   plus the compose + env inputs under \`deployments/docker/bundle/\` per OPERATIONS_SPEC.md §1.2.
3. Acceptance: \`node ../sdkwork-specs/tools/check-operations-conformance.mjs --root .\` all green.
`;
  }
  return `
## 6. Wiring prerequisites (implementation checklist)

1. \`bin/lib/module.sh\`: implement \`sdkwork_image_build\` (delegate to the repository's container build) plus \`sdkwork_build_app\` / \`sdkwork_package_app\` / \`sdkwork_deploy_app\` (declared app types: \`${f.appTypes}\`).
2. \`bin/docker-bundle-deploy.sh\` + \`bin/docker-bundle-release.sh\` (executors, MODULE_BIN_SPEC.md §2.2), plus the compose + \`env/<environment>.env\`×5 inputs under \`deployments/docker/bundle/\` (log rotation, health gate included); the module's packager copies the executors into the bundle root.
3. Acceptance: \`node ../sdkwork-specs/tools/check-operations-conformance.mjs --root .\` all green.
`;
}

function deployZh(f) {
  const deployRoot = `/opt/deploy/${f.id}`;
  return `# Runbook — ${f.id} 部署 / 升级 / 回滚（中文）

适用环境：\`development|test|staging|demo|production\`。所有命令默认在本机 WSL 执行，远程主机加 \`--host ssh://[user@]host[:port]\`。镜像参考：\`registry.sdkwork.com/apps/${f.image}:${f.version}\`（tag 取自 \`sdkwork.app.config.json\` → \`release.currentVersion\`）。
${wiringBlockZh(f)}
## 1. 安装（首次）

\`\`\`bash
bin/docker-deploy.sh install --environment <development|test|staging|demo|production>
bin/docker-deploy.sh install --environment production --yes   # 生产必须显式 --yes
\`\`\`

install 会同步 bundle 到 \`${deployRoot}/bundle\`，加载镜像，按实例启动并等待健康门禁（\`${f.healthPath}\`）。

## 2. 升级

staging/demo/production 自动先生成变更前备份（\`--skip-backup\` 可跳过，会记录证据）：

\`\`\`bash
bin/docker-image.sh build
bin/docker-deploy.sh upgrade --environment staging --image-tag ${f.version}
\`\`\`

## 3. 验证（发布门禁）

\`\`\`bash
bin/docker-deploy.sh status --environment staging
bin/doctor.sh --environment staging          # 聚合诊断（9 项检查）
\`\`\`

## 4. 回滚

\`\`\`bash
bin/docker-deploy.sh rollback --environment staging                  # 台账上一个成功版本
bin/docker-deploy.sh rollback --environment staging --to ${f.version}       # 指定版本
\`\`\`

回滚由管理端口 \`${f.healthPath}\` 门禁把关；失败自动回退并写入 \`release-state/<env>/ledger.jsonl\`。迁移是前向的：跨不兼容 schema 只能走数据恢复（backup-restore.md）。

## 5. 下线

\`\`\`bash
bin/docker-deploy.sh down --environment staging
bin/docker-deploy.sh stop    --environment staging   # 停止（保留容器与卷，不重打包）
bin/docker-deploy.sh start   --environment staging   # 启动已停止的栈（先起嵌入式依赖）
bin/docker-deploy.sh restart --environment staging   # 只重启应用实例（依赖不中断）
bin/docker-deploy.sh down --environment staging --purge --yes
\`\`\`
${wiringSectionZh(f)}`;
}

function deployEn(f) {
  const deployRoot = `/opt/deploy/${f.id}`;
  return `# Runbook — ${f.id} deploy / upgrade / rollback (EN)

Environments: \`development|test|staging|demo|production\`. Commands run on the
local WSL host by default; append \`--host ssh://[user@]host[:port]\` for remote
targets. Image reference: \`registry.sdkwork.com/apps/${f.image}:${f.version}\`
(tag from \`sdkwork.app.config.json\` → \`release.currentVersion\`).
${wiringBlockEn(f)}
## 1. Install (first time)

\`\`\`bash
bin/docker-deploy.sh install --environment <development|test|staging|demo|production>
bin/docker-deploy.sh install --environment production --yes   # --yes is mandatory in production
\`\`\`

install syncs the bundle to \`${deployRoot}/bundle\`, loads the image, starts
instances and waits on the health gate (\`${f.healthPath}\`).

## 2. Upgrade

staging/demo/production capture a pre-change backup automatically (skip with
\`--skip-backup\`; the skip is recorded as evidence):

\`\`\`bash
bin/docker-image.sh build
bin/docker-deploy.sh upgrade --environment staging --image-tag ${f.version}
\`\`\`

## 3. Verify (release gate)

\`\`\`bash
bin/docker-deploy.sh status --environment staging
bin/doctor.sh --environment staging          # aggregated diagnostics (9 checks)
\`\`\`

## 4. Rollback

\`\`\`bash
bin/docker-deploy.sh rollback --environment staging                  # previous ledger version
bin/docker-deploy.sh rollback --environment staging --to ${f.version}       # explicit version
\`\`\`

Rollback is gated by \`${f.healthPath}\` on the management ports; a failed gate
auto-reverts and appends to \`release-state/<env>/ledger.jsonl\`. Migrations are
forward-only: across an incompatible schema the only recovery is a data
restore (backup-restore.md).

## 5. Retire

\`\`\`bash
bin/docker-deploy.sh down --environment staging
bin/docker-deploy.sh stop    --environment staging   # stop (keeps containers and volumes; no repackage)
bin/docker-deploy.sh start   --environment staging   # start a stopped stack (embedded deps first)
bin/docker-deploy.sh restart --environment staging   # restart app instances only (deps stay up)
bin/docker-deploy.sh down --environment staging --purge --yes
\`\`\`
${wiringSectionEn(f)}`;
}

function troubleshootingZh(f) {
  return `# Runbook — ${f.id} 故障排查（中文）

症状 → \`bin/doctor.sh --environment <env>\` 检查项 → 处置。

## 1. 实例不健康

\`\`\`bash
bin/doctor.sh --environment staging
bin/docker-deploy.sh status --environment staging
\`\`\`

- \`health FAIL\`：\`curl -fsS http://127.0.0.1:<管理端口>${f.healthPath}\` 复现；\`bin/docker-deploy.sh logs --environment staging --tail 200\` 看最近错误。

## 2. 端口未监听

\`\`\`bash
bin/doctor.sh --environment staging          # ports 检查项给出期望端口
\`\`\`

- 被占用：改 bundle env 文件里的 \`*_HOST_PORT\` 后 \`bin/docker-deploy.sh install\` 重放。

## 3. 配置漂移 / 占位符密钥

\`\`\`bash
bin/config.sh diff --environment staging
bin/config.sh validate --environment staging
bin/config.sh set --environment staging --key <KEY> --value '<真实值>'
\`\`\`

## 4. 镜像漂移（跑的不是台账版本）

\`\`\`bash
bin/docker-deploy.sh status --environment staging
\`\`\`

- status 输出的镜像与发布台账（release ledger）不一致即为 drift 告警：\`bin/docker-deploy.sh rollback --environment staging --to <台账版本>\`。
${wiringSectionZh(f)}`;
}

function troubleshootingEn(f) {
  return `# Runbook — ${f.id} troubleshooting (EN)

Symptom → \`bin/doctor.sh --environment <env>\` check → fix.

## 1. Instance unhealthy

\`\`\`bash
bin/doctor.sh --environment staging
bin/docker-deploy.sh status --environment staging
\`\`\`

- \`health FAIL\`: reproduce with \`curl -fsS http://127.0.0.1:<mgmt-port>${f.healthPath}\`; inspect recent errors with \`bin/docker-deploy.sh logs --environment staging --tail 200\`.

## 2. Port not listening

\`\`\`bash
bin/doctor.sh --environment staging          # the ports check reports expected ports
\`\`\`

- Port taken: change \`*_HOST_PORT\` in the bundle env file and replay \`bin/docker-deploy.sh install\`.

## 3. Config drift / placeholder secrets

\`\`\`bash
bin/config.sh diff --environment staging
bin/config.sh validate --environment staging
bin/config.sh set --environment staging --key <KEY> --value '<real-value>'
\`\`\`

## 4. Image drift (running version differs from the ledger)

\`\`\`bash
bin/docker-deploy.sh status --environment staging
\`\`\`

- A mismatch between the reported image and the release ledger is a drift
  alert: \`bin/docker-deploy.sh rollback --environment staging --to <ledger-version>\`.
${wiringSectionEn(f)}`;
}

function backupZh(f) {
  return `# Runbook — ${f.id} 备份与恢复（中文）

## 1. 备份

\`\`\`bash
bin/backup.sh create --environment production            # 配置 + 数据库 + 卷，含 sha256
bin/backup.sh list   --environment production
bin/backup.sh verify --environment production            # 校验最新集合
\`\`\`

备份集位于目标机 \`/opt/deploy/${f.id}/backups/\`。RPO：生产每日 + 每次升级前；RTO：生产 4 小时内完成恢复。

## 2. 恢复（破坏性，需 --yes）

\`\`\`bash
bin/backup.sh restore --environment production --set <集合名> --yes
bin/docker-deploy.sh install --environment production     # 恢复后重新拉起
\`\`\`

## 3. 演练

每季度在临时环境真实恢复一次（不是只跑 verify）。
${wiringSectionZh(f)}`;
}

function backupEn(f) {
  return `# Runbook — ${f.id} backup & restore (EN)

## 1. Backup

\`\`\`bash
bin/backup.sh create --environment production            # config + database + volumes, sha256 checksummed
bin/backup.sh list   --environment production
bin/backup.sh verify --environment production            # verify the latest set
\`\`\`

Backup sets live on the target host under \`/opt/deploy/${f.id}/backups/\`.
RPO: daily in production plus before every upgrade; RTO: production restore
completes within 4 hours.

## 2. Restore (destructive, requires --yes)

\`\`\`bash
bin/backup.sh restore --environment production --set <set-name> --yes
bin/docker-deploy.sh install --environment production     # bring the stack back up after restore
\`\`\`

## 3. Drill

Once per quarter, perform a real restore into a scratch environment (not just
\`verify\`).
${wiringSectionEn(f)}`;
}

function logsZh(f) {
  return `# Runbook — ${f.id} 日志参考（中文）

## 读取

\`\`\`bash
bin/docker-deploy.sh logs --environment production --tail 200          # 有界读取（默认）
bin/docker-deploy.sh logs --environment production --follow            # 显式跟随
bin/docker-deploy.sh logs --environment production --export ./out      # 导出工单附件（脱敏）
\`\`\`

健康启动日志特征：\`${f.primaryService}\` 服务监听就绪，\`${f.healthPath}\` 返回 200，模块生命周期依次 ready。

## 常见失败签名

| 日志特征 | 含义 | 处置 |
| --- | --- | --- |
| \`connection refused ... 5432\` / \`... 6379\` | 数据库 / Redis 不可达 | \`bin/doctor.sh --environment <env>\` 看 ports/config 检查项 |
| \`relation "..." does not exist\` | 迁移未应用 | 检查 env 数据库名；迁移前向执行，必要时恢复备份 |
| \`${f.healthPath}\` 503 依赖不可用 | postgres/redis 未就绪 | 看 \`bin/doctor.sh\` 的 health 检查项与依赖容器状态 |
| 反复 \`panic\` + 容器重启 | 启动崩溃循环 | 看 \`bin/doctor.sh\` resources 的 restart count；回滚版本 |
${wiringSectionZh(f)}`;
}

function logsEn(f) {
  return `# Runbook — ${f.id} log reference (EN)

## Reading logs

\`\`\`bash
bin/docker-deploy.sh logs --environment production --tail 200          # bounded read (default)
bin/docker-deploy.sh logs --environment production --follow            # explicit follow
bin/docker-deploy.sh logs --environment production --export ./out      # export for tickets (redacted)
\`\`\`

Healthy startup signature: the \`${f.primaryService}\` service binds its
listener, \`${f.healthPath}\` returns 200, and module lifecycles report ready in
order.

## Common failure signatures

| Log signature | Meaning | Fix |
| --- | --- | --- |
| \`connection refused ... 5432\` / \`... 6379\` | database / Redis unreachable | \`bin/doctor.sh --environment <env>\` → ports/config checks |
| \`relation "..." does not exist\` | migration not applied | check the env database name; migrations are forward-only, restore a backup if needed |
| \`${f.healthPath}\` 503 with a dependency error | postgres/redis not ready | \`bin/doctor.sh\` health check + dependency container state |
| repeated \`panic\` + container restarts | startup crash loop | \`bin/doctor.sh\` resources → restart count; roll back the version |
${wiringSectionEn(f)}`;
}

const README_INDEX_MARK = '<!-- scaffold-module-runbooks:index -->';

function readmeSection(f) {
  return `${README_INDEX_MARK}
## Docker 运维四件套（bin/ 标准，OPERATIONS_SPEC.md §7）

| Runbook | 内容 |
| --- | --- |
| [deploy.md](deploy.md) / [deploy.en.md](deploy.en.md) | 安装 / 升级 / 回滚 / 下线（bin/docker-deploy.sh + bin/docker-image.sh） |
| [troubleshooting.md](troubleshooting.md) / [troubleshooting.en.md](troubleshooting.en.md) | 症状 → doctor 检查 → 处置 |
| [backup-restore.md](backup-restore.md) / [backup-restore.en.md](backup-restore.en.md) | 备份 / 校验 / 恢复 / 演练（bin/backup.sh） |
| [log-reference.md](log-reference.md) / [log-reference.en.md](log-reference.en.md) | 健康日志特征与失败签名（bin/docker-deploy.sh logs） |
`;
}

function readmeSectionEn(f) {
  return `${README_INDEX_MARK}
## Docker operations runbooks (bin/ standard, OPERATIONS_SPEC.md §7)

| Runbook | Scope |
| --- | --- |
| [deploy.md](deploy.md) / [deploy.en.md](deploy.en.md) | install / upgrade / rollback / retire (bin/docker-deploy.sh + bin/docker-image.sh) |
| [troubleshooting.md](troubleshooting.md) / [troubleshooting.en.md](troubleshooting.en.md) | symptom → doctor check → fix |
| [backup-restore.md](backup-restore.md) / [backup-restore.en.md](backup-restore.en.md) | capture / verify / restore / drill (bin/backup.sh) |
| [log-reference.md](log-reference.md) / [log-reference.en.md](log-reference.en.md) | healthy log signature and failure modes (bin/docker-deploy.sh logs) |
`;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------
const FILES = [
  ['deploy.md', deployZh],
  ['deploy.en.md', deployEn],
  ['troubleshooting.md', troubleshootingZh],
  ['troubleshooting.en.md', troubleshootingEn],
  ['backup-restore.md', backupZh],
  ['backup-restore.en.md', backupEn],
  ['log-reference.md', logsZh],
  ['log-reference.en.md', logsEn],
];

function processRoot(root) {
  const id = path.basename(root);
  if (!fs.existsSync(path.join(root, 'bin', 'lib', 'module.sh'))) {
    return { id, status: 'no-bin', created: [] };
  }
  const facts = readModuleFacts(root);
  const runbookDir = path.join(root, 'docs', 'runbooks');
  fs.mkdirSync(runbookDir, { recursive: true });
  const created = [];
  const skippedHandAuthored = [];
  for (const [name, tpl] of FILES) {
    const file = path.join(runbookDir, name);
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8');
      const isGenerated = existing.includes(GENERATED_MARKER);
      if (!isGenerated && !forceHandAuthored) {
        // Hand-authored runbooks are protected: --force refreshes generated
        // files only, never bespoke content (use --force-hand-authored to
        // override deliberately).
        skippedHandAuthored.push(name);
        continue;
      }
      if (!force) continue;
    }
    fs.writeFileSync(file, `${tpl(facts).replace(/\n{3,}/g, '\n\n')}\n${GENERATED_MARKER}\n`, 'utf8');
    created.push(name);
  }
  // README index — appended only when the runbook files carry the generated
  // marker AND the README does not already index the four-piece set (a
  // hand-written README keeps its own navigation).
  const readme = path.join(runbookDir, 'README.md');
  const generatedCount = FILES.filter(([name]) => {
    const file = path.join(runbookDir, name);
    return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(GENERATED_MARKER);
  }).length;
  if (fs.existsSync(readme)) {
    const text = fs.readFileSync(readme, 'utf8');
    const alreadyIndexed = text.includes(README_INDEX_MARK)
      || (text.includes('deploy.md') && text.includes('log-reference.md'));
    if (!alreadyIndexed && generatedCount === FILES.length) {
      fs.appendFileSync(readme, '\n\n' + readmeSection(facts), 'utf8');
      created.push('README.md (index appended)');
    }
  } else {
    fs.writeFileSync(
      readme,
      `# Runbooks — ${id}\n\n` + readmeSectionEn(facts) + '\n' + readmeSection(facts),
      'utf8',
    );
    created.push('README.md (created)');
  }
  return { id, status: facts.assemblyOnly ? 'assembly-only' : (facts.wired ? 'wired' : 'unwired'), created, skippedHandAuthored };
}

let wiredCount = 0;
let unwiredCount = 0;
let assemblyOnlyCount = 0;
let noBinCount = 0;
let fileCount = 0;
let protectedCount = 0;
for (const r of ROOTS) {
  if (!fs.existsSync(r)) continue;
  const res = processRoot(r);
  if (res.status === 'no-bin') { noBinCount++; console.log(`- ${res.id}: no bin/ family, skipped`); continue; }
  if (res.status === 'wired') wiredCount++;
  else if (res.status === 'assembly-only') assemblyOnlyCount++;
  else unwiredCount++;
  fileCount += res.created.length;
  protectedCount += res.skippedHandAuthored.length;
  console.log(`${res.id} (${res.status}): created ${res.created.length}`);
  for (const c of res.created) console.log(`  + ${c}`);
  if (res.skippedHandAuthored.length > 0) {
    console.log(`  ! hand-authored protected (use --force-hand-authored to override): ${res.skippedHandAuthored.join(', ')}`);
  }
}
console.log(`\ntotal: ${ROOTS.length} roots, ${wiredCount} wired, ${assemblyOnlyCount} assembly-only, ${unwiredCount} unwired, ${noBinCount} no-bin, ${fileCount} files written, ${protectedCount} hand-authored protected`);
