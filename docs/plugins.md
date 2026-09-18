# 插件系统（宿主/插件契约）

目标：**本体独立运行**，插件只依赖宿主暴露的稳定契约（Plugin API），不依赖本体内部实现细节。

说明：旧版插件的构建、监听与发布工具链已退役，`plugins/` 源码保留作为参考；插件通过宿主本地导入安装后由宿主加载运行。

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

常用网关命令（示例）：

- 文件系统：`tauri:plugin_files_*` / `tauri:plugin_get_library_dir` / `tauri:plugin_get_output_dir`
- SQLite（插件私有索引库，落盘到 `scope:data` / `data/<pluginId>/`）：
  - `tauri:plugin_sqlite_execute`：执行单条写入/DDL（返回影响行数）
  - `tauri:plugin_sqlite_batch`：批量执行（可选事务）
  - `tauri:plugin_sqlite_query`：查询并返回行数据（带列名）
  - `tauri:plugin_sqlite_close`：关闭连接（释放文件句柄，Windows 上很有用）

最小调用示例（插件侧，通过 iframe 网关）：

```js
// 需要在 manifest.requires 声明：
// - tauri:plugin_sqlite_execute
// - tauri:plugin_sqlite_query
// - tauri:plugin_sqlite_batch（可选）
// - tauri:plugin_sqlite_close（可选）

const dbName = 'hypercortex-index.sqlite';

await fastWindow.tauri.invoke({
  command: 'plugin_sqlite_execute',
  payload: {
    req: {
      pluginId: 'hypercortex',
      dbName,
      sql: 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
      params: [],
    },
  },
});

await fastWindow.tauri.invoke({
  command: 'plugin_sqlite_batch',
  payload: {
    req: {
      pluginId: 'hypercortex',
      dbName,
      transaction: true,
      statements: [
        {
          sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',
          params: [
            { type: 'text', value: 'hello' },
            { type: 'text', value: 'world' },
          ],
        },
      ],
    },
  },
});

const r = await fastWindow.tauri.invoke({
  command: 'plugin_sqlite_query',
  payload: {
    req: {
      pluginId: 'hypercortex',
      dbName,
      sql: 'SELECT k, v FROM kv WHERE k=?',
      params: [{ type: 'text', value: 'hello' }],
      maxRows: 10,
    },
  },
});

// r = { columns: ['k','v'], rows: [[{type:'text',value:'hello'},{type:'text',value:'world'}]] }

await fastWindow.tauri.invoke({
  command: 'plugin_sqlite_close',
  payload: { req: { pluginId: 'hypercortex', dbName } },
});
```

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
- 正式版（release/MSI）：宿主不再随包预置任何插件；插件通过本地导入安装到 `<数据根>/plugins/`。
  - 数据目录：`<数据根>/data/`（由 Rust 端 `get_data_dir` 决定）。
  - 注意：如果用 MSI 安装到 `Program Files` 这类目录，普通用户通常没有写权限；请使用可写目录（例如解压到 `D:\Apps\FastWindow\`），或设置 `FAST_WINDOW_DATA_DIR` 到可写路径。
- 宿主设置：`data/app.json`（例如 `wakeShortcut`：唤醒窗口的全局快捷键）。
- 插件存储：推荐使用 Tauri 官方 store 插件（`plugin:store|*`）落盘 JSON（插件侧常用路径：`plugins/<pluginId>.json`；宿主实际落盘：`data/<pluginId>/<pluginId>.json`）。
- 插件文件（宿主网关，`plugin_files_*`）：
  - 插件通过 `tauri:plugin_files_*` 读写文件；请求里带 `scope` 与相对路径。
  - `scope: "data"`：插件私有数据根目录 `data/<pluginId>/`（插件可自由组织子目录结构）。
  - `scope: "output"`：用户输出目录（可配置）。新默认：`data/<pluginId>/output`；兼容：若旧目录 `data/<pluginId>/output-images` 已存在则沿用。
    - 相关命令：`tauri:plugin_get_output_dir` / `tauri:plugin_pick_output_dir`。
  - `scope: "library"`：用户长期资产库目录（可配置）。默认：`data/<pluginId>/library`。
    - 相关命令：`tauri:plugin_get_library_dir` / `tauri:plugin_pick_library_dir`。
- 插件图片（宿主网关，`plugin_images_*`）：图片专用读写接口，同样支持 `scope: "data" | "output" | "library"`。
- 历史迁移：若需要迁移旧版数据，可通过 `tauri:storage_get_all`（legacy 只读）读取，再写回 store，并在 store 里记录一次性迁移标记（幂等）。
- 开发模式（debug）：会把仓库根目录的 `plugins/` 同步到数据根目录的 `plugins/`（方便开发）；`data/` 只在目标目录为空时迁移一次。

## Legacy（已禁用）

`ui.type="react"`（同 WebView eval 执行）属于不安全/强耦合路径，当前宿主已拒绝加载。
