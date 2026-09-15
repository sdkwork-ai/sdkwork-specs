# SDKWork 三端原生移动客户端根架构

- Version: 1.0
- Status: Active — 三端根规格已生效，实现尚未落地
- Owner: SDKWork standards maintainers
- Related: `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`,
  `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `APP_IOS_NATIVE_UI_SPEC.md`,
  `APP_ANDROID_NATIVE_UI_SPEC.md`, `APP_HARMONY_NATIVE_UI_SPEC.md`,
  `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`,
  `NAMING_SPEC.md`, `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`,
  `UI_ARCHITECTURE_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `PNPM_SCRIPT_SPEC.md`

本文是技术架构 Canon 的设计分片，说明本仓库如何承载 iOS / Android / HarmonyOS
三端原生移动客户端根的标准，以及标准与实现之间的边界。规范正文不在本文复述，
一律引用上列 `*_SPEC.md`。

---

## 1. 边界

- 本仓库只拥有**三端根规格本身**（架构、目录结构、分包规范、验证矩阵）。
- 消费者仓库拥有实际的 `apps/sdkwork-<application-code>-<arch>-mobile/` 根。
- 三端根规格 `MUST NOT` 在消费者仓库内被复制正文，只能按相对路径引用。
- 三端实现尚未落地：工作区目前没有真实的 `apps/*-*-mobile/` 原生根。
  规格先行、实现后置是当前的有意状态，不是遗漏。

## 2. 三端根清单

| 平台 | 架构根规格 | UI 规格 | `runtime.family` / `runtime.framework` | `runtimeTarget` | 发布平台 | 根目录 |
| --- | --- | --- | --- | --- | --- | --- |
| iOS 原生 | `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md` | `APP_IOS_NATIVE_UI_SPEC.md` | `mobile` / `ios-native` | `ios-native` | `APP_IOS` | `apps/sdkwork-<application-code>-ios-mobile/` |
| Android 原生 | `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md` | `APP_ANDROID_NATIVE_UI_SPEC.md` | `mobile` / `android-native` | `android-native` | `APP_ANDROID` | `apps/sdkwork-<application-code>-android-mobile/` |
| HarmonyOS 原生 | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` | `APP_HARMONY_NATIVE_UI_SPEC.md` | `mobile` / `harmony-native` | `harmony-native` | `APP_HARMONY` | `apps/sdkwork-<application-code>-harmony-mobile/` |

三端根规格章节骨架逐节对应（Core Model、Standard Root Layout、Package Taxonomy、
Package Internal Shape、Dependency Direction、SDK And IAM Integration、
Host Adapter Boundary、Route Alignment、Config/Build/Release、Standard Commands、
Verification）。新增一端或修改任一端时 `MUST` 保持该骨架对称。

## 3. 分包规范要点

包名前缀统一为 `sdkwork-<application-code>-<arch>-mobile-*`，含三类保留家族：

- 默认 app/user 包：`sdkwork-<application-code>-<arch>-mobile-<capability>`
- 用户控制台包：`sdkwork-<application-code>-<arch>-mobile-console-<capability>`
- 内部运营包：`sdkwork-<application-code>-<arch>-mobile-admin-<capability>`（映射 `backend-admin`）
- 平台适配包：`sdkwork-<application-code>-<arch>-mobile-host`

目录名用 kebab-case；平台标识符按各自语言规则归一化（Swift target 用 PascalCase、
Kotlin 用 dotted namespace、ohpm/ArkTS 保 SDKWork 包身份）。完整规则见三端根规格的
Package Taxonomy 与 Package Internal Shape 章节，命名链接受 `NAMING_SPEC.md` 约束。

## 4. 与全局规格的触点

修改三端标准时 `MUST` 同步检查以下位置，避免只改一端或漏改索引：

| 位置 | 三端相关责任 |
| --- | --- |
| `README.md` | 任务矩阵行、客户端根导航、验收清单 |
| `UI_ARCHITECTURE_SPEC.md` | 三端 app / console / admin 三档表格 |
| `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` | 对齐根族表与路由身份 |
| `APP_MANIFEST_SPEC.md` | `runtime.framework`、平台分类、包格式枚举 |
| `CONFIG_SPEC.md` / `ENVIRONMENT_SPEC.md` | `runtimeTarget` 枚举与 `config/host` 契约 |
| `SDKWORK_DEPLOY_SPEC.md` | `packages` 名单与 `SDKWORK_DEPLOY_SPEC.md` §10 |
| `PNPM_SCRIPT_SPEC.md` | `dev/build:*:<arch>-native` 命令族与别名表 |
| `NAMING_SPEC.md` | 包 id 示例与客户端包命名 |
| `GITHUB_WORKFLOW_SPEC.md` | 打包目标与包 id |
| `TEST_SPEC.md` | 运行时目标测试、SDK 归属检查、发布预检 |
| `schemas/` | `packageFormat`、`runtimeTarget`、`clientArchitectures` 枚举 |

## 5. 包格式

| 平台 | 产物 | `packageFormat` |
| --- | --- | --- |
| iOS 原生 | `.ipa` | `IPA` |
| Android 原生 | `.aab` / `.apk` | `AAB` / `APK` |
| HarmonyOS 原生 | `.hap` 模块包 / `.app` 应用包 | `HAP` / `HARMONY_APP` |

Harmony 的 `HAP` 与 `HARMONY_APP` 是本仓库新增的枚举值，与 `PACKAGE_FORMATS`
校验器及包 id 格式段（`hap`）保持一致。`HARMONY_APP` 与平台枚举值 `APP` 分属不同
字段（`packageFormat` 与 `platform`），不构成冲突。

## 6. 校验现状

- `tools/check-app-manifest-standard.mjs` 校验 `packageFormat`、`platform`、
  `runtimeTarget` 与 `clientArchitectures` 的规范值，三端已覆盖。
- 三端根规格各自带 Verification 矩阵，但**尚无三端专属静态检查器**。
  消费者仓库接入时需自行实现 Root Layout、Package Naming、Root Thinness、
  SDK Boundary、Host Boundary 等检查项。
- 新增三端 checker 时 `MUST` 同步 `TEST_SPEC.md`。

## 7. 维护规则

- 三端标准变更按 `GOVERNANCE_SPEC.md` 走，破坏性变更需 ADR。
- 变更 `MUST` 保持三端对称；只改一端时需在 PR 说明为何其余两端不适用。
- 变更完成 `MUST` 在本文件第 2、4、5 节复查是否需要同步更新。
