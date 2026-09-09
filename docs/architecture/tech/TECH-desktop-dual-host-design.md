# SDKWork PC 双宿主架构设计与优化（Tauri + Electron）

- Version: 1.0 (Design Proposal)
- Status: Proposed — pending `DESKTOP_APP_ARCHITECTURE_SPEC.md` and tooling adoption
- Related: `APP_PC_ARCHITECTURE_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`,
  `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`,
  `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `FRONTEND_SPEC.md`,
  `TYPESCRIPT_CODE_SPEC.md`, `APP_COMPOSITION_SPEC.md`,
  `tools/lib/app-publish/packagers/pc.mjs`

---

## 1. 背景与目标

SDKWork PC 应用需要**同时支持 Tauri 与 Electron 两种桌面宿主**：

1. **多架构兼容**：同一渲染层（React + Vite）可被 Tauri（Rust 宿主）和 Electron（Node 宿主）任意一个原生壳加载，互不感知。
2. **TypeScript 一致**：业务代码、服务层、宿主适配器在两种宿主下使用同一套 TypeScript 契约，编译期可验证一致性，杜绝双写漂移。
3. **底层桥接兼容**：Tauri 的 `invoke`/command 与 Electron 的 `contextBridge`/`ipcRenderer` 背后必须有一个统一的桥接协议与接口层，UI 永不直接触碰宿主全局对象。
4. **可反复打磨**：本设计落到 sdkwork-specs 体系后，规范、schema、校验器、打包器、CI 形成闭环，任意改动都有检查兜底。

---

## 2. 现状审查结论（Gap Analysis）

### 2.1 声明层已经承认双宿主（已具备）

| 位置 | 现状 |
| --- | --- |
| `APP_MANIFEST_SPEC.md` L178-179 | 规范 `clientArchitectures` 值已包含 `tauri`、`electron` |
| `APP_MANIFEST_SPEC.md` L149 | `runtime.framework` 示例已包含 `electron` |
| `CONFIG_SPEC.md` L204-210 | `SdkworkDesktopConfig.nativeHost: "tauri" \| "electron" \| "browser-installed" \| "custom"` |
| `schemas/sdkwork.app.topology.schema.v5.json` | `clientArchitectures` enum 已含 `tauri`、`electron` |
| `APP_RUNTIME_TOPOLOGY_SPEC.md` L658-665 | `clientArchitectures` 允许同一 `runtimeTarget` 下多客户端实现；默认桌面架构为 `tauri`，其他架构显式选择 |
| `tools/check-app-manifest-deployment-standard.mjs` | `desktop` 的合法架构集合为 `{tauri, electron}` |
| `tools/check-topology-deployment-profiles.mjs` | 识别 `electron` |

### 2.2 架构层缺口（Electron 只有"身份"没有"定义"）

| # | 缺口 | 证据 | 后果 |
| --- | --- | --- | --- |
| G1 | **无 Electron Host Profile** | `DESKTOP_APP_ARCHITECTURE_SPEC.md` 仅有 §5 "Tauri Host Profile"；L7 只声明 "applies to ... Electron-like shells" | 开发者不知道 Electron 的 main/preload、IPC、打包、安全基线怎么写 |
| G2 | **无统一宿主适配器契约** | `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §9 只有能力分类列表，`DESKTOP_APP_ARCHITECTURE_SPEC.md` §2/§8 只有原则（"typed methods such as `windowControl(action)`"） | 每个应用各自发明适配器接口，Tauri/Electron 实现漂移 |
| G3 | **无桥接（IPC）协议规范** | 仅要求 "SHOULD NOT import raw Tauri APIs"（DESKTOP §5），未定义统一通道、消息形状、错误码 | UI 代码可能散落 `window.__TAURI__` / `window.electron` 全局引用，换宿主即爆炸 |
| G4 | **无能力检测与降级协议** | 只有 "Web-only mode must degrade gracefully" 的原则 | 无法声明式描述"哪些能力可用"，降级逻辑靠 if-else 手写 |
| G5 | **打包器硬编码 Tauri** | `tools/lib/app-publish/packagers/pc.mjs` L113 硬编码 `src-tauri/target/release/bundle`；L82 只认 `build:desktop:local` | Electron 产物无法收集、发布流程断裂 |
| G6 | **无 Electron 包形状与配置** | 规范只有 `src-tauri/tauri.*.conf.json` | Electron 的 `electron-builder.yml`、`forge.config`、asar 策略无标准可依 |
| G7 | **无 `check:electron-config` 类验证** | 只有 `check:tauri-config` | Electron 配置无校验，泄露/越权无门禁 |
| G8 | **pnpm 脚本校验缺少 electron 工具别名** | `check-pnpm-script-standard.mjs` L131 只有 `['tauri','desktop']` | `dev:electron` 这类旧式脚本名不会被纠正 |
| G9 | **无 TypeScript 双宿主一致性门禁** | `TYPESCRIPT_CODE_SPEC.md` 未定义"同一契约接口双实现必须编译一致" | 契约与实现漂移只能靠人肉 review |
| G10 | **宿主包命名未区分** | `sdkwork-<application-code>-pc-desktop` 语义上被 Tauri 占用 | Electron 宿主包名无规范，命名混乱 |

### 2.3 结论

> 现有体系是"**识别了 electron、但未定义 electron**"：校验器允许 `clientArchitecture = electron`，却没有任何规范/工具告诉开发者如何构建、桥接、打包、验证一个 Electron 宿主。Tauri 与 Electron 的桥接差异（invoke vs contextBridge）若不加统一抽象，必然在业务代码中扩散，TypeScript 一致性无从谈起。

---

## 3. 目标架构

### 3.1 核心原则

1. **宿主无关渲染层（Host-Agnostic Renderer）**：UI/服务/SDK 层只依赖 `DesktopHost` 接口，永不 import `tauri` / `electron` / 宿主全局对象。
2. **契约单一事实源**：`@sdkwork/desktop-host-contract` 定义全部接口与类型；Tauri 实现、Electron 实现、浏览器降级实现 `satisfies` 同一契约。
3. **桥接协议统一**：renderer → host 的所有原生调用走统一的请求/响应协议；Tauri 与 Electron 只是该协议的两个传输实现。
4. **能力声明式**：每个实现声明 `capabilities` 集合，UI 依据能力集合决定交互与降级，不写平台分支。
5. **运行时目标不变**：两种宿主共享 `runtimeTarget = "desktop"`，通过 `clientArchitecture = "tauri" | "electron"` 区分实现。

### 3.2 分层结构

```text
┌────────────────────────────────────────────────────────────┐
│  Renderer (React + Vite) — host-agnostic                    │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐  │
│  │ UI 页面   │ │ Services  │ │ SDK Client│ │ 路由/状态   │  │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └────────────┘  │
│        └─────────────┼─────────────┘                       │
│                       ▼                                     │
│  ┌───────────────────────────────────────────┐             │
│  │ Host Adapter Layer（统一契约）              │             │
│  │ DesktopHost / WindowHost / TrayHost / ...  │             │
│  └───────────────────┬───────────────────────┘             │
└──────────────────────┼──────────────────────────────────────┘
                       ▼
        ┌───────────────────────────┐
        │  Bridge Protocol (IPC)    │  统一消息协议（见 §5）
        └────────────┬──────────────┘
             ┌───────┴───────┐
             ▼               ▼
   ┌─────────────────┐  ┌──────────────────┐
   │ Tauri Impl      │  │ Electron Impl    │
   │ invoke + Rust   │  │ contextBridge +  │
   │ commands        │  │ ipcRenderer      │
   └─────────────────┘  └──────────────────┘
             └──────┬───────┘
                    ▼
   ┌──────────────────────────────────┐
   │ Native Capability: window/tray/  │
   │ fs/updater/deep-link/secure-store│
   └──────────────────────────────────┘
```

### 3.3 与现有规范的关系

| 现有规范 | 本设计引入的扩展 |
| --- | --- |
| `DESKTOP_APP_ARCHITECTURE_SPEC.md` | 新增 §"Electron Host Profile"；§5 Tauri Profile 改为引用统一契约；新增 §"Host Adapter Contract" |
| `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §9 | 从能力分类列表升级为接口契约（引用契约包），补充 `capabilities` 声明与降级协议 |
| `APP_RUNTIME_TOPOLOGY_SPEC.md` L664 | 默认桌面架构保持 `tauri`；新增 `electron` 为显式架构；运行时计划输出 `clientArchitecture` |
| `APP_MANIFEST_SPEC.md` | `clientArchitectures` 增加 `tauri`/`electron` 与包名 `-pc-desktop`/`-pc-electron` 的映射约束 |
| `CONFIG_SPEC.md` | `SdkworkDesktopConfig` 扩展 `bridge` 传输配置（可选） |
| `tools/lib/app-publish/packagers/pc.mjs` | 按 `clientArchitecture` 分派 Tauri/Electron 产物收集 |
| `check-pnpm-script-standard.mjs` | 增加 `['electron','desktop']` 工具别名映射 |
| 新增 | `@sdkwork/desktop-host-contract` 契约包；`check:electron-config`；双宿主静态扫描 |

---

## 4. 统一宿主适配器契约（核心交付）

### 4.1 能力标识（对齐 `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §9）

```ts
// contract/capabilities.ts
export type DesktopHostCapability =
  | "window"          // 窗口控制、最小化/最大化/置顶/尺寸
  | "tray"            // 系统托盘
  | "deepLinks"       // 自定义协议/深链
  | "notifications"   // 系统通知
  | "clipboard"       // 剪贴板
  | "filePicker"      // 文件选择器
  | "filesystemSandbox" // 受控文件系统读写（用户私有目录）
  | "shellOpen"       // shell 打开（外部链接/文件）
  | "updater"         // 自动更新
  | "secureStorage"   // 安全存储（token/密钥）
  | "networkStatus"   // 网络状态
  | "appLifecycle"    // 应用生命周期
  | "deviceInfo"      // 设备信息
  | "process"         // 进程/本地运行时生命周期
  | "localRuntime"    // 本地网关/本地服务编排
  | "powerMonitor";   // 电源状态（可选）

export const DESKTOP_HOST_CAPABILITIES: readonly DesktopHostCapability[] = [
  "window", "tray", "deepLinks", "notifications", "clipboard",
  "filePicker", "filesystemSandbox", "shellOpen", "updater",
  "secureStorage", "networkStatus", "appLifecycle", "deviceInfo",
  "process", "localRuntime", "powerMonitor",
];
```

### 4.2 统一宿主接口

```ts
// contract/desktop-host.ts
import type { DesktopHostCapability } from "./capabilities";

/** 稳定错误码 —— 渲染层只消费 code，不解析宿主原始错误 */
export type DesktopHostErrorCode =
  | "unsupported"        // 宿主不提供该能力
  | "permission-denied"  // 权限被拒
  | "unavailable"        // 能力暂时不可用
  | "cancelled"          // 用户取消
  | "invalid-state"      // 状态非法
  | "internal";          // 宿主内部错误（不含敏感细节）

export interface DesktopHostError {
  code: DesktopHostErrorCode;
  message: string;      // 用户安全文案（可 i18n key）
  detail?: string;      // 诊断码，禁止敏感信息
}

export interface DesktopHostResult<T> {
  ok: true;
  value: T;
}

export interface DesktopHostFailure {
  ok: false;
  error: DesktopHostError;
}

export type DesktopHostOutcome<T> = DesktopHostResult<T> | DesktopHostFailure;

/** 宿主身份与能力声明 */
export interface DesktopHostMeta {
  readonly id: "tauri" | "electron" | "browser" | "custom";
  readonly version: string;                 // 宿主自身版本
  readonly capabilities: ReadonlySet<DesktopHostCapability>;
  readonly platform: NodeJS.Platform | "web";
  readonly releaseChannel?: "stable" | "beta" | "dev";
}

/** 窗口宿主 */
export interface WindowHost {
  minimize(): Promise<DesktopHostOutcome<void>>;
  maximize(): Promise<DesktopHostOutcome<void>>;
  unmaximize(): Promise<DesktopHostOutcome<void>>;
  toggleMaximize(): Promise<DesktopHostOutcome<void>>;
  close(): Promise<DesktopHostOutcome<void>>;
  isMaximized(): Promise<DesktopHostOutcome<boolean>>;
  setAlwaysOnTop(flag: boolean): Promise<DesktopHostOutcome<void>>;
  setSize(size: { width: number; height: number }): Promise<DesktopHostOutcome<void>>;
  getSize(): Promise<DesktopHostOutcome<{ width: number; height: number }>>;
  startDragging(): Promise<DesktopHostOutcome<void>>;
}

/** 系统托盘宿主 */
export interface TrayHost {
  setMenu(menu: TrayMenuItem[]): Promise<DesktopHostOutcome<void>>;
  setTooltip(text: string): Promise<DesktopHostOutcome<void>>;
  showBalloon(opts: { title: string; body: string }): Promise<DesktopHostOutcome<void>>;
  onActivate(cb: () => void): () => void;
}

export interface TrayMenuItem {
  id: string;
  label: string;
  enabled?: boolean;
  checked?: boolean;
  type?: "normal" | "separator" | "checkbox" | "radio";
  onClick?: () => void;
}

/** 深链宿主 */
export interface DeepLinkHost {
  /** 返回应用启动时被唤起（如有）的 URL，且仅一次 */
  getInitialUrl(): Promise<DesktopHostOutcome<string | null>>;
  onOpenUrl(cb: (url: string) => void): () => void;
  /** 注册自定义协议（安装期/运行期声明式） */
  registerScheme(scheme: string): Promise<DesktopHostOutcome<void>>;
}

/** 通知宿主 */
export interface NotificationHost {
  show(opts: { title: string; body: string; icon?: string }): Promise<DesktopHostOutcome<void>>;
  isPermissionGranted(): Promise<DesktopHostOutcome<boolean>>;
}

/** 文件/目录宿主 */
export interface FilePickerHost {
  openFile(opts: {
    filters?: Array<{ name: string; extensions: string[] }>;
    multiple?: boolean;
  }): Promise<DesktopHostOutcome<string[]>>;
  openDirectory(): Promise<DesktopHostOutcome<string[]>>;
  saveFile(opts: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<DesktopHostOutcome<string | null>>;
}

/** 受控文件系统宿主 —— 仅限用户私有运行时命名空间，禁止任意路径漫游 */
export interface FilesystemSandboxHost {
  readTextFile(relPath: string): Promise<DesktopHostOutcome<string>>;
  writeTextFile(relPath: string, content: string): Promise<DesktopHostOutcome<void>>;
  exists(relPath: string): Promise<DesktopHostOutcome<boolean>>;
  list(relPath: string): Promise<DesktopHostOutcome<string[]>>;
  remove(relPath: string): Promise<DesktopHostOutcome<void>>;
}

/** 剪贴板宿主 */
export interface ClipboardHost {
  writeText(text: string): Promise<DesktopHostOutcome<void>>;
  readText(): Promise<DesktopHostOutcome<string>>;
}

/** 安全存储宿主 —— token/密钥专用，禁止业务数据滥用 */
export interface SecureStorageHost {
  get(key: string): Promise<DesktopHostOutcome<string | null>>;
  set(key: string, value: string): Promise<DesktopHostOutcome<void>>;
  delete(key: string): Promise<DesktopHostOutcome<void>>;
}

/** 更新宿主 */
export interface UpdaterHost {
  check(): Promise<DesktopHostOutcome<{ available: boolean; version?: string; releaseNotes?: string }>>;
  downloadAndInstall(): Promise<DesktopHostOutcome<void>>;
  onDownloadProgress(cb: (p: { percent: number }) => void): () => void;
}

/** 本地运行时（本地网关/服务）宿主 */
export interface LocalRuntimeHost {
  start(opts: { profileId: string }): Promise<DesktopHostOutcome<{ baseUrl: string; pid?: number }>>;
  stop(): Promise<DesktopHostOutcome<void>>;
  status(): Promise<DesktopHostOutcome<"stopped" | "starting" | "ready" | "crashed">>;
  onStatusChange(cb: (s: "stopped" | "starting" | "ready" | "crashed") => void): () => void;
}

/** 宿主注册表 —— bootstrap 唯一入口 */
export interface DesktopHost {
  readonly meta: DesktopHostMeta;
  readonly window: WindowHost;
  readonly tray: TrayHost;
  readonly deepLinks: DeepLinkHost;
  readonly notifications: NotificationHost;
  readonly filePicker: FilePickerHost;
  readonly filesystemSandbox: FilesystemSandboxHost;
  readonly clipboard: ClipboardHost;
  readonly secureStorage: SecureStorageHost;
  readonly updater: UpdaterHost;
  readonly localRuntime: LocalRuntimeHost;

  /** 能力查询：UI 层唯一允许的平台分支 */
  hasCapability(cap: DesktopHostCapability): boolean;
  /** 释放所有订阅（logout/登出清理时调用） */
  dispose(): void;
}
```

### 4.3 能力检测与降级协议

```ts
// contract/capability-router.ts
/**
 * 渲染层只允许通过本函数按能力路由，禁止 `window.__TAURI__`/`electron`
 * 全局分支。
 *
 * @example
 * const { value } = await withCapability(host, "secureStorage",
 *   (s) => s.get("session_token"),
 *   { fallback: () => null });   // 浏览器降级：返回 null
 */
export async function withCapability<T>(
  host: DesktopHost,
  cap: DesktopHostCapability,
  run: (impl: DesktopHost) => Promise<T>,
  opts: { fallback?: () => T | Promise<T> } = {},
): Promise<DesktopHostOutcome<T>> {
  if (host.hasCapability(cap)) {
    try {
      return { ok: true, value: await run(host) };
    } catch (e) {
      return { ok: false, error: toHostError(e) };
    }
  }
  if (opts.fallback !== undefined) {
    try {
      return { ok: true, value: await opts.fallback() };
    } catch (e) {
      return { ok: false, error: toHostError(e) };
    }
  }
  return {
    ok: false,
    error: { code: "unsupported", message: "capability.not_supported" },
  };
}
```

---

## 5. 桥接（IPC）协议

### 5.1 消息形状

```ts
// contract/bridge-protocol.ts
/** renderer -> host 请求 */
export interface BridgeRequest {
  v: 1;
  id: string;                 // 单调递增的调用 id，用于关联响应
  method: string;             // "sdkwork:window:minimize" 三段式
  params?: unknown;
  meta?: { traceId?: string; origin: "renderer" };
}

/** host -> renderer 响应 */
export type BridgeResponse =
  | { v: 1; id: string; ok: true; result?: unknown }
  | { v: 1; id: string; ok: false; error: { code: DesktopHostErrorCode; message: string; detail?: string } };

/** host -> renderer 主动事件（托盘点击、深链唤起、更新进度…） */
export interface BridgeEvent {
  v: 1;
  event: string;              // "sdkwork:deepLinks:open"
  payload?: unknown;
}
```

### 5.2 方法命名规范

```text
sdkwork:<capability>:<action>
sdkwork:window:minimize
sdkwork:window:isMaximized
sdkwork:deepLinks:getInitialUrl
sdkwork:secureStorage:get
sdkwork:localRuntime:start
sdkwork:updater:check
```

- `capability` 必须来自 §4.1 的 `DesktopHostCapability`。
- 事件名 `sdkwork:<capability>:<eventName>`。
- 任何 `method`/`event` 不得携带业务语义（如 `sdkwork:orders:create` 一律禁止）。

### 5.3 传输实现

#### Tauri 实现（Rust 端）

Rust command 是能力命令的薄封装，按 `DESKTOP_APP_ARCHITECTURE_SPEC.md` §5 的"命令按宿主能力命名"：

```rust
// src-tauri/src/commands/window.rs
#[tauri::command]
pub fn sdkwork_window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| safe_message(e))
}

// src-tauri/src/commands/secure_storage.rs
#[tauri::command]
pub async fn sdkwork_secure_storage_get(
    state: tauri::State<'_, SecureStore>,
    key: String,
) -> Result<Option<String>, String> {
    state.get(&key).await.map_err(|e| safe_message(e))
}
```

Tauri 侧 adapter（renderer 端）：

```ts
// adapters/tauri/tauri-desktop-host.ts
import { invoke } from "@tauri-apps/api/core";
import type { DesktopHost, WindowHost } from "@sdkwork/desktop-host-contract";

const windowHost: WindowHost = {
  minimize: () => call("sdkwork:window:minimize"),
  isMaximized: () => call<boolean>("sdkwork:window:isMaximized"),
  // ...
};

async function call<T>(method: string, params?: unknown): Promise<DesktopHostOutcome<T>> {
  try {
    const result = await invoke<T>(method, { params });
    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: normalizeError(e) };
  }
}

export function createTauriDesktopHost(): DesktopHost {
  return {
    meta: {
      id: "tauri",
      version: "2",
      capabilities: detectTauriCapabilities(),
      platform: detectPlatform(),
    },
    window: windowHost,
    // ... 其余能力
    hasCapability: (cap) => capabilities.has(cap),
    dispose: () => { /* 取消监听 */ },
  };
}
```

#### Electron 实现（Preload + Main）

Preload 是**唯一**允许暴露 `window.electron` 的地方，且只暴露白名单方法：

```ts
// src-electron/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";

const CAPABILITY_METHODS = {
  "sdkwork:window:minimize": true,
  "sdkwork:window:isMaximized": true,
  "sdkwork:secureStorage:get": true,
  // ... 白名单由契约方法表生成，禁止通配透传
} as const;

contextBridge.exposeInMainWorld("sdkworkHost", {
  call: (method: string, params?: unknown) => {
    if (!(method in CAPABILITY_METHODS)) {
      return Promise.reject({ code: "unsupported", message: "method not allowed" });
    }
    return ipcRenderer.invoke(method, params); // channel 名 == method 名
  },
  on: (event: string, cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
```

Main 进程注册 handler：

```ts
// src-electron/main/ipc.ts
import { ipcMain, BrowserWindow } from "electron";

export function registerIpc(win: BrowserWindow, ctx: HostContext): void {
  ipcMain.handle("sdkwork:window:minimize", () => {
    win.minimize();
    return { ok: true, result: undefined };
  });
  ipcMain.handle("sdkwork:secureStorage:get", (_e, params) =>
    ctx.secureStore.get(params.key),
  );
}
```

Electron adapter（renderer 端）与 Tauri adapter 实现**同一个** `DesktopHost` 接口：

```ts
// adapters/electron/electron-desktop-host.ts
import type { DesktopHost, WindowHost } from "@sdkwork/desktop-host-contract";

declare global {
  interface Window {
    sdkworkHost?: {
      call(method: string, params?: unknown): Promise<unknown>;
      on(event: string, cb: (payload: unknown) => void): () => void;
    };
  }
}

export function createElectronDesktopHost(): DesktopHost {
  // 实现与 tauri adapter 同构，仅传输层不同
}
```

#### 浏览器降级实现

```ts
// adapters/browser/browser-desktop-host.ts
/** runtimeTarget = browser 或 宿主 API 缺失时使用 */
export function createBrowserDesktopHost(): DesktopHost {
  return {
    meta: { id: "browser", version: "0", capabilities: new Set(), platform: "web" },
    window: unsupportedWindowHost(),   // 每个方法返回 { ok:false, error:{code:"unsupported",...} }
    hasCapability: () => false,
    dispose: () => {},
    // ...
  };
}
```

---

## 6. TypeScript 一致性策略

### 6.1 契约包单一事实源

- 新建 **`@sdkwork/desktop-host-contract`**（归属 `sdkwork-utils` 或独立 `sdkwork-desktop-host` 仓库），仅含类型 + 纯函数（`withCapability`、错误归一化），**零运行时宿主依赖**。
- 三个实现（tauri / electron / browser）各自 `package.json#dependencies` 声明该契约包。

### 6.2 编译期一致性门禁

```ts
// adapters/tauri/index.ts
import type { DesktopHost } from "@sdkwork/desktop-host-contract";
const host: DesktopHost = createTauriDesktopHost(); // 类型不满足即编译失败

// adapters/electron/index.ts
const host: DesktopHost = createElectronDesktopHost();
```

- 强制 `satisfies DesktopHost`（或变量标注），缺失方法、错误签名在 `tsc` 阶段即失败。
- 契约变更（新增能力）后，Tauri/Electron/Browser 三个实现**必须**同时补齐，否则仓库 `pnpm typecheck` 红。

### 6.3 一致性测试

```ts
// tests/host-contract-parity.test.ts
const implementations = {
  tauri: createTauriDesktopHost(),
  electron: createElectronDesktopHost(),
  browser: createBrowserDesktopHost(),
};

it("所有宿主声明相同能力集合键", () => {
  const keys = (h: DesktopHost) => [...h.meta.capabilities].sort();
  expect(keys(implementations.tauri)).toEqual(expect.arrayContaining(keys(implementations.electron)));
  expect(keys(implementations.electron)).toEqual(expect.arrayContaining(keys(implementations.tauri)));
});

it("window 接口方法签名一致", () => {
  const methodNames = (w: WindowHost) => Object.keys(w).sort();
  expect(methodNames(implementations.tauri.window)).toEqual(methodNames(implementations.electron.window));
});
```

### 6.4 与现有 TS 规范的关系

- 遵循 `TYPESCRIPT_CODE_SPEC.md`：契约包 `src/index.ts` 稳定导出边界；adapter 包遵守 `src/adapters/` 布局；禁止跨包 `/src/` 导入。
- 遵循 `FRONTEND_SPEC.md` §8：宿主调用必须走 host adapter，feature 包只依赖注入的 `DesktopHost` 接口。

---

## 7. Electron Host Profile（规范新增）

### 7.1 包形状

```text
apps/sdkwork-<application-code>-pc/
  packages/
    sdkwork-<application-code>-pc-desktop/          # Tauri 宿主（现状保留）
      src-tauri/
    sdkwork-<application-code>-pc-electron/          # Electron 宿主（新增）
      package.json
      electron-builder.yml                          # 或 electron-forge.config.mjs
      src-electron/
        main/
          index.ts
          window.ts
          ipc.ts
          secure-store.ts
          updater.ts
          deep-links.ts
          tray.ts
        preload/
          index.ts
        shared/
          ipc-channels.ts                           # 与契约包生成结果一致
      resources/
        icons/
      release/                                      # 产物输出（gitignore）
```

命名规则：

- Tauri 宿主包名保持 `sdkwork-<application-code>-pc-desktop`（向后兼容）。
- Electron 宿主包名 `sdkwork-<application-code>-pc-electron`。
- 两包必须消费同一渲染产物（`frontendDist`），不得 fork renderer。

### 7.2 安全基线（Electron 强制）

| 项 | 要求 |
| --- | --- |
| `contextIsolation` | `true`（强制） |
| `nodeIntegration` | `false`（强制） |
| `sandbox` | `true`（默认；需要 `fs` 时通过受限 IPC 暴露，不开 sandbox=false） |
| `webSecurity` | `true`（强制） |
| 预加载脚本 | 仅 `src-electron/preload/index.ts`，白名单方法表（见 §5.3） |
| 任意路径访问 | 禁止；`fs` 仅经 `filesystemSandbox` 且限定用户私有运行时目录 |
| 远程内容 | 生产环境禁止 `loadURL` 到非白名单源；一律 `loadFile` 渲染产物 |
| 自动更新 | 签名校验 + 发布通道声明，遵循 `SUPPLY_CHAIN_SECURITY_SPEC.md` |

### 7.3 配置与打包

- `electron-builder.yml` 或 `electron-forge.config.mjs` 声明 productName、appId、artifactName、targets（nsis/dmg/AppImage/deb）、签名引用（与 Tauri 同级的签名引用规范，不存私钥）。
- 产物目录：`release/`（electron-builder 默认 `release/`；forge 默认 `out/`），由打包器按架构识别。
- asar：`asar: true`（默认），排除敏感模板（`config/**` 运行时值不入包）。
- 运行时目录遵循 `RUNTIME_DIRECTORY_SPEC.md`：Electron 用 `app.getPath("userData")` 下的 SDKWork 命名空间。

### 7.4 命令（遵循 `PNPM_SCRIPT_SPEC.md` action-first）

```text
dev:desktop                     # 默认宿主 = tauri（向后兼容）
dev:desktop:electron            # 显式 Electron 宿主（宿主选择属于私有实现，不再作为公开命令别名）
build:desktop:electron
build:desktop:electron:staging
build:desktop:electron:prod
check:electron-config           # 对标 check:tauri-config
test:desktop:electron
```

- 渲染层 dev server host/port 与宿主 `devUrl`/`ELECTRON_START_URL` 一致，端口冲突即失败（对齐现有规则）。
- 工具别名映射：`check-pnpm-script-standard.mjs` 增加 `['electron', 'desktop']`。

---

## 8. 打包与发布

### 8.1 打包器双宿主识别（改造 `pc.mjs`）

```ts
// tools/lib/app-publish/packagers/pc.mjs —— 改造要点
function desktopBundleRoot(appRoot, clientArchitecture) {
  if (clientArchitecture === "electron") {
    // electron-builder: release/ ; forge: out/
    return [path.join(appRoot, "release"), path.join(appRoot, "out")]
      .find((p) => fs.existsSync(p));
  }
  return path.join(appRoot, "src-tauri", "target", "release", "bundle"); // tauri 默认
}
```

- `detect()` 从 manifest `artifacts.installConfig.packages[]` 的 `clientArchitecture` 读取宿主类型，`platform` 保持 `windows/macos/linux` 不变。
- `collectArtifacts()` 按宿主分派产物目录与匹配模式：
  - Tauri：`.exe/.msi`、`.dmg`、`.AppImage/.deb`（现状）
  - Electron：`.exe/.msi/.nsis`、`.dmg`、`.AppImage/.deb`、`.blockmap`
- 同一应用根可声明两种宿主的发布包（`clientArchitecture` 不同），互不冲突。

### 8.2 产物矩阵

| runtimeTarget | clientArchitecture | 宿主包 | 产物 |
| --- | --- | --- | --- |
| desktop | tauri | `-pc-desktop` | `.exe/.msi/.dmg/.AppImage/.deb` |
| desktop | electron | `-pc-electron` | `.exe/.msi/.dmg/.AppImage/.deb/.blockmap` |
| browser | pc-web | — | `dist/` web bundle |

### 8.3 发布一致性

- 两种宿主的发布元数据（productName、identifier、version、icons、签名引用）必须一致，来自同一 manifest。
- 双宿主不得各自定义版本号；版本只由 `sdkwork.app.config.json`/release 流程持有。

---

## 9. 验证与质量门

### 9.1 新增验证

| 验证 | 工具/命令 | 断言 |
| --- | --- | --- |
| 契约一致性 | `pnpm typecheck` + parity 测试 | 三实现（tauri/electron/browser）满足同一 `DesktopHost` 接口 |
| Electron 配置 | `pnpm check:electron-config` | 对标 `check:tauri-config`：安全基线、secret 缺失、产物目录、profile 归一、签名引用合规 |
| 宿主全局禁令 | 静态扫描 | feature 包不得出现 `window.__TAURI__`、`window.electron`、`require("electron")`、`import ... from "tauri"`；只允许 `@sdkwork/desktop-host-contract` 与注入的宿主接口 |
| IPC 白名单 | 静态扫描 | Electron preload 只暴露白名单 method；Tauri 只注册能力命令 |
| 打包器 | `publish-app` 冒烟 | tauri/electron 产物均能收集 |
| pnpm 脚本 | `check-pnpm-script-standard` | 新增 `['electron','desktop']` 别名映射 |

### 9.2 对现有规范文件的修改清单

| 文件 | 修改 |
| --- | --- |
| `DESKTOP_APP_ARCHITECTURE_SPEC.md` | 新增 §5.2 Electron Host Profile；§5 改为"Tauri Host Profile（引用统一契约）"；新增 §"Host Adapter Contract & Bridge Protocol"；§4 包形状补 `-pc-electron`；§10 验证表补 Electron 行 |
| `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` | §9 能力分类升级为契约引用；补充 `hasCapability`/`withCapability` 降级协议 |
| `APP_RUNTIME_TOPOLOGY_SPEC.md` | L664 附近补充 `electron` 显式架构与运行时计划输出字段 |
| `APP_MANIFEST_SPEC.md` | 补充 `tauri`/`electron` 与宿主包名映射约束；`installConfig` 双宿主示例 |
| `CONFIG_SPEC.md` | `SdkworkDesktopConfig` 增加可选 `bridgeTransport` 说明（默认 auto-detect） |
| `FRONTEND_SPEC.md` | §8 补充：宿主调用仅允许注入的 `DesktopHost`，禁止宿主全局 |
| `PNPM_SCRIPT_SPEC.md` | 登记 `dev:desktop:electron` 等命令与别名映射 |
| `tools/lib/app-publish/packagers/pc.mjs` | 双宿主产物分派（§8.1） |
| `tools/check-pnpm-script-standard.mjs` | 增加 `['electron','desktop']` |
| 新增 | `@sdkwork/desktop-host-contract` 契约包；`check:electron-config` 校验器；双宿主静态扫描器 |

---

## 10. 迁移路径

### 阶段 0（现状）：Tauri 单宿主
- 现有 `-pc-desktop` + `src-tauri` 不动。

### 阶段 1：契约落地，Tauri 先行
1. 创建 `@sdkwork/desktop-host-contract`（§4 全部接口 + §5 协议类型）。
2. `pc-core/src/host/` 内实现 `createTauriDesktopHost()` 与 `createBrowserDesktopHost()`。
3. 现有 feature 代码中散落的 `window.__TAURI__` 迁移到注入的 `DesktopHost`（静态扫描兜底）。
4. 契约 parity 测试 + `withCapability` 降级接入。

### 阶段 2：Electron 宿主
1. `DESKTOP_APP_ARCHITECTURE_SPEC.md` 增补 §5.2 Electron Host Profile（本设计 §7）。
2. 新建 `sdkwork-<application-code>-pc-electron`（main/preload/shared + `electron-builder.yml`）。
3. `pc.mjs` 双宿主分派 + `check:electron-config`。
4. 首个应用（建议 `sdkwork-manager` 或 `sdkwork-cloudrouter` 这类桌面优先应用）双宿主冒烟。

### 阶段 3：双宿主质量闭环
1. CI 双矩阵：同一渲染产物分别打 Tauri 与 Electron 包，运行架构契约测试。
2. `verify-repo.mjs` 集成宿主全局禁令扫描。
3. README 任务矩阵更新，验收清单收口（§11）。

---

## 11. 验收清单

- [ ] `@sdkwork/desktop-host-contract` 存在且零宿主运行时依赖。
- [ ] Tauri/Electron/Browser 三个实现满足同一 `DesktopHost` 接口（`tsc` 编译期强制）。
- [ ] feature 包静态扫描零命中 `window.__TAURI__`/`window.electron`/`require("electron")`。
- [ ] Electron preload 只暴露白名单 IPC method，`contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。
- [ ] `check:electron-config` 通过：安全基线、secret 缺失、产物目录、profile 归一。
- [ ] `pc.mjs` 能分别收集 tauri 与 electron 产物（冒烟通过）。
- [ ] `pnpm dev:desktop` 默认 tauri（向后兼容），`pnpm dev:desktop:electron` 可用。
- [ ] 同一渲染产物可被两种宿主加载，无宿主分支 UI 代码。
- [ ] 双宿主版本/签名/发布元数据来自同一 manifest。
- [ ] 本设计对应规范修改（§9.2）已并入对应 `*_SPEC.md`。

---

## 12. 关键决策记录（ADR 摘要）

| 决策 | 选项 | 选定 | 理由 |
| --- | --- | --- | --- |
| 宿主包命名 | `-pc-desktop` 双宿主 vs `-pc-desktop` + `-pc-electron` | 双包 | 原生依赖隔离（Rust vs Node）、CI 独立、避免 `nodeIntegration` 与 `src-tauri` 同仓污染 |
| 默认宿主 | tauri vs electron | tauri | 向后兼容；Tauri 是现状首选宿主 |
| 契约归属 | 独立仓库 vs 并入 utils | 独立 `sdkwork-desktop-host` 契约包 | 契约独立演进、被多应用引用 |
| IPC 形态 | invoke 直接透传 vs 统一协议 | 统一协议（§5） | 双宿主同一语义，能力方法白名单可静态校验 |
| 渲染层宿主访问 | 全局单例 vs 注入 | 注入（bootstrap 组装，`APP_SDK_INTEGRATION_SPEC.md` 对齐） | 可测试、可降级、可替换 |
