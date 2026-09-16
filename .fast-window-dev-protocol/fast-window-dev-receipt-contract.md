# fast-window-dev 回执契约

本契约规定：应用侧工具（下称 b）执行完动作后，如何把结果交还给调度工具（下称 a）。
a 与 b 只共同遵守本契约，不互相依赖对方的实现。契约是双方唯一的沟通依据。

## 一、回执通道

1. b 执行动作时，命令的原始输出照常显示在前。
2. b 执行结束后，**必须**在输出的最后追加一行回执，格式为：

   ```
   FAST-WINDOW-DEV-RECEIPT: {回执JSON}
   ```

   即"固定前缀 + 一个空格 + 单行 JSON"。JSON 必须紧凑（不换行），回执只占一行。
3. 除回执行外，b 不额外输出其他协议内容。
4. b 若连动作都无法开始执行（例如动作未在字典中定义），同样要交出失败回执。

## 二、回执结构

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| contractVersion | 整数 | 是 | 本契约版本，当前为 1 |
| action | 字符串 | 是 | 动作代号，与协议字典中的键一致 |
| status | 字符串 | 是 | `succeeded` 或 `failed` |
| exitCode | 整数或 null | 是 | 命令退出码；b 自身错误、未执行命令时为 null |
| error | 字符串 | 是 | b 自身的错误说明；没有错误时为空串 |
| data | 对象 | 是 | 结构化数据载荷；没有时为 `{}` |

说明：

- 命令的原始输出已经完整地显示在回执之前的输出流里，因此回执**不重复携带命令原文**。
- 命令输出本身就是 JSON 的，b 解析后原样放入 `data`。
- 纯文本命令的 `data` 为空对象。
- 动作有成品产物时，`data` 使用以下推荐字段（固定名字）：
  - `data.artifact.path`：成品绝对路径
  - `data.artifact.name`：成品文件名
  - `data.artifact.sha256`：成品校验值

## 三、示例

成功（构建动作，带成品信息）：

```
FAST-WINDOW-DEV-RECEIPT: {"contractVersion":1,"action":"eucli-box-build","status":"succeeded","exitCode":0,"error":"","data":{"artifact":{"path":"E:\\...\\eucli-box_0.1.2_windows-x64.zip","name":"eucli-box_0.1.2_windows-x64.zip","sha256":"6765592f..."}}}
```

失败（命令以非零退出码结束）：

```
FAST-WINDOW-DEV-RECEIPT: {"contractVersion":1,"action":"eucli-box-build","status":"failed","exitCode":1,"error":"","data":{}}
```

失败（b 自身错误：动作未定义）：

```
FAST-WINDOW-DEV-RECEIPT: {"contractVersion":1,"action":"whatever","status":"failed","exitCode":null,"error":"协议未定义动作 \"whatever\"","data":{}}
```

## 四、双方行为边界

**b**：

- 只依据自己旁边的协议字典执行动作；
- 无论成功失败，执行结束必须产出回执；
- 不猜测、不编造 `data` 内容；解析不了结构化数据的，`data` 留空对象。

**a**：

- 只在输出流末尾寻找回执行并按本契约解析；
- 不解析命令原文、不猜测命令行为；
- 找不到回执（例如 b 未能启动）时，按失败处理并如实报告。

## 五、契约演进

- 字段只能**新增**；解析方遇到不认识的字段必须忽略，不得报错。
- 删除字段或改变字段含义属于破坏性变更，必须提升 `contractVersion`，两侧同步升级。
- 本契约是双方沟通规则的唯一出处，实现变更不得绕过本文件。