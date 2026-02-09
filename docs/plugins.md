# 插件系统（宿主/插件契约）

目标：**本体独立运行**，插件只依赖宿主暴露的稳定契约（Plugin API），不依赖本体内部实现细节。

## Manifest（`plugins/<id>/manifest.json`）

最小字段：

- `id`：插件 ID（目录名建议一致）
- `name` / `version` / `description`
- `main`：入口文件

新增契约字段：

- `apiVersion`：宿主契约版本（当前为 `1`）
- `requires`：能力申请列表（建议必填；老插件不填默认放行）
- `ui.type`：
  - `react`：旧模式（同一 WebView 内执行）
  - `iframe`：沙箱模式（`sandbox iframe` 执行，通过 `postMessage` 调宿主能力）

示例（iframe 插件）：

```json
{
  "id": "hello-iframe",
  "name": "Hello Iframe",
  "version": "1.0.0",
  "description": "demo",
  "main": "index.js",
  "ui": { "type": "iframe" },
  "apiVersion": 1,
  "requires": ["ui.showToast", "clipboard.readText"]
}
```

## 能力（`requires`）

目前按“方法名”授权（见 `src/plugins/pluginContract.ts`），常用：

- `clipboard.readText` / `clipboard.writeText`
- `clipboard.readImage` / `clipboard.writeImage`
- `storage.get` / `storage.set` / `storage.remove` / `storage.getAll` / `storage.setAll`
- `ui.showToast` / `ui.openUrl`
- `task.create` / `task.get` / `task.list` / `task.cancel`

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

通用任务原语示例：

- `http.request`：宿主执行 HTTP 请求，返回 `status/headers/body`
- `clipboard.watch`：宿主持续监听剪贴板，返回 `items` 快照

插件可以基于这些原语自行编排业务，不需要宿主内置插件业务逻辑。

## Iframe 插件运行方式

iframe 插件入口 `main` 目前按 **JS 文件**处理：宿主会把它注入 `srcdoc`，并在 iframe 内提供 `window.fastWindow`：

- `fastWindow.clipboard.*`
- `fastWindow.storage.*`（默认绑定当前插件 id：`get(key)` / `set(key, value)` …）
- `fastWindow.ui.showToast(message)`
- `fastWindow.ui.back()`（请求宿主返回）

注意：iframe 插件不会拿到 `React`，也不会使用 `registerPluginComponent`；它应该自行渲染 DOM。

## 目录与数据（当前实现）

- 默认（便携）模式：
  - 数据根目录：默认使用 **exe 同目录**（更稳定，不依赖启动时 cwd）。
  - 也可以设置环境变量 `FAST_WINDOW_DATA_DIR` 指向你想要的数据根目录。
  - 插件目录：`<数据根>/plugins/`（由 Rust 端 `get_plugins_dir` 决定）。
  - 数据目录：`<数据根>/data/`（由 Rust 端 `get_data_dir` 决定）。
  - 注意：如果用 MSI 安装到 `Program Files` 这类目录，普通用户通常没有写权限；请使用可写目录（例如解压到 `D:\Apps\FastWindow\`），或设置 `FAST_WINDOW_DATA_DIR` 到可写路径。
- 宿主设置：`data/app.json`（例如 `wakeShortcut`：唤醒窗口的全局快捷键）。
- 开发模式（debug）：会把仓库根目录的 `plugins/` 同步到数据根目录的 `plugins/`（方便开发）；`data/` 只在目标目录为空时迁移一次。

## Legacy（已禁用）

`ui.type="react"`（同 WebView eval 执行）属于不安全/强耦合路径，当前宿主已拒绝加载。
