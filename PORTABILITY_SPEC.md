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

---

## 5. 范围划分（Scope boundaries）

- **操作员侧**（本规范强制）：specs 共享库、模块 bin/ 与 bin/lib、bundle 的 deploy/release/prepare-envs。
  这些脚本可能在 macOS 或任意 Linux 笔记本/跳板机上运行。
- **目标机侧**（允许 GNU，需标注 `PORTABILITY:target-linux`）：通过 `sdkwork_remote` 下发的远程脚本、
  postgres 容器 init 脚本（容器内固定 Debian 基础镜像）。
- **Windows/MSYS（Git Bash）**：脚本可以运行，但远程调用经 `wsl.exe` 桥，fork 开销大；
  本规范不做 Windows 性能承诺，仅保证行为正确。

## 6. 回归要求（Regression duty)

修改任何受约束脚本后必须：
1. `node sdkwork-specs/tools/check-shell-portability.mjs --root ...`（0 finding）
2. `node sdkwork-specs/tools/check-module-bin.mjs --root <module>`（每模块 0 finding）
3. 至少一个真实只读冒烟：`bin/config.sh show --environment <env>`、`bin/doctor.sh`、`bin/backup.sh list`。

After touching any governed script: run the portability gate (0 findings), the module-bin gate
(0 findings per module), and at least one real read-only smoke command.
