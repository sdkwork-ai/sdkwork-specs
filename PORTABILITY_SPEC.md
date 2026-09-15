# PORTABILITY_SPEC.md — Shell 脚本可移植性标准（Linux 全发行版 + macOS）

> 本规范约束所有**操作员侧** shell 脚本：`sdkwork-specs/bin/lib/*`、各模块 `bin/*` 与 `bin/lib/*`、
> bundle 内 `deploy.sh` / `release.sh` / `prepare-envs.sh`。
> 目标：任何 Linux 发行版（glibc/musl 均可）与 macOS 自带 bash 3.2 上可直接执行，无需安装额外依赖。

> This spec governs all **operator-side** shell scripts: `sdkwork-specs/bin/lib/*`, module
> `bin/*` and `bin/lib/*`, and bundle `deploy.sh` / `release.sh` / `prepare-envs.sh`.
> Goal: run as-is on any Linux distribution and on macOS's stock bash 3.2, with no extra
> dependencies installed.

---

## 1. 基线（Baseline）

| 维度 | 基线 |
| --- | --- |
| Shell | bash ≥ 3.2（macOS `/usr/bin/bash` 版本） |
| 核心工具 | POSIX coreutils + `awk` + `sed` + `grep -E` + `sort` + `openssl` 或 `shasum`（三选一链） |
| 禁用 | bash 4+ 语法、GNU 独有 flag（见 §2/§3） |

**强制门禁**：`node sdkwork-specs/tools/check-shell-portability.mjs --root <dir> [--root <dir2> ...]`
对每个 root 下全部 `.sh` 执行静态 lint + `bash -n` 语法检查，0 finding 才算通过。

**Mandatory gate**: `node tools/check-shell-portability.mjs --root <dir> ...` runs static lint +
`bash -n` over every `.sh` under each root; zero findings is the pass condition.

---

## 2. bash 4+ 禁用特性（BASH4 规则）

| 禁用 | 替代方案 |
| --- | --- |
| `declare -A` / `local -A`（关联数组） | **平行索引数组**（keys/values 按下标对齐）+ 查找函数（见 `sdkwork_config_index_of`） |
| `declare -g` / `-gA` / `-ga` | 文件作用域直接声明全局；函数内直接赋值（先在文件头声明） |
| `mapfile` / `readarray` | `while IFS= read -r x; do ...; done < <(cmd)` |
| `${var,,}` / `${var^^}` | `tr '[:upper:]' '[:lower:]'` |
| `coproc`、`|&`、`;;&` | `2>&1 |`、显式 case 分支 |
| `printf '%(...)T'` | `date -u +<fmt>` |
| 负数组下标 `arr[-1]` | `arr[${#arr[@]}-1]` |
| `${!prefix@}`（前缀名展开） | 显式遍历键名 |

> 性能提示：查找函数通过**全局变量**返回结果（如 `SDKWORK_CONFIG_INDEX`），
> 不要 `idx="$(func)"` —— 命令替换每键 fork 一个子 shell，在 Windows/MSYS 上是分钟级开销。
>
> Perf note: lookup functions return via a **global variable**, not `$(...)` — command
> substitution forks per call and costs minutes on Windows/MSYS hosts.

---

## 3. GNU 独有命令/flag（GNU-ONLY 规则）

| 禁用 | 替代方案 |
| --- | --- |
| `stat -c` / `stat --format` | `sdkwork_file_mtime`（`stat -c '%Y'` → `stat -f '%m'` → 0 三段 shim） |
| `sha256sum` | `sdkwork_sha256_file`（`sha256sum` → `shasum -a 256` → `openssl dgst -sha256` 三选一链）；独立脚本内用同样的三选一链 |
| `sed -i`（任何形式） | awk + 临时文件 + `mv`（见 `replace_line`，BSD 的 `-i ''` 与 GNU 的 `-i` 互不兼容） |
| `base64 -w0` | `base64 -w0 < f 2>/dev/null \|\| base64 < f \| tr -d '\r\n'` |
| `xargs -r`、`timeout N`、`truncate`、`getent` | 计数守卫 / 自实现 |
| `readlink -f`、`realpath` | `cd` + `pwd -P` |
| `date -d` / `--date` | UTC epoch 运算或 `date -u` |
| `sort -h`、`du -b`、`grep -P`、`install -D` | `sort -n` / `du -k` / `grep -E` / `mkdir -p` + `install` |

校验和 sidecar 格式固定为 `printf '%s  %s\n' <digest> <basename>`（双空格），
同时兼容 `sha256sum -c`（GNU）与 `shasum -a 256 -c`（macOS）。

---

## 4. 豁免标记（Exemption markers）

lint 对**代码行**生效（纯注释行不检查）。当代码行确实无法避免违规 token 时，用以下标记豁免
（标记在本行或前 2 行内均生效）：

The lint applies to **code lines** only. When a violation token is unavoidable, exempt the line
with either marker (effective on the line itself or within the 2 lines above it):

| 标记 | 语义 |
| --- | --- |
| `PORTABILITY:target-linux` | 代码只在 **Linux 目标机**上执行（如 `sdkwork_remote` 生成的远程脚本、postgres 容器 init），目标机必为 Linux，可用 GNU 命令 |
| `PORTABILITY:allow` | 操作员机上**有意**使用（如可移植 shim 内部先用 `command -v` 探测再调用） |

示例 / Example:

```bash
# PORTABILITY:target-linux — executes on the deployed target, not the operator machine.
sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc \
  "cd ${set_dir} && sha256sum ${file} > ${file}.sha256" # PORTABILITY:target-linux

if command -v sha256sum >/dev/null 2>&1; then        # PORTABILITY:allow
  sha256sum "${file}" | awk '{print $1}'              # PORTABILITY:allow
```

滥用豁免标记会被 review 拒绝：任何豁免必须能回答"这段代码为什么永远/必然运行在允许该命令的环境里"。

**边界提醒**：bundle 的 `deploy.sh` / `release.sh` 属**操作员侧**（§5），部署目标包含 Linux/macOS 服务端，
因此**不得**用 `PORTABILITY:target-linux` 豁免。它们的 GNU 依赖要改成可移植写法，工作区内已有两个标准范式：

```bash
# 摘要链：sha256sum (GNU) → shasum (macOS) → openssl（见各 bundle release.sh）
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${file}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${file}" | awk '{print $1}')"
else
  actual="$(openssl dgst -sha256 "${file}" | awk '{print $NF}')"
fi

# 有界执行：GNU timeout 在 macOS 缺失，用后台看门狗兜底（见各 bundle deploy.sh 的 run_bounded）
run_bounded() {
  local seconds="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    local bounded_rc=0
    timeout "${seconds}" "$@" || bounded_rc=$?
    return "${bounded_rc}"
  fi
  "$@" &
  local cmd_pid=$!
  ( sleep "${seconds}"; kill -TERM "${cmd_pid}" 2>/dev/null ) >/dev/null 2>&1 &
  local watchdog_pid=$!
  local rc=0
  wait "${cmd_pid}" 2>/dev/null || rc=$?
  kill -TERM "${watchdog_pid}" 2>/dev/null || true
  return "${rc}"
}
```

`timeout "${seconds}" "$@"` 不能写字面数字参数（`timeout 6 …`）以外的形式时无妨——门禁按"命令 + 数字"识别 GNU `timeout`。

---

## 5. 范围划分（Scope boundaries）

- **操作员侧**（本规范强制）：specs 共享库、模块 bin/ 与 bin/lib、bundle 的 deploy/release/prepare-envs。
  这些脚本可能在 macOS 或任意 Linux 笔记本/跳板机上运行。
- **目标机侧**（允许 GNU，需标注 `PORTABILITY:target-linux`）：通过 `sdkwork_remote` 下发的远程脚本、
  仅在 Linux 宿主机/容器内执行的准备脚本（Ubuntu CI 脚本、WSL/宿主初始化、容器 entrypoint）。
- **Windows/MSYS（Git Bash）**：脚本可以运行，但远程调用经 `wsl.exe` 桥，fork 开销大；
  本规范不做 Windows 性能承诺，仅保证行为正确。

### 5.1 不被 lint 的目录（门禁作用域）

门禁只审**本工作区的源代码**。以下目录名会被跳过，并且**不**计入 finding：

| 类别 | 目录名 | 原因 |
| --- | --- | --- |
| 工具/依赖状态 | `node_modules` `.git` `target` `external` `vendor` `.vs` | `external/` 是 vendored 第三方树（arduino-esp32 / esp-idf / mbedtls / openclaw …），修改会在下次 vendor 同步时丢失；`.vs/` 是 Visual Studio 的按用户 IDE 状态（2026-09-15 加入：`sdkwork-membership` 提交了 `.vs/**/DocumentLayout.json`，内含 `<workspace-root>/sdkwork-membership/` 形式的绝对路径，属编辑器状态而非产品源码） |
| 构建产物 | `dist` `build` `out` `bak` `coverage` `.next` `obj` | `dist/` 下的 bundle 是上面已审源码的副本；`obj/` 是 .NET/MSBuild 的中间输出根，与 `target/` 同类（2026-09-15 加入：`sdkwork-iam` / `sdkwork-im` 提交了 `sdks/**/generated/server-openapi/obj/project.assets.json` 与 `*.csproj.nuget.dgspec.json`，NuGet restore 会把生成机的绝对路径写满这些文件） |
| Agent/运行时暂存 | `.workbuddy` `.sdkwork` `.tmp` `tmp` `.wsl-tmp` | 一次性脚手架与运行时状态，不是产品源码。`.wsl-tmp` 是工作区根的 WSL 侧临时脚手架目录（2026-09-10 加入：65 个临时脚本，未被任何规范/工具引用） |

未纳入该表的目录一律受审。若某个清单外的路径确实不该审，走"扩大排除表 + 在本文档说明理由"的流程，
不要靠豁免标记逐行标注。

### 5.2 工作区路径门禁的豁免标记（Exemption markers）

`node sdkwork-specs/tools/check-workspace-path-portability.mjs --workspace <dir>` 按
`DEPENDENCY_MANAGEMENT_SPEC.md` §1 / §9 执行"源码与构建配置不得绑定机器绝对路径"。它有**两级**标记，
作用域不同，不要混用：

| 标记 | 作用域 | 适用场景 |
| --- | --- | --- |
| `WORKSPACE-PATH:allow` | **行**级：标记所在行，或其后 8 行内 | 该字面量确实不是源码/构建绑定，例如文档化的运行时目标路径，或归一化断言所钉住的期望值 |
| `WORKSPACE-PATH:allow-fixture` | **文件**级：必须出现在文件前 20 行内 | 整个测试文件就是"模拟一个外部检出根"的夹具 |

行级窗口取 8 行而不是 1 行：rustfmt 与 prettier 会把**一条**调用折成多行，窗口若只覆盖物理行，
作者明明写了的标记会被读成不存在（2026-09-15 实证：`provider_session_path.rs` 的 `assert_eq!` 已带标记，
仍被报出 4 处）。

文件级标记**只在测试文件生效**（文件名形如 `*.test.*` / `*.spec.*`，或路径含 `tests/`、`test/`、
`__tests__/`）。夹具这一级豁免不可避免：测试要模拟一个外部检出根，就得在数据里写出那个根，而
`sdkwork-<name>` 段往往**正是被断言的值**——按路径派生的分块名、按目录派生的应用代号、拼出的 surface
目录、模拟的 PowerShell 提示符（形如 `<drive>:\sdkwork-terminal>`）——此时既不能把夹具中性化（会删掉
测试所断言的东西），也不该逐行标注（`SIBLING-REPO-ABS` 本身分不清夹具与真实引用）。
在非测试文件里写该标记**没有任何效果**：门禁把它当错误报出（`FIXTURE-MARKER-NOT-APPLICABLE`），
所以它无法用来掩盖真实绑定。

两类豁免都不静默：无论通过与否，门禁都会打印已声明的行级豁免数与**被豁免文件清单**。

本节与 §5.1 末段不冲突：§5.1 管"整个目录本就不该审"（走排除表），本节管"受审文件里，某行或某个
测试夹具是数据而非绑定"。

#### English summary

`WORKSPACE-PATH:allow` exempts a line, or any line within 8 lines below the marker — a statement, not a
physical line, because rustfmt and prettier wrap one call across several rows. `WORKSPACE-PATH:allow-fixture`
in the first 20 lines exempts a whole test file, and is honoured **only** in a test file: a fixture that
simulates a foreign checkout root must name that root in its data, and the `sdkwork-<name>` segment is
frequently the value under assertion, so neither genericizing the fixture nor marking it line by line is
correct. Outside a test file the marker has no effect and is reported as `FIXTURE-MARKER-NOT-APPLICABLE`,
so it cannot conceal a production binding. The gate always prints the declared line-exemption count and the
list of fixture-exempt files.

## 6. 回归要求（Regression duty)

修改任何受约束脚本后必须：
1. `node sdkwork-specs/tools/check-shell-portability.mjs --root ...`（0 finding）
2. `node sdkwork-specs/tools/check-module-bin.mjs --root <module>`（每模块 0 finding）
3. 至少一个真实只读冒烟：`bin/config.sh show --environment <env>`、`bin/doctor.sh`、`bin/backup.sh list`。

全工作区（舰队）批量回归时追加 `--no-bash-n`：`bash -n` 会为**每个文件** fork 一个 bash，
在 Windows/MSYS 上把一次全舰队扫描从数秒拖到 30 分钟以上。语法检查在模块级 CI 里跑即可；
批量扫描只看静态 finding。

另：任何**新增或修改**受版本控制的源码、配置或文档后，追加
`node sdkwork-specs/tools/check-workspace-path-portability.mjs --workspace <dir>`（0 finding）。
该门禁的作用域与豁免规则见 §5.1 / §5.2。

After touching any governed script: run the portability gate (0 findings), the module-bin gate
(0 findings per module), and at least one real read-only smoke command.
For a whole-fleet sweep add `--no-bash-n` — one `bash -n` fork per file turns a few seconds into
30+ minutes on Windows/MSYS, while module CI still runs the syntax check.
