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
- （已废弃）`allowOverwriteOnUpdate`：旧版用于记录“允许随包覆盖更新”的宿主偏好；新版不再读取/写入该字段（偏好由宿主独立配置文件保存，见下文“目录与数据”）。
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
  "requires": ["ui.showToast", "clipboard.readText"]
}
```

## 能力（`requires`）

目前按“方法名”授权（见 `src/plugins/pluginContract.ts`），未声明的能力会被拒绝，常用：

- `clipboard.readText` / `clipboard.writeText`
- `clipboard.readImage` / `clipboard.writeImage`
- `storage.get` / `storage.set` / `storage.remove` / `storage.getAll` / `storage.setAll`
- `ui.showToast` / `ui.openUrl` / `ui.openExternal` / `ui.openBrowserWindow`（在应用内新窗口打开网页）/ `ui.startDragging`（让插件触发拖拽窗口移动）
  - `ui.openUrl`：仅允许 `http(s)://`
  - `ui.openExternal`：用于打开外部 URI（例如 `vscode://...`），禁用 `file://` / `javascript:`
- `net.request`（直接 HTTP 请求；走宿主后端以绕过浏览器 CORS；支持 `mode: "task"`；默认返回 UTF-8 文本）
  - `net.request({ ..., responseType: "base64" })`：返回 `bodyBase64`（用于图片/二进制等非 UTF-8 响应；不支持 `mode: "task"`；需要额外声明 `net.requestBase64` 能力）
- `net.requestStream`（流式 HTTP 请求；适合 SSE / `text/event-stream`；返回一个可 `for await` 的异步迭代器，事件类型为 `start/chunk/end/error`）
  - 取消：调用返回对象的 `cancel()`（宿主侧能力为 `net.requestStreamCancel`）
- `net.requestBase64`（兼容保留；等价于 `net.request({ responseType: "base64" })`）
- `task.create` / `task.get` / `task.list` / `task.cancel`
- `files.getOutputDir` / `files.pickOutputDir` / `files.openOutputDir`
- `files.pickDir` / `files.openDir`（选择/打开本地目录）
- `files.images.writeBase64` / `files.images.list` / `files.images.read` / `files.images.delete`
  - `scope: "data"`：插件私有图片目录（不走可配置输出目录）
  - `scope: "output"`：插件输出目录（可配置）

## 后台任务（Task API）

目标：把长耗时工作从插件 iframe 中剥离到宿主后端，插件只负责发起、查询和展示。

- `fastWindow.task.create({ kind, payload })`：创建后台任务，立即返回任务信息（含 `id`）
- `fastWindow.task.get(taskId)`：查询单个任务状态与结果
- `fastWindow.task.list(limit?)`：查询当前插件最近任务
- `fastWindow.task.cancel(taskId)`：请求取消任务

任务状态：`queued` -> `running` -> `succeeded | failed | canceled`

约束：

- 任务数据按插件隔离，插件只能访问自己的任务
- 宿主会限制每个插件保留的任务条数，避免无上限增长
- 任务能力必须在 `manifest.requires` 显式声明

通用任务原语示例（注意：网络请求请走 `net.request`，不要直接 `task.create("http.request")`）：

- `http.request`：宿主执行 HTTP 请求，返回 `status/headers/body`
- `clipboard.watch`：宿主持续监听剪贴板，返回 `items` 快照

插件可以基于这些原语自行编排业务，不需要宿主内置插件业务逻辑。

## Iframe 插件运行方式

iframe 插件入口 `main` 目前按 **JS 文件**处理：宿主会把它注入 `srcdoc`，并在 iframe 内提供 `window.fastWindow`：

- `fastWindow.clipboard.*`
- `fastWindow.storage.*`（默认绑定当前插件 id：`get(key)` / `set(key, value)` …）
- `fastWindow.ui.showToast(message)`
- `fastWindow.ui.back()`（请求宿主返回；不需要在 `requires` 里声明）
- `fastWindow.ui.startDragging()`（让插件触发“拖拽窗口移动”；需要在 `requires` 里声明 `ui.startDragging`；仅 `runtime === 'ui'` 可用）
  - `fastWindow.net.request(req)`（需要 `requires` 声明 `net.request`；可传 `mode: "task"` 返回任务句柄）
- `fastWindow.files.*`（需要对应 `files.*` 能力）

运行时元信息：

- `fastWindow.__meta.runtime`：`'ui' | 'background'`
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
  - **二次点击确认**：第一次点击仅提示 `fastWindow.ui.showToast('再点一次…')`，短时间内第二次点击才执行。

设计原则：不要依赖浏览器原生弹窗，确认交互应完全由插件自身 UI 控制。

## 目录与数据（当前实现）

- 默认（便携）模式：
  - 数据根目录：默认使用 **exe 同目录**（更稳定，不依赖启动时 cwd）。
  - 也可以设置环境变量 `FAST_WINDOW_DATA_DIR` 指向你想要的数据根目录。
  - 插件目录：`<数据根>/plugins/`（由 Rust 端 `get_plugins_dir` 决定）。
  - 正式版（release/MSI）：安装包会携带内置插件“种子”，首次启动时自动补齐到 `<数据根>/plugins/`（默认只补缺失项；若目标插件已存在，默认允许在宿主升级后覆盖更新；仅当宿主配置 `data/__app/plugins-overwrite.json` 中该插件显式为 `false` 时才禁止覆盖更新）。
  - 数据目录：`<数据根>/data/`（由 Rust 端 `get_data_dir` 决定）。
  - 注意：如果用 MSI 安装到 `Program Files` 这类目录，普通用户通常没有写权限；请使用可写目录（例如解压到 `D:\Apps\FastWindow\`），或设置 `FAST_WINDOW_DATA_DIR` 到可写路径。
- 宿主设置：`data/app.json`（例如 `wakeShortcut`：唤醒窗口的全局快捷键）。
- 插件覆盖更新偏好（宿主侧）：`data/__app/plugins-overwrite.json`（JSON 对象：`{ "<pluginId>": true|false }`）。
- 默认策略：**默认允许覆盖更新**；仅当 `plugins-overwrite.json` 中该插件显式为 `false` 时，才禁止覆盖更新。
- 插件存储（`fastWindow.storage.*`）：按 key 拆分为独立文件：`data/<pluginId>/storage/<key>.json`（key 中的 `/` 会形成子目录）。
- 插件存储迁移（可选）：从旧版升级时，插件历史数据可能还在 `data/<pluginId>.json` 或 `data/<pluginId>/storage.json`。插件可调用 `await fastWindow.storage.migrate()` 将其迁移到新布局（幂等；失败不会删除旧文件）。
- 开发模式（debug）：会把仓库根目录的 `plugins/` 同步到数据根目录的 `plugins/`（方便开发）；`data/` 只在目标目录为空时迁移一次。

## 插件数据迁移标准（建议）

这里的“迁移”分两层：

1) **存储布局迁移（宿主提供能力）**：把旧文件布局迁到新的 `storage/<key>.json` 布局。插件在启动时可先调用：

```js
await fastWindow.storage.migrate()
```

2) **业务 schema 迁移（插件自己负责）**：插件自己决定数据结构的版本号与迁移链，并把“当前迁移到哪一步”记录在插件自己的 storage 里。

推荐约定：

- 状态 key：`__meta/schema`
- 状态结构：`{ schemaVersion: number, updatedAtMs: number }`
- 迁移规则：每个迁移函数只负责 **v -> v+1**，且应尽量幂等（可重复执行）。

宿主已内置一个可选 helper：

```js
await fastWindow.migrations.run({
  latestVersion: 3,
  // 可选：默认 '__meta/schema'
  // stateKey: '__meta/schema',
  migrations: {
    0: async (api) => { /* v0 -> v1 */ },
    1: async (api) => { /* v1 -> v2 */ },
    2: async (api) => { /* v2 -> v3 */ },
  },
})
```

## Legacy（已禁用）

`ui.type="react"`（同 WebView eval 执行）属于不安全/强耦合路径，当前宿主已拒绝加载。
