# SDKWork H5 Capacitor 多平台移动打包设计

- Version: 1.1
- Status: Active — 平台 profile 规范已生效；存量 H5 根尚未落地原生子树（见 §6）
- Owner: SDKWork standards maintainers
- Related: `APP_H5_ARCHITECTURE_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`,
  `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`,
  `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `NAMING_SPEC.md`,
  `APP_MOBILE_REACT_UI_SPEC.md`, `TEST_SPEC.md`, `PNPM_SCRIPT_SPEC.md`,
  `SUPPLY_CHAIN_SECURITY_SPEC.md`

本文是技术架构 Canon 的设计分片，说明 H5 根如何用**一个** Capacitor 宿主包把同一份
H5 渲染产物打包成**多个移动端平台应用**，以及标准与实现之间的边界。规范正文不在本文
复述，一律引用 `APP_H5_ARCHITECTURE_SPEC.md` §2.2 与 §8。

---

## 1. 边界

- 本仓库拥有**平台 profile 规范**（平台对照契约、目录架构、分包规则、验证矩阵）。
- 消费者仓库拥有实际的 `apps/sdkwork-<application-code>-h5/` 根与其 `-h5-capacitor` 包。
- H5 根 `MUST NOT` 拥有桌面 Capacitor 宿主；桌面 Capacitor 归 PC 根
  （`APP_PC_ARCHITECTURE_SPEC.md`、`DESKTOP_APP_ARCHITECTURE_SPEC.md` §5.4）。
- 本文不复制规范正文；与 `APP_H5_ARCHITECTURE_SPEC.md` 冲突时以该文件为准。

## 2. 上游平台事实（2026-09-15 核实）

| 事实 | 值 | 来源 |
| --- | --- | --- |
| 官方支持平台 | **iOS、Android、Web/PWA** 三条，无第四条 | Capacitor 上游仓库与官方文档 |
| 当前主版本 | v8（每年跟随 Android target SDK 发一个大版本） | Capacitor 上游 |
| Node | `>=22.0.0`（v7 为 `>=20.0.0`） | `@capacitor/cli` `engines.node` |
| iOS deployment target | **15.0**（v7 为 14.0） | Capacitor 8 工具链下限 |
| Xcode | **26.0+** | 同上 |
| Android SDK | `minSdkVersion` **24**、`compileSdkVersion` = `targetSdkVersion` = **36**（v7 为 23/35/35） | Capacitor Android target SDK 矩阵 |
| Android 构建工具 | Android Studio Otter (2025.2.1)+、AGP **8.13.0**、Gradle wrapper **8.14.3**、Kotlin **2.2.20**、Java 21 | Capacitor 8 工具链下限 |
| iOS 依赖管理 | **Swift Package Manager 成为默认**；`ios/App/CapApp-SPM/Package.swift` 由 CLI 生成 | Capacitor 8 模板 |
| CocoaPods 状态 | 已进入维护模式；Specs trunk **2026-12-02** 起不再接受新 podspec | 上游与 Capawesome 迁移指南 |
| target SDK 可否自定义 | **不可**。target SDK 与 Capacitor 大版本绑定，只支持匹配值 | Capacitor Android 文档 |
| edge-to-edge | v8 移除 `adjustMarginsForEdgeToEdge`，改由 System Bars 插件管理 | Capacitor 8 插件升级指南 |
| 路由/桥 | `invoke` 语义的插件桥；`Capacitor.getPlatform()` 返回 `ios` / `android` / `web` | 上游核心库 |

**结论：移动端平台集合是 iOS + Android 两个。** 任何第三个移动平台都超出上游平台集，
必须走 §7 的例外流程。

## 3. 一包多平台（为什么不拆包）

Capacitor 的官方模型是**一个工程、多个平台目录**：`npx cap add ios` 与
`npx cap add android` 往同一个工程追加 `ios/`、`android/` 子树，共享一份
`capacitor.config.ts`、一份插件桥、一份 `webDir` 产物。

因此 iOS 与 Android 在 Capacitor 下是**同一架构、不同平台**，而不是两种架构。这与
PC 侧的情况不同：Tauri（Rust 宿主）、Electron（Node 宿主）、Capacitor 各自有独立的
原生工具链与依赖体系，所以 PC 侧按架构拆成 `-pc-tauri` / `-pc-electron` / `-pc-capacitor`
三个独立宿主包。**把同一逻辑套到 iOS/Android 上会得到 `-h5-capacitor-ios` 与
`-h5-capacitor-android` 两个包，复制两份 `capacitor.config.ts` 与插件桥，造成必然漂移。**

于是 H5 侧的规则是：

- 一个 `sdkwork-<application-code>-h5-capacitor` 包；
- 包内按平台分子树 `ios/`、`android/`，以及 `src/host/ios/`、`src/host/android/`、
  `src/plugins/sdkwork-host.ios.ts`、`src/plugins/sdkwork-host.android.ts`；
- `config/host/native/ios/` 与 `config/host/native/android/` 承载逐平台 profile 与原生片段；
- 平台间差异**全部**落在上述子树与 profile 内，不落成第二个包、第二份渲染产物、
  第二套业务包或第二个 IAM 运行时。

## 4. 平台 profile 对照

规范正文见 `APP_H5_ARCHITECTURE_SPEC.md` §2.2（契约表）与 §8.3 / §8.4（逐平台规则）。
其要点：

| 关注点 | iOS | Android |
| --- | --- | --- |
| 标识权威 | `app.identifiers.bundleId`（投射到 `appId` 与 Xcode bundle id） | `app.identifiers.packageName`（投射到 `appId` 与 Gradle `applicationId`） |
| 原生根 | `ios/App/` | `android/app/` + `variables.gradle` |
| 依赖管理 | SPM（`CapApp-SPM/Package.swift`，生成物） | Gradle wrapper + `libs.versions.toml` |
| 权限声明 | `Info.plist` usage-description | `AndroidManifest.xml` + 运行时申请流 |
| 深链 | Universal Links 主、自定义 scheme 次 | App Links（`autoVerify`）主、自定义 scheme 次 |
| 推送 | APNs | FCM |
| 安全存储 | Keychain | Android Keystore |
| 产物 | `.ipa` | `.aab` / `.apk` |
| 构建宿主 | 必须 macOS + Xcode 26+ | 任意宿主 + Android Studio Otter+ |

**不可手改的生成物**：`ios/App/CapApp-SPM/Package.swift`、`ios/App/debug.xcconfig`。
原生定制一律落在 `Info.plist`、`AppDelegate.swift`、entitlements、`Assets.xcassets/`
或 Gradle/manifest 文件。

## 5. 已落地的触点（v1.1）

| 文件 | 改动 |
| --- | --- |
| `APP_H5_ARCHITECTURE_SPEC.md` | 升 v1.1：header 改为「多平台移动打包」；§2 目录架构逐平台展开；§2.1 host 配置表拆成 shared / iOS / Android 三行并修复被散文截断的表格；§2.2 新增逐平台契约表（13 个关注点）；§2.3 安全存储/推送/发布三行逐平台化；§3 宿主包行与「一包服务多平台」规则；§5 宿主包内部形状逐平台展开；**§8 重构为父级 Mobile Host Profiles + §8.1–§8.7 平行平台章节**；§12 逐平台清单规则；§13 逐平台命令与 config 校验；§15 新增 5 条逐平台验证行与 4 条验收项 |
| `TEST_SPEC.md` | 架构矩阵行改为逐平台；§2.4.2 新增 5 条 Capacitor 逐平台测试规则；host config 测试规则补「shared + 每平台一份 profile」 |
| `NAMING_SPEC.md` | 宿主包行标注「一包服务多平台」；新增禁止 `-h5-capacitor-ios` / `-h5-capacitor-android` 的规则 |
| `APP_MOBILE_REACT_UI_SPEC.md` | host adapter 行补逐平台实现归属与禁止拆包 |
| `README.md` | H5 索引行补「一包多平台、平台 profile、禁止桌面 Capacitor 宿主」 |
| `CONFIG_SPEC.md` | `capacitor-ios` / `capacitor-android` 行补平台 profile 路径与逐平台安全存储 |

新增章节结构（`APP_H5_ARCHITECTURE_SPEC.md`）：

```text
§8   Mobile Host Profiles（父级注册表 + 选择规则）
§8.1 Browser Runtime Profiles（H5 / WeChat / WebView / PWA）
§8.2 Capacitor Host Profile（单包共享配置与插件桥）
§8.3 iOS Platform Profile
§8.4 Android Platform Profile
§8.5 Non-Adopted Mobile Platform Profiles
§8.6 Host Adapter Contract
§8.7 Mobile Bridge Protocol
```

**未重编号 §9–§15**：§9 Host Adapter Catalog 与 §8.6 是互补关系（前者是适配器清单，
后者是契约与归属规则），保持编号不动可避免全仓章节引用连锁改动。

## 6. 存量实现状态与缺口（2026-09-15 实测）

### 6.1 `config/host/` 约定（两个 H5 根一致，规范已追随该约定）

```text
config/host/
  README.md
  capacitor.<environment>.example.json
  native/
    ios/<*.snippet.plist>
    android/<*.snippet.xml>
```

`<environment>` 单段命名是既成事实且已有规范表述（非 `<deployment-profile>.<environment>`）。
已在 `APP_H5_ARCHITECTURE_SPEC.md` §2.1 写明这是**有意为之**：原生包标识、签名身份、
商店车道都是环境维度的，部署 profile 记录在 profile 文件内部字段里，而不是文件名段。

### 6.2 缺口（规范先行、实现未跟）

| 位置 | 现状 | 规范要求 |
| --- | --- | --- |
| `packages/sdkwork-birdcoder-h5-capacitor/`、`...birdcoder2-h5-capacitor/` | 仅 `package.json`、`README.md`、`specs/component.spec.json`、`src/index.ts`、`tests/`、`tsconfig.json` | 需补 `capacitor.config.ts`、`src/host/{registry,browser,ios,android}`、`src/plugins/sdkwork-host*.ts`、`resources/`、`ios/`、`android/` |
| 同上 | **无 `ios/`、无 `android/` 子树** | 每个已发布平台必须有原生子树与平台 profile |
| `config/host/capacitor.*.example.json` | birdcoder: dev/test/staging/production（缺 `demo`）；birdcoder2: dev/test/staging/demo（缺 `production`） | 五个环境示例齐全（`development`/`test`/`staging`/`demo`/`production`） |
| `config/host/native/<platform>/` profile 描述文件 | 只有 `*.snippet.plist` / `*.snippet.xml` 片段 | 需补 `<platform>.<environment>.example.json` 平台 profile |
| 平台构建命令 | 未出现在根的 `package.json` | 已发布平台需 `build:capacitor-ios*`、`build:capacitor-android*`、`check:capacitor-config*` |
| `bin/ios/`、`bin/android/` | 仅有 `README.md` 占位 | 需补构建/签名/提交助手入口 |

上表是**实现债，不是规范缺陷**。规范侧本轮已完整；实现侧由对应应用仓库另行补齐。

## 7. 未采纳平台

| 平台 | 状态 | 理由 | 替代路线 |
| --- | --- | --- | --- |
| HarmonyOS / OpenHarmony over Capacitor | **未采纳** | Capacitor 上游平台集只有 iOS / Android / Web。鸿蒙支持仅存在于社区移植（已完成部分上游与三方插件的鸿蒙化适配，经 ohpm/AtomGit 分发），不在上游平台集内，无上游兼容性与安全承诺。 | `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md` + 原生鸿蒙根 |
| 桌面 OS over Capacitor | **不属于本文件** | 桌面打包归 PC 根 | `APP_PC_ARCHITECTURE_SPEC.md`、`DESKTOP_APP_ARCHITECTURE_SPEC.md` §5.4 |
| 可安装 PWA | 不是平台 profile | 它就是 H5 浏览器 profile 加 web app manifest 与 service worker | `APP_H5_ARCHITECTURE_SPEC.md` §8.1 |

采纳上游平台集之外的平台，必须先经 `GOVERNANCE_SPEC.md` 记录例外、写明 provider 与
其维护状态、登记供应链风险，之后任何根才可依赖。

## 8. 维护规则

- Capacitor 大版本升级时，**必须**同步复核 `APP_H5_ARCHITECTURE_SPEC.md` §2.2 的
  SDK 与工具链下限行，以及 §8.3 / §8.4 的逐平台表格。
- 新增移动平台 = 在一包内加子树 + 加 profile + 加验证行 + 加构建命令；
  **不得**新建宿主包、新建渲染产物、新建业务包。
- 平台被下线时，必须同时移除其构建命令、config 校验器与 manifest 发布条目；
  半接线的平台视为缺陷。
- 与 PC 侧 `TECH-desktop-host-profiles-design.md` §13 的 Capacitor 归属切分保持同步：
  PC 根管桌面宿主，H5 根管 iOS/Android 宿主，两边不重叠。
