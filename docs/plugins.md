# 插件系统（宿主/插件契约）

目标：**本体独立运行**，插件只依赖宿主暴露的稳定契约（Plugin API），不依赖本体内部实现细节。

## 插件开发（多模块/独立依赖）

运行时约束不变：宿主依然只会读取 `manifest.main` 指向的 **单个 JS 文件**，注入 iframe 执行。

开发体验的“多模块/独立依赖”，通过 **pnpm workspace + 构建期打包**实现：

- 每个插件目录可以有自己的 `package.json`，在里面写自己的 `dependencies`
- 根目录统一 `pnpm install`（生成 1 份 `pnpm-lock.yaml`，依赖按各包的依赖图隔离）
- 通过一条命令把插件源码（多文件/多依赖）打包成 `manifest.main` 对应的单文件入口

### 目录结构（推荐）

```
plugins/<id>/
  manifest.json          # main 指向最终产物（例如 index.js）
  package.json           # 插件自己的依赖（可选，但推荐）
  src/index.ts           # 默认入口（可自定义，见下）
  index.js               # 构建输出（被宿主加载）
```

### 插件构建配置（可选）

在 `plugins/<id>/package.json` 里加：

- `fastWindowPlugin.entry`：UI/单入口源码入口（相对路径）
- `fastWindowPlugin.backgroundEntry`：当 `manifest.background.main` 存在且不同于 `main` 时的后台源码入口（相对路径）

### 命令

- `pnpm plugins:build`：构建所有“可打包”的插件（有源码入口的插件）；纯手写单文件的插件会被跳过
- `pnpm plugins:watch`：监听并自动重建插件产物（开发用）
- `pnpm dev:all`：同时跑 `plugins:watch` + `vite dev`
- `pnpm tauri`：已接入 `plugins:build`，确保打包/运行前插件产物是最新

## 插件商店与发布（GitHub 分发）

分发仓库（静态 `index.json` + GitHub Releases 资产 ZIP）：

- 仓库：https://github.com/noelle-silva/fast-window-plugins-download
- Releases（插件 ZIP 发布页）：https://github.com/noelle-silva/fast-window-plugins-download/releases
- 商店索引（宿主默认内置）：https://raw.githubusercontent.com/noelle-silva/fast-window-plugins-download/main/index.json

### index.json 结构（商店目录）

```json
{
  "registry_version": 1,
  "plugins": [
    {
      "id": "memo",
      "name": "快捷备忘录",
      "description": "描述",
      "version": "1.0.0",
      "download_url": "https://github.com/.../releases/download/vmemo-1.0.0/memo-1.0.0.zip",
      "sha256": "zip 的 sha256（hex）",
      "requires": ["tauri:plugin:store|load"]
    }
  ]
}
```

约定：

- 仅保留最新版（每个插件只存 1 条记录）
- Release tag：`v<pluginId>-<version>`
- ZIP 文件名：`<pluginId>-<version>.zip`

### 发布命令（自动更新 index + 上传 Release）

准备 Fine-grained Token，并配置环境变量：

- `FAST_WINDOW_GITHUB_TOKEN=...`（也兼容 `GITHUB_TOKEN` / `GH_TOKEN`）

发布单个插件：

```bash
pnpm run plugins:publish:download -- --plugin <pluginId>
```

发布全部插件（遍历 `plugins/`）：

```bash
pnpm run plugins:publish:download -- --all
```

常用参数：

- `--dry-run`：只生成 zip/index 预览，不 push、不创建 Release
- `--no-build`：跳过插件构建（仅用于已经是单文件入口/预构建插件）
- `--force`：强制覆盖同版本（不推荐）

版本不可变（强制）：同一个 `pluginId@version` 已发布就 **禁止覆盖**。要升级请改 `plugins/<pluginId>/manifest.json` 的 `version`。

实现细节（你只需要知道会发生什么）：

- `plugin-store/` 是分发仓库的 clone 工作区（独立 git 仓库），主仓库会忽略它；脚本会在缺失时自动 `git clone`
- ZIP 默认输出到 `.tmp/dist-plugin-zips/`（临时产物，可随时删除）

## Manifest（`plugins/<id>/manifest.json`）

最小字段：

- `id`：插件 ID（目录名建议一致）
- `name` / `version` / `description`（可选：`author`）
- `main`：入口文件

新增契约字段（v2 起为必填/强约束）：

- `apiVersion`：宿主契约版本（当前为 `2`）
- `requires`：能力申请列表（**必填**；未声明的能力调用会被宿主拒绝）
- `ui.type`：目前仅支持 `iframe`（**必填**；沙箱模式；`sandbox iframe` 执行，通过 `postMessage` 调宿主能力）。
- `ui.keepAlive`：是否保活 UI（可选；默认 `false`）。开启后返回主界面时不卸载 iframe，再次打开可秒开并保留状态（代价是占用内存/可能继续跑定时器）。
- （已废弃）`allowOverwriteOnUpdate`：旧版用于记录“允许随包覆盖更新”的宿主偏好；新版不再读取/写入该字段（偏好由宿主独立配置文件保存，见下文“目录与数据”）。当前宿主的相关偏好是“插件自动更新”。
- `background`：后台运行策略（可选）
  - `autoStart?: boolean`：是否启动即运行后台上下文（默认 `true`）
  - `main?: string`：可选 legacy 双入口；不填时默认复用 `main`（推荐单入口）
- `icon`：列表显示图标（可选，emoji 字符串）
- `keyword`：快速直达关键字（可选；在主界面搜索框里输入完全匹配时命中）

示例（iframe 插件，单入口 + 后台自启动）：

```json
{
  "id": "hello-iframe",
  "name": "Hello Iframe",
  "version": "1.0.0",
  "description": "demo",
  "main": "index.js",
  "background": { "autoStart": true },
  "ui": { "type": "iframe" },
  "apiVersion": 2,
  "requires": [
    "tauri:plugin:clipboard-manager|read_text",
    "tauri:plugin:store|load",
    "tauri:plugin:store|get",
    "tauri:plugin:store|set",
    "tauri:plugin:store|save"
  ]
}
```

## 能力（`requires`）

宿主只接受一种能力声明：**`tauri:<command>`**。

- 插件侧只通过 `fastWindow.tauri.invoke({ command, payload })` / `fastWindow.tauri.streamOpen(...)` 发起调用。
- 宿主侧只做：鉴权 + 载荷/超时限制 + 透传到 Tauri/Rust。

常见写法：

- 精确命令：`tauri:plugin:fs|read_text_file`
- 前缀通配：`tauri:plugin:fs|*`
- 全通配：`tauri:*`（不建议，等同“放弃权限隔离”）

事件监听（复用同一鉴权引擎）：

- 伪命令：`event.listen|<eventName>`
- 需要在 `requires` 里声明：`tauri:event.listen|<eventName>`

高危特例：

- `plugin:shell|*` 这种通配会被宿主拒绝，必须精确到 `tauri:plugin:shell|execute`。

## Iframe 插件运行方式

iframe 插件入口 `main` 目前按 **JS 文件**处理：宿主会把它注入 `srcdoc`，并在 iframe 内提供 `window.fastWindow`：

- `fastWindow.__meta.runtime`：`'ui' | 'background'`
- `fastWindow.host.back()`：请求宿主返回（不需要在 `requires` 里声明）
- `fastWindow.tauri.invoke({ command, payload, timeoutMs? })`
- `fastWindow.tauri.streamOpen({ command, payload, channelKey?, timeoutMs?, detached?, cancel? })`
- `fastWindow.tauri.streamCancel(streamId)`
- `fastWindow.tauri.stream(spec)`：返回 `AsyncIterator`（封装 `streamOpen` + `streamCancel`）

注意：旧的 `fastWindow.storage/net/files/ui/clipboard/task/migrations` 已移除；建议插件自己封装 compat（或未来抽到 `@fast-window/plugin-sdk`），把语义化 API 映射到 `tauri.invoke`。

运行时元信息：

- 单入口插件可在同一文件内按 runtime 分支：
  - `runtime === 'ui'`：渲染界面、处理交互
  - `runtime === 'background'`：常驻后台轮询任务、落盘、同步状态

推荐范式：

- 默认使用 **单入口**（`main`）+ `background.autoStart`
- 插件自己在入口里根据 `__meta.runtime` 分流逻辑
- 宿主只提供通用 API 原语，不实现插件业务解析

迁移说明（到 v2 契约）：

- 必须显式声明 `apiVersion: 2`、`requires: [...]`、`ui.type: "iframe"`，否则宿主会拒绝加载
- 入口文件名自由：可继续使用 `main: "iframe.js"`，或改为 `main: "index.js"`，以 `manifest.main` 为准
- 需要后台常驻时，添加 `background.autoStart: true`
- 若需要双入口，可使用 `background.main`（不填时默认复用 `main`）

注意：iframe 插件不会拿到 `React`，也不会使用 `registerPluginComponent`；它应该自行渲染 DOM。

## Iframe 沙箱注意事项（重要）

插件 UI/后台都运行在 `sandbox iframe` 中（宿主目前仅开启 `allow-scripts`）。因此：

- 不要使用 `window.confirm()` / `window.alert()` / `window.prompt()`：会被浏览器直接拦截，表现为“点击无响应/没弹窗/逻辑提前 return”。
- 需要确认操作（删除、清空、覆盖等）时，推荐两种方式：
  - **插件自绘 Modal**：用 overlay + dialog 的 DOM/状态机实现确认/取消（推荐，体验更一致）。
  - **二次点击确认**：第一次点击仅提示“再点一次…”，短时间内第二次点击才执行（toast 由插件自行实现）。

设计原则：不要依赖浏览器原生弹窗，确认交互应完全由插件自身 UI 控制。

## 目录与数据（当前实现）

- 默认（便携）模式：
  - 数据根目录：默认使用 **exe 同目录**（更稳定，不依赖启动时 cwd）。
  - 也可以设置环境变量 `FAST_WINDOW_DATA_DIR` 指向你想要的数据根目录。
  - 插件目录：`<数据根>/plugins/`（由 Rust 端 `get_plugins_dir` 决定）。
- 正式版（release/MSI）：宿主不再随包预置任何插件；插件通过商店下载到 `<数据根>/plugins/`。
  - 数据目录：`<数据根>/data/`（由 Rust 端 `get_data_dir` 决定）。
  - 注意：如果用 MSI 安装到 `Program Files` 这类目录，普通用户通常没有写权限；请使用可写目录（例如解压到 `D:\Apps\FastWindow\`），或设置 `FAST_WINDOW_DATA_DIR` 到可写路径。
- 宿主设置：`data/app.json`（例如 `wakeShortcut`：唤醒窗口的全局快捷键）。
- 插件自动更新偏好（宿主侧）：`data/__app/plugins-auto-update.json`（JSON 对象：`{ "<pluginId>": true }`；默认关闭；开启后宿主启动时会检查商店是否有新版本，有则自动下载并安装；若插件 `requires` 变化则跳过，需要手动更新确认）。
- 插件存储：推荐使用 Tauri 官方 store 插件（`plugin:store|*`）落盘 JSON（常用路径：`plugins/<pluginId>.json`）。
- 历史迁移：若需要迁移旧版数据，可通过 `tauri:storage_get_all`（legacy 只读）读取，再写回 store，并在 store 里记录一次性迁移标记（幂等）。
- 开发模式（debug）：会把仓库根目录的 `plugins/` 同步到数据根目录的 `plugins/`（方便开发）；`data/` 只在目标目录为空时迁移一次。

## Legacy（已禁用）

`ui.type="react"`（同 WebView eval 执行）属于不安全/强耦合路径，当前宿主已拒绝加载。
