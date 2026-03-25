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
