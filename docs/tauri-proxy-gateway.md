# Tauri Proxy Gateway（安检门 + 转发网关）设计文档

更新时间：2026-03-26

## 0. 当前工作主线

- 当前工作主线：[安检门 + 转发网关（保留 iframe 沙箱）架构落地]
- 当前正在处理的线：[把计划/目标/设计固化成文档（本文件）]

## 1. 背景：以前为什么“胖”

旧架构里，宿主（Rust + 前端）往往会不断新增业务接口，例如：

- `get_weather()` / `read_config()` / `save_image()` / `download_xxx()` / `open_xxx()` …

结果：

- API 面积持续膨胀、维护成本上升；
- 能力边界变得业务化且不稳定；
- 插件生态越大，宿主越难保持“体积固定”。

## 2. 目标：现在怎么“瘦”

宿主只保留**极其通用的网关能力**：

- 插件在 iframe 沙箱内通过 `postMessage` 发出“调用请求”；
- 宿主前端执行：
  - 鉴权（按插件 manifest 的 requires）
  - 资源限制（载荷/并发/超时）
  - 调用转发（唯一入口：`invoke(command, payload)`）
  - 返回结果（`postMessage` 回插件 iframe）

宿主不再维护业务接口；插件要用 `fs/http/store/shell` 等能力，全部通过网关以 **底层 command 字符串**透传调用。

## 3. 约束与不变项

- 插件 UI/后台仍运行在 `sandbox iframe` 中（物理隔离基础不变）。
- 插件侧**不直接 import** `@tauri-apps/*`（iframe 内无法可靠获得 Tauri 注入能力）。
- 网关侧**不触碰** `window.__TAURI_IPC__` 等内部细节，只使用官方稳定入口：
  - `import { invoke } from '@tauri-apps/api/core'`

## 4. 新能力模型（requires）

### 4.1 语法

新增 requires 形式：`tauri:<command>`，其中 `<command>` 为底层 command 字符串，例如：

- `tauri:plugin:fs|read_text_file`
- `tauri:plugin:http|fetch`
- `tauri:my_custom_command`

支持前缀通配：

- `tauri:*`：允许调用任意 command（强烈不建议，默认应拒绝）
- `tauri:plugin:fs|*`：允许调用某插件的全部命令

### 4.2 高危特例（硬编码）

对高危能力（例如 `plugin:shell`）实施更严格策略：

- **拒绝通配**：不允许 `tauri:plugin:shell|*`
- 必须精确到命令：例如只允许 `tauri:plugin:shell|execute`

> 说明：这里的“高危”名单由宿主维护，属于网关的“安检规则”，不是业务 API。

## 5. 网关协议（iframe ⇄ 宿主）

### 5.1 Request（插件 → 宿主）

插件 iframe 通过 `parent.postMessage` 发送：

```json
{
  "__fastWindowRequest": true,
  "pluginId": "memo",
  "token": "opaque-runtime-token",
  "id": 1,
  "method": "tauri.invoke",
  "args": [
    {
      "command": "plugin:fs|read_text_file",
      "payload": { "path": "..." },
      "timeoutMs": 8000
    }
  ]
}
```

约定：

- `method` 统一为 `tauri.invoke`
- `command` 必填，字符串
- `payload` 可选（任意 JSON 可序列化对象）
- `timeoutMs` 可选（宿主将强制上限）

### 5.2 Response（宿主 → 插件）

与现有桥接一致：

```json
{
  "__fastWindowResponse": true,
  "pluginId": "memo",
  "token": "opaque-runtime-token",
  "id": 1,
  "ok": true,
  "result": { "any": "json" }
}
```

失败返回：

```json
{
  "__fastWindowResponse": true,
  "pluginId": "memo",
  "token": "opaque-runtime-token",
  "id": 1,
  "ok": false,
  "code": "CAPABILITY_DENIED",
  "error": "Capability denied: tauri:plugin:fs|read_text_file",
  "data": { "command": "plugin:fs|read_text_file" }
}
```

## 6. 安全与资源限制（网关必须承担）

### 6.1 鉴权（核心）

对每次 `tauri.invoke`：

- 计算 needed capability：`tauri:${command}`
- 若插件 `requires` 不包含：
  - 精确匹配 `tauri:${command}`，或
  - 前缀匹配（例如 `tauri:plugin:fs|*` 覆盖 `plugin:fs|read_text_file`），或
  - `tauri:*`（如未来允许）
  则拒绝。

并且对高危 target（如 `plugin:shell`）：

- 即使存在通配，也拒绝；必须精确命中 `tauri:plugin:shell|execute`。

### 6.2 载荷限制（建议默认值）

- 单次请求 args 体积上限：例如 **16MB**（可配置；用于容纳 base64 图片等场景）
- 并发 in-flight 上限：例如 **64**
- 超时：
  - 默认 `8s`
  - 人机交互类命令（如 pick file/dir）放宽到 `15min`
  - 网关对 `timeoutMs` 做上限钳制（例如最大 `5min`）

### 6.3 文件系统边界（强烈建议）

即使底层 `plugin:fs|*` 能读写任意路径，网关仍应做“插件级”路径策略：

- 默认仅允许访问：
  - `data/<pluginId>/...`（插件私有数据目录）
  - 用户通过 picker 明确授予过的目录（持久化授权）
- 其他路径拒绝，避免第三方插件越权读写。

> 注意：这是“安检门”职责，不是宿主业务 API。

## 7. 流式/事件桥接（规划）

部分能力不是单次 request/response：

- 事件监听、Channel、流式输出等

规划：扩展网关方法，例如：

- `tauri.stream.open({ command, payload }) -> { streamId }`
- `tauri.stream.next(streamId)` / `tauri.stream.cancel(streamId)`
- 宿主通过 `__fastWindowStream` 回推事件（沿用现有 net.requestStream 的 stream 机制）

第一阶段可先只实现 `tauri.invoke`，流式作为第二阶段。

## 7.1 TODO（记录在案，暂不实现）

- `tauri.blob`：支持 `ArrayBuffer`/分片上传（transferable），避免 base64 膨胀与大 JSON 载荷。
  - 目标：让“写入图片/大文件”走二进制通道，再由宿主落盘或转发给底层命令。
  - 暂缓原因：当前 16MB JSON 上限已覆盖大多数 Canvas 场景，优先解决 Stream/事件桥接瓶颈。

## 7.2 Stream 网关简要设计（将按此实现）

目标：复用现有 `__fastWindowStream` 推送机制，把两类“长连接/事件源”统一成 *streamId* 句柄：

1) **Channel/进度流**：宿主侧创建 Tauri `Channel`，把回调事件逐条推回 iframe。
2) **全局事件监听**：宿主侧调用 `@tauri-apps/api/event.listen`，把事件推回 iframe。

### 7.2.1 插件侧 API（iframe 注入）

- `fastWindow.tauri.streamOpen(spec) -> { streamId }`
- `fastWindow.tauri.streamCancel(streamId) -> null`
- `fastWindow.tauri.stream(spec) -> AsyncIterator`（便捷封装：`open + createStream(streamId)`）

插件通过 `for await` 消费事件；取消用 `stream.cancel()` 或显式 `streamCancel(streamId)`。

### 7.2.2 复用 `__fastWindowStream`

宿主通过 `postStream({ streamId, event })` 向 iframe 推送。为避免与底层命令自己的事件（例如 `http_request_stream` 的 `type: 'start'/'chunk'/'end'`）冲突，网关自身的元事件统一使用 `__gateway_*` 前缀：

- `event.type === '__gateway_start'`：网关开始（包含 kind/command/name 等元信息）
- `event.type === '__gateway_ready'`：Detached Stream 的 invoke 已返回（包含 `result`，通常用于携带后端生成的句柄 id）
- `event.type === '__gateway_result'`：非 Detached 的 invoke 最终返回值（包含 `result`，随后网关会推 `end`）
- `event.type === 'error'`：网关错误（带 `message`；随后会推 `end`）
- `event.type === 'end'`：网关结束（可带 `canceled`）

对于 **Channel** 回调的数据，网关会 **原样透传**（不会再包一层 `data` 字段），以保证网关“薄且蠢”：

- 例如 `http_request_stream` 的事件会直接是：`{ type: 'start'|'chunk'|'end'|'error', ... }`

对于 **全局事件监听**（`event.listen|...`），网关推送：

- `event.type === 'event'`：包含 `name/payload`

iframe 侧的 `createStream(streamId)` 机制保持不变（或轻微泛化，让 cancel 方法可配置为 `tauri.streamCancel`）。

### 7.2.3 open/取消句柄管理（宿主侧）

宿主维护一个全局表：`Map<streamId, StreamHandle>`，其中包含：

- `pluginId`：归属插件（用于 cancel 鉴权与清理）
- `cancel()`：释放底层资源（unlisten / 标记关闭 / 最佳努力取消）
- `closed`：防止重复 end/error

`streamCancel(streamId)`：仅允许同一 `pluginId` 取消；取消后推送 `end` 并从表删除。

### 7.2.6 Detached Stream（后台分离流）

某些命令会“立刻返回一个 id”，然后在后台持续通过 Channel 推送事件（典型例子：`http_request_stream`）。这类命令必须用 Detached 模式打开：

- `fastWindow.tauri.streamOpen({ command, payload, detached: true, cancel })`

其中 `cancel` 是一个完全通用的描述（网关不特判任何命令）：

- `cancel.command`：取消命令（例如 `http_request_stream_cancel`）
- `cancel.resultKey`：从 invoke 返回值里取 id 的字段名（为空表示返回值本身就是 id）
- `cancel.idKey`：把 id 注入到取消命令 payload 的字段名（默认 `streamId`）
- `cancel.payload`：取消命令的附加参数（可选）

Detached 模式下，网关不会在 invoke 返回后自动推 `end`，而是依赖：

- 底层 Channel 推 `{ type: 'end' }` / `{ type: 'error' }` 这类结束事件，或
- 插件显式调用 `fastWindow.tauri.streamCancel(streamId)` / `stream.cancel()`

### 7.2.4 鉴权模型（requires）

- Channel/进度流：需要 `tauri:<command>`（支持 `tauri:<prefix>*`；高危 command 仍拒绝通配）
- 全局事件：使用“伪命令”表达式承载鉴权，例如：
  - `tauri:event.listen|tauri://file-drop`
  - 或通配 `tauri:event.listen|*`

网关不关心事件含义，只做 allowlist。

### 7.2.5 对 Rust/命令的约束（为了真正“通用”）

要走 Channel 流式的自定义命令，建议统一 payload 形态：

- `invoke(command, { ...payload, channel })`（即 channel 放在 payload 对象里）

这样网关无需为“Channel 参数在第几位”做任何适配。

## 8. 版本与迁移策略

- 现有 v2 插件不受影响（仍可用 `net.request/files.*` 等 legacy 方法）。
- 新增 `tauri.invoke` 后：
  - 插件可逐步把调用从 `fastWindow.net.request` 迁到 `fastWindow.tauri.invoke('plugin:http|fetch', ...)`
  - 宿主可逐步把 legacy 自研能力废弃（但不强制立刻移除）。

## 9. SDK 策略（不污染宿主）

为提升插件开发体验，提供独立包（插件侧使用，不进入宿主核心）：

- `@fast-window/plugin-sdk`

作用：

- 把易用 API（camelCase）包装成底层 command 字符串调用；
- 提供类型与错误封装；
- 集中维护“官方插件命令名”映射表（如果需要）。

宿主网关保持“薄”和“蠢”：只做鉴权/限制/透传。

## 10. 实施计划（下一步将做的代码改动范围）

1) 前端桥接层：
   - `src/plugins/pluginSandbox.ts`：向 iframe 注入 `fastWindow.tauri.invoke()`
   - `src/plugins/pluginMethods.ts`：实现 `tauri.invoke` 的 dispatch（鉴权、限制、invoke 透传）
2) 能力模型与校验：
   - `src/plugins/pluginContract.ts`：支持 `tauri:<command>`（已做雏形）
   - `src/plugins/pluginLoader.ts` / `src/components/ImportPluginDialog.tsx`：允许动态 capability（`tauri:` 前缀）通过校验
3) 测试：
   - 在一个现有插件 manifest 增加 `tauri:plugin:...` requires
   - 插件代码里调用 `fastWindow.tauri.invoke({ command, payload })` 验证回包

## 11. 快速测试（在现有插件里验证 tauri.invoke）

以 `plugins/memo/` 为例（任选一个你熟悉的插件也可以）：

1) 修改 `plugins/memo/manifest.json` 的 `requires`，追加一条：

```json
"tauri:get_plugins_dir"
```

2) 在该插件入口 `plugins/memo/index.js`（或你的插件入口文件）里临时加入：

```js
const api = window.fastWindow
api.tauri.invoke({ command: 'get_plugins_dir', payload: {} })
  .then(dir => api.ui.showToast('pluginsDir=' + String(dir)))
  .catch(err => api.ui.showToast('tauri.invoke failed: ' + String(err && err.message ? err.message : err)))
```

3) 启动应用后打开该插件：
- 若 toast 显示 `pluginsDir=...`，说明网关转发链路 OK。
- 若提示 `Capability denied`，检查 `requires` 是否包含 `tauri:get_plugins_dir`。

## 12. 快速测试（在现有插件里验证 Stream / event.listen）

目标：验证 `fastWindow.tauri.stream({ command: 'event.listen|<eventName>' })` 可收到事件。

这里用项目内现成事件 `fast-window:webview-settings-updated`（Rust 侧在 `set_webview_settings` 里 emit）。

1) 以 `plugins/memo/manifest.json` 为例，在 `requires` 里追加：

```json
"tauri:event.listen|fast-window:webview-settings-updated",
"tauri:get_webview_settings",
"tauri:set_webview_settings"
```

2) 在 `plugins/memo/index.js` 临时加入：

```js
const api = window.fastWindow

;(async () => {
  const stream = await api.tauri.stream({ command: 'event.listen|fast-window:webview-settings-updated' })
  ;(async () => {
    for await (const ev of stream) {
      if (ev && ev.type === 'event') {
        api.ui.showToast('got event: ' + ev.name)
        break
      }
    }
  })()

  const cur = await api.tauri.invoke({ command: 'get_webview_settings', payload: {} })
  await api.tauri.invoke({ command: 'set_webview_settings', payload: { settings: cur } })
})().catch(err => api.ui.showToast('stream test failed: ' + String(err && err.message ? err.message : err)))
```

3) 打开插件后，若出现 toast：`got event: fast-window:webview-settings-updated`，则 event.listen 网关 OK。

> Channel 流（下载进度条）测试依赖一个“接受 payload.channel 的命令”。网关已就绪；后续在 Rust 侧新增任何符合约束的命令即可直接使用，无需改网关代码。

## 13. 端到端测试（验证 Channel 约束：payload.channel）

项目已内置一个最小测试命令：`gateway_test_channel`（Rust 侧签名包含 `channel: Channel<_>`，并按 `req.total` 推送进度事件）。

1) 以 `plugins/memo/manifest.json` 为例，在 `requires` 里追加：

```json
"tauri:gateway_test_channel"
```

2) 在 `plugins/memo/index.js` 临时加入：

```js
const api = window.fastWindow

;(async () => {
  const stream = await api.tauri.stream({
    command: 'gateway_test_channel',
    payload: { req: { total: 20, delayMs: 50 } },
    channelKey: 'channel',
    timeoutMs: 10_000,
  })

  let last = 0
  for await (const ev of stream) {
    if (ev && ev.type === 'data' && ev.data && typeof ev.data.seq === 'number') {
      last = ev.data.seq
      if (last % 5 === 0) api.ui.showToast(`progress ${last}/${ev.data.total}`)
    }
    if (ev && ev.type === 'result') {
      api.ui.showToast('done, total=' + String(ev.result && ev.result.total))
    }
  }
})().catch(err => api.ui.showToast('channel test failed: ' + String(err && err.message ? err.message : err)))
```

预期：
- 会逐步收到 `{ type: 'data', data: { seq, total } }`
- 最后收到 `{ type: 'result', result: { total } }`，并正常结束


---

## 附：示例 requires

常规文件读取插件：

```json
{
  "requires": [
    "ui.showToast",
    "tauri:plugin:fs|read_text_file",
    "tauri:plugin:fs|write_text_file"
  ]
}
```

允许 fs 全部命令（不推荐给第三方插件）：

```json
{ "requires": ["tauri:plugin:fs|*"] }
```

shell（高危，必须精确）：

```json
{ "requires": ["tauri:plugin:shell|execute"] }
```
