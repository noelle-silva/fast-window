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
const EMIT_BASELINE = 266
// scope 通知基线（当前 3 处，由上面的 AST 规则在锚点 137422c5 上算得）：
//   - src/controller/actions/chatNavigationActions.ts:84
//   - src/controller/createControllerV2.ts:1024
//   - src/controller/ebRunEvents.ts:54（可选调用 deps.emitScope?.(item) 同样计入）
// 任何一处减少都会让下面的 `>= SCOPE_BASELINE` 失败，防止有人回退成全局广播。
const SCOPE_BASELINE = 3

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
