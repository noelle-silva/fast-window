// 工作桌面拖拽的控制台诊断。
//
// 命名与其它诊断一致：
//   - 文件：src/diagnostics/deskDrag.diagnostics.ts
//   - 安装：installDeskDragDiagnostics
//   - 全局：__eucliStudioDiagnostics.deskDrag.*
//
// 它只读当前桌面数据，在内存副本上换位，不写后端、不动真实数据。
// 动作串本身在 src/testing/deskDragCases.ts，和单元测试共用同一份。

import { EUCLI_STUDIO_DIAGNOSTICS_KEY } from '../runtime/eucliStudioGlobals'
import {
  deskChatKey,
  deskChatRowId,
  deskGroupRowId,
  moveDeskUnit,
  normalizeDesks,
  type SessionDesks,
} from '../domain/desks'
import { DESK_DRAG_CASES, describeDesks, type DeskDragAction } from '../testing/deskDragCases'

export type DeskDragDiagnosticsDeps = {
  controller: any
}

type RunResult = {
  ok: boolean
  id: string
  desc: string
  expect?: string[]
  actual?: string[]
  error?: string
}

export function installDeskDragDiagnostics(deps: DeskDragDiagnosticsDeps) {
  const { controller } = deps

  function currentDesks(): SessionDesks {
    const data = controller.getState?.()?.data
    return normalizeDesks(data?.desks)
  }

  /** 把简写翻译成真正的行标识。找不到就明确报错，不静默跳过。 */
  function rowIdOf(desks: SessionDesks, token: string): string {
    const [kind, id] = String(token || '').split(':')
    if (kind === 'group') return deskGroupRowId(id)
    if (kind !== 'chat' || !id) throw new Error(`动作写法看不懂：${token}（应为 chat:<id> 或 group:<id>）`)
    for (const item of desks.items) {
      if (item.type === 'chat' && item.chat.chatId === id) return deskChatRowId(deskChatKey(item.chat))
      if (item.type === 'group') {
        const chat = item.group.chats.find((entry) => entry.chatId === id)
        if (chat) return deskChatRowId(deskChatKey(chat))
      }
    }
    throw new Error(`桌面上找不到这条会话：${id}`)
  }

  function applyActions(desks: SessionDesks, actions: DeskDragAction[]) {
    let current = desks
    for (const action of actions) {
      current = moveDeskUnit(current, rowIdOf(current, action.from), rowIdOf(current, action.to))
    }
    return current
  }

  /** 当前桌面的顺序。 */
  function snapshot(): string[] {
    return describeDesks(currentDesks())
  }

  /** 在当前桌面的一份副本上跑一串动作，返回每一步的变化，不写后端。 */
  function sequence(actions: DeskDragAction[]) {
    let current = currentDesks()
    const steps: Array<{ from: string; to: string; order: string[] }> = []
    for (const action of actions) {
      current = moveDeskUnit(current, rowIdOf(current, action.from), rowIdOf(current, action.to))
      steps.push({ from: action.from, to: action.to, order: describeDesks(current) })
    }
    return { order: describeDesks(current), steps }
  }

  /** 跑一条内置动作串（用它自带的初始桌面）。 */
  function run(id: string): RunResult {
    const item = DESK_DRAG_CASES.find((entry) => entry.id === id)
    if (!item) return { ok: false, id, desc: '', error: `没有这条用例：${id}` }
    try {
      const actual = describeDesks(applyActions(item.build(), item.actions))
      const ok = JSON.stringify(actual) === JSON.stringify(item.expect)
      return { ok, id, desc: item.desc, expect: item.expect, actual }
    } catch (error: any) {
      return { ok: false, id, desc: item.desc, error: String(error?.message || error) }
    }
  }

  /** 跑全部内置动作串。 */
  function runAll() {
    const results = DESK_DRAG_CASES.map((item) => run(item.id))
    const failed = results.filter((item) => !item.ok)
    return { ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed, results }
  }

  /** 列出内置动作串。 */
  function cases() {
    return DESK_DRAG_CASES.map((item) => ({ id: item.id, desc: item.desc, steps: item.actions.length }))
  }

  function help() {
    return [
      '工作桌面拖拽诊断（只读当前数据，在副本上换位，不写后端）',
      '  __eucliStudioDiagnostics.deskDrag.cases()            列出内置动作串',
      '  __eucliStudioDiagnostics.deskDrag.run("id")          跑一条，返回期望与实际',
      '  __eucliStudioDiagnostics.deskDrag.runAll()           跑全部',
      '  __eucliStudioDiagnostics.deskDrag.snapshot()         当前桌面顺序',
      '  __eucliStudioDiagnostics.deskDrag.sequence([...])    在当前数据上干跑一串动作',
      '  sequence 用法：[{from:"chat:<会话id>", to:"chat:<会话id>"}, {from:"chat:<id>", to:"group:<组id>"}]',
    ].join('\n')
  }

  const diagnostics = { cases, run, runAll, sequence, snapshot, help }
  const root = ((window as any)[EUCLI_STUDIO_DIAGNOSTICS_KEY] ||= {}) as Record<string, any>
  root.deskDrag = diagnostics
  return diagnostics
}
