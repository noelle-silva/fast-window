import { describe, expect, it } from 'vitest'
import {
  collectCalls,
  formatLocations,
  loadContractSourceFiles,
} from '../../testing/sourceContractScan'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 全局订阅 ratchet（只允许缩小）。
//
// 迁移期允许 App 根壳继续订阅全局版本，保证拆 Surface 过程中不漏刷；
// 但 `src/ui/**` 下不允许出现新的 `useAiChatState` / `controller.subscribe(...)`。
// 每完成一批 Surface 迁移，就从允许清单里删掉对应文件；清单只减不增。
//
// 基础设施定义文件：它们本身就是订阅能力的实现，不是“使用全局订阅”的组件。
// - useAiChatState.ts 定义 useAiChatState；
// - useScopedUiVersion.ts 定义 useScopedUiVersion / useUiDataVersion（后者内部封装 subscribe）。
// 允许清单只记录真正使用这些能力的 UI 文件。
const SUBSCRIBE_INFRASTRUCTURE_FILES = new Set([
  'src/ui/hooks/useAiChatState.ts',
  'src/ui/hooks/useScopedUiVersion.ts',
])

const ALLOWED_GLOBAL_SUBSCRIPTION_FILES = ['src/ui/App.tsx'] as const

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function isControllerReceiver(receiverText: string | undefined) {
  if (!receiverText) return false
  // 覆盖 controller.subscribe / props.controller.subscribe / ctx.controller.subscribe。
  return /(^|\.)controller$/.test(receiverText)
}

describe('契约·全局订阅只减不增', () => {
  const files = loadContractSourceFiles({ root: UI_ROOT })

  const hits = collectCalls(
    files,
    (call) => call.name === 'useAiChatState' || (call.name === 'subscribe' && isControllerReceiver(call.receiverText)),
  ).filter((hit) => !SUBSCRIBE_INFRASTRUCTURE_FILES.has(hit.relPath))

  it('全局订阅只出现在允许清单内', () => {
    const hitFiles = Array.from(new Set(hits.map((hit) => hit.relPath))).sort()
    const detail = hits.length ? `\n命中的全局订阅：\n${formatLocations(hits)}` : ''

    expect(
      hitFiles,
      '发现了允许清单之外的新增全局订阅。\n' +
        '禁止在 src/ui/** 里直接使用 useAiChatState 或 controller.subscribe(...)；' +
        '请改用 useScopedUiVersion(controller, refreshScopes.xxx())。' +
        detail,
    ).toEqual([...ALLOWED_GLOBAL_SUBSCRIPTION_FILES].sort())
  })

  it('允许清单只减不增：每个被允许的文件都必须仍有命中，迁移完成后要删掉它', () => {
    const hitFiles = new Set(hits.map((hit) => hit.relPath))
    const staleAllowances = ALLOWED_GLOBAL_SUBSCRIPTION_FILES.filter((file) => !hitFiles.has(file))

    expect(
      staleAllowances,
      '允许清单里的文件已经不再使用全局订阅，请把对应项从 ' +
        'ALLOWED_GLOBAL_SUBSCRIPTION_FILES 删除（清单只减不增）。',
    ).toEqual([])
  })
})
