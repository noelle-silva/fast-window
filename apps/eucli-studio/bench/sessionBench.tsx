import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  MESSAGE_BATCH_INITIAL_SIZE,
  MESSAGE_BATCH_SIZE,
} from '../src/domain/messageBatchMount'
import { BenchChatList } from './chatTree'
import { createBenchController, makeBenchMessages } from './controller'
import { makeStagedTexts } from './fixtures'
import { mountBox } from './stage'
import { forceLayout, round } from './stats'
import type { StagedRow } from './types'

const TOTAL = 400

type Engine = {
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
}

type WaitStrategy = {
  name: string
  waitMode: string
  wait: () => Promise<void>
}

// 时间片让出：优先用 Chrome 的 scheduler.yield（明确让出渲染机会），
// 其次用 MessageChannel 宏任务，最后退回 setTimeout(0)。
function createTimeSliceStrategy(): WaitStrategy {
  const scheduler = (globalThis as any).scheduler
  if (scheduler && typeof scheduler.yield === 'function') {
    return {
      name: '时间片让出',
      waitMode: 'scheduler.yield',
      wait: () => scheduler.yield(),
    }
  }

  if (typeof MessageChannel === 'function') {
    const resolvers: Array<() => void> = []
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      const resolve = resolvers.shift()
      if (resolve) resolve()
    }
    return {
      name: '时间片让出',
      waitMode: 'MessageChannel',
      wait: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve)
          channel.port2.postMessage(0)
        }),
    }
  }

  return {
    name: '时间片让出',
    waitMode: 'setTimeout(0)',
    wait: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  }
}

// 旧实现的固定等待只保留为基准对照，不再进入生产代码。
const LEGACY_FIXED_WAIT_MS = 80

function fixedWaitStrategy(): WaitStrategy {
  return {
    name: '现有固定等待',
    waitMode: `setTimeout(${LEGACY_FIXED_WAIT_MS})`,
    wait: () => new Promise<void>((resolve) => setTimeout(resolve, LEGACY_FIXED_WAIT_MS)),
  }
}

async function runStrategy(engine: Engine, strategy: WaitStrategy, tag: string): Promise<StagedRow> {
  const texts = makeStagedTexts(TOTAL, `staged-${tag}`)
  const all = makeBenchMessages(texts, `staged-${tag}`)
  const controller = createBenchController(engine)
  const cacheScope = `staged-${tag}`
  const box = mountBox()
  const host = document.createElement('div')
  box.appendChild(host)
  const root = createRoot(host)

  // 等价模拟：批次按到达顺序追加（不向上插入历史）。
  // 这样把「等待策略」从「历史前插引发的整表重排」里隔离出来；
  // 单条和批量表已经单独覆盖了消息本身与整树布局成本。
  let end = MESSAGE_BATCH_INITIAL_SIZE
  let mounted = all.slice(0, end)
  forceLayout()

  const wallStart = performance.now()
  let t0 = performance.now()
  flushSync(() => {
    root.render(<BenchChatList controller={controller} messages={mounted} cacheScope={cacheScope} />)
  })
  forceLayout()
  let mountMs = performance.now() - t0
  let maxBlockMs = mountMs
  let waitMs = 0
  let batches = 0

  while (end < TOTAL) {
    const waitStart = performance.now()
    await strategy.wait()
    waitMs += performance.now() - waitStart

    end = Math.min(TOTAL, end + MESSAGE_BATCH_SIZE)
    mounted = all.slice(0, end)
    t0 = performance.now()
    flushSync(() => {
      root.render(<BenchChatList controller={controller} messages={mounted} cacheScope={cacheScope} />)
    })
    const block = performance.now() - t0
    mountMs += block
    maxBlockMs = Math.max(maxBlockMs, block)
    batches += 1
  }

  // 每批只计量 React 提交；末尾统一强制一次排版。
  // 若每批都强制整棵文档排版，400 条会产生 O(n²) 的重排噪声，
  // 把「等待策略」的差异淹没掉；消息与布局成本已由 a/b/c 覆盖。
  const layoutStart = performance.now()
  forceLayout()
  const finalLayoutMs = performance.now() - layoutStart
  mountMs += finalLayoutMs
  maxBlockMs = Math.max(maxBlockMs, finalLayoutMs)

  const totalWallMs = performance.now() - wallStart
  flushSync(() => root.unmount())
  host.remove()
  box.remove()

  return {
    strategy: strategy.name,
    waitMode: strategy.waitMode,
    batches,
    totalWallMs: round(totalWallMs),
    mountMs: round(mountMs),
    waitMs: round(waitMs),
    maxBlockMs: round(maxBlockMs),
    finalLayoutMs: round(finalLayoutMs),
  }
}

export async function measureStagedOpen(engine: Engine): Promise<StagedRow[]> {
  await warmUpStaged(engine)
  const rows: StagedRow[] = []
  rows.push(await runStrategy(engine, fixedWaitStrategy(), 'fixed'))
  rows.push(await runStrategy(engine, createTimeSliceStrategy(), 'yield'))
  return rows
}

async function warmUpStaged(engine: Engine) {
  const all = makeBenchMessages(makeStagedTexts(60, 'staged-warm'), 'staged-warm')
  const controller = createBenchController(engine)
  const box = mountBox()
  const host = document.createElement('div')
  box.appendChild(host)
  const root = createRoot(host)
  let end = MESSAGE_BATCH_INITIAL_SIZE
  flushSync(() => {
    root.render(<BenchChatList controller={controller} messages={all.slice(0, end)} cacheScope="staged-warm" />)
  })
  while (end < all.length) {
    end = Math.min(all.length, end + MESSAGE_BATCH_SIZE)
    flushSync(() => {
      root.render(<BenchChatList controller={controller} messages={all.slice(0, end)} cacheScope="staged-warm" />)
    })
  }
  forceLayout()
  flushSync(() => root.unmount())
  host.remove()
  box.remove()
}
