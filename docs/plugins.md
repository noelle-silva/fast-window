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
- `ui.showToast`

## Iframe 插件运行方式

iframe 插件入口 `main` 目前按 **JS 文件**处理：宿主会把它注入 `srcdoc`，并在 iframe 内提供 `window.fastWindow`：

- `fastWindow.clipboard.*`
- `fastWindow.storage.*`（默认绑定当前插件 id：`get(key)` / `set(key, value)` …）
- `fastWindow.ui.showToast(message)`
- `fastWindow.ui.back()`（请求宿主返回）

注意：iframe 插件不会拿到 `React`，也不会使用 `registerPluginComponent`；它应该自行渲染 DOM。

## 目录与数据（当前实现）

- 默认模式：
  - 插件目录：系统 **AppLocalData** 下的 `plugins/`（由 Rust 端 `get_plugins_dir` 决定）。
  - 数据目录：系统 **AppLocalData** 下的 `data/`（由 Rust 端 `get_data_dir` 决定）。
- 便携模式（把数据放到程序目录/当前目录）：
  - 在程序**当前工作目录**或 **exe 同目录**放一个空文件 `fast-window.portable`，宿主会把 `data/` 与 `plugins/` 都落到该目录下。
  - 或者设置环境变量 `FAST_WINDOW_DATA_DIR` 指向你想要的数据根目录（同样会使用其中的 `data/` 与 `plugins/`）。
  - 注意：如果用 MSI 安装到 `Program Files` 这类目录，普通用户通常没有写权限；想用便携模式就安装/解压到可写目录。
- 宿主设置：`data/app.json`（例如 `wakeShortcut`：唤醒窗口的全局快捷键）。
- 开发模式（debug）：会把仓库根目录的 `plugins/` 同步到数据根目录的 `plugins/`（方便开发）；`data/` 只在目标目录为空时迁移一次。

## Legacy（已禁用）

`ui.type="react"`（同 WebView eval 执行）属于不安全/强耦合路径，当前宿主已拒绝加载。
