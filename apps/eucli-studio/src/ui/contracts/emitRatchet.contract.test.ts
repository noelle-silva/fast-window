import { describe, expect, it } from 'vitest'
import {
  collectCalls,
  formatLocations,
  loadContractSourceFiles,
} from '../../testing/sourceContractScan'

// 裸 emit ratchet（只允许下降）。
//
// 背景：110 的目标是用地址通知取代全局大广播。`emit()` 通知所有全局订阅者，
// 每新增一个调用点都会让壳层整块重渲染；`emitScope` / `emitScopes` 才是迁移方向。
//
// 基线生成方式（只在阶段锚点 137422c5 上跑过一次）：
//   1. loadContractSourceFiles() 读取 apps/eucli-studio/src 下全部非测试源码；
//   2. 用 TypeScript AST 收集 CallExpression，而不是正则，注释/字符串不会误命中；
//   3. emit 计数 = 方法名 `emit` 且零参数的调用；
//      scope 计数 = 方法名 `emitScope` 或 `emitScopes` 的调用；
//   4. 排除 src/ui/uiCore.ts（内核自身的定义与转发，不属于生产发射点）。
//
// 更新流程（禁止放宽）：
//   - 每次把一个域从 emit 改成地址通知后，`EMIT_BASELINE` 只能调小，
//     `SCOPE_BASELINE` 只能调大，并在任务文档里记录新的数字与所属域；
//   - 不允许为了让新代码通过而直接调大 EMIT_BASELINE 或调小 SCOPE_BASELINE；
//   - 如果确实需要新增全局广播（启动/加载/epoch 换代），必须走显式白名单评审，
//     而不是悄悄改这里的数字。
// 110-08c 收口后的实际值：159。已地址化的域包括：
//   - settings：appearance / wallpaper / aiService / sticker / requestRecordView；
//   - entities：roles / groups / workspaces / providers / modelGroups / tools /
//     hookPrompts / placeholders / plugins / accessSettings / requestRecords /
//     modelRequestConfig / conversationImageConfig / toolWorkDirectory / favorites；
//   - session / chatList：会话设置保存与回滚、标题生成、加载失败、正文刷新；
//   - navigation / composer / uiShell：会话切换、弹层、查看器、Mermaid、草稿；
//   - appData：启动加载、离线外壳初始化、整包数据替换、运行恢复后的会话收敛；
//   - uiPolling 对账、运行卡与列表元数据；
//   - 运行事件的新消息挂载 / 终态 / 异步工具返回 → 该会话 session 地址。
//
// 剩余 157 处里绝大多数是 `deps.emit()`：它们在 createControllerV2 装配时
// 注入的就是 emitSettings / emitEntity(...) 等域地址发射器，不是全局广播。
// 113-04 删除了 createControllerV2 的 render/renderAll 别名与 actions 上的
// render/renderTop/renderChat/renderSide 暴露，裸 emit 基线从 159 降到 157。
const EMIT_BASELINE = 157
// scope 通知基线（当前 44 处）：上面各域的 emitScope/emitScopes 调用总和，
// 由 AST 规则在本次收口后算得。任何一处减少都会让下面的 `>= SCOPE_BASELINE`
// 失败，防止有人回退成全局广播。
// 112 草稿写入收口：把 chatNavigationActions / createControllerV2 里重复的
// composer 发射点合并进 draftActions，并删除已无消费者的 emitComposerScope 依赖；
// 发射点从 47 降到 44，属于删除重复实现而不是回退全局广播。
const SCOPE_BASELINE = 44

// 内核实现文件：定义 emit / emitScope / emitScopes 并把空地址归一到全局通道。
// 它的内部调用不是业务发射点，单独排除；其余任何文件都不得豁免。
const KERNEL_FILE = 'src/ui/uiCore.ts'

describe('契约·裸 emit ratchet', () => {
  const files = loadContractSourceFiles()
  const calls = collectCalls(files, () => true).filter((call) => call.relPath !== KERNEL_FILE)

  const emitCalls = collectCalls(files, (call) => call.name === 'emit' && call.argumentCount === 0).filter(
    (call) => call.relPath !== KERNEL_FILE,
  )
  const scopeCalls = collectCalls(
    files,
    (call) => call.name === 'emitScope' || call.name === 'emitScopes',
  ).filter((call) => call.relPath !== KERNEL_FILE)

  it('扫描器本身能读到生产源码（防止路径失效后静默通过）', () => {
    expect(files.length).toBeGreaterThan(300)
    // 扫描器必须能在源码里看到调用，否则基线会变成永远为 0 的假通过。
    expect(calls.length).toBeGreaterThan(0)
  })

  it('裸 emit 调用次数不得高于基线', () => {
    const detail = emitCalls.length
      ? `\n当前裸 emit 调用（共 ${emitCalls.length} 次）：\n${formatLocations(emitCalls)}`
      : ''
    expect(
      emitCalls.length,
      `裸 emit 次数超过基线 ${EMIT_BASELINE}（当前 ${emitCalls.length}）。\n` +
        '新增的全局广播必须改成 refreshScopes 地址 + emitScope/emitScopes；' +
        '不要调大基线来放行。' +
        detail,
    ).toBeLessThanOrEqual(EMIT_BASELINE)
  })

  it('scope 通知调用次数不得低于基线', () => {
    const detail = scopeCalls.length
      ? `\n当前 scope 通知调用（共 ${scopeCalls.length} 次）：\n${formatLocations(scopeCalls)}`
      : ''
    expect(
      scopeCalls.length,
      `scope 通知次数低于基线 ${SCOPE_BASELINE}（当前 ${scopeCalls.length}）。\n` +
        '这说明有地方从地址通知回退成了全局广播；请恢复 emitScope/emitScopes，' +
        '不要调小基线来放行。' +
        detail,
    ).toBeGreaterThanOrEqual(SCOPE_BASELINE)
  })
})
