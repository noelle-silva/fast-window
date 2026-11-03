import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { BenchChatList } from './chatTree'
import { createBenchController, makeBenchMessages } from './controller'
import { makeBatchTexts } from './fixtures'
import { mountBox } from './stage'
import { forceLayout, percentile, round, waitFrames } from './stats'
import type { ScrollResult } from './types'

const TOTAL = 400
const DURATION_MS = 2000

type Engine = {
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
}

export async function measureScroll(engine: Engine): Promise<ScrollResult> {
  const messages = makeBenchMessages(makeBatchTexts(TOTAL, 'scroll'), 'scroll')
  const controller = createBenchController(engine)
  const box = mountBox()
  box.style.height = '900px'
  box.style.overflowY = 'auto'
  box.style.overflowX = 'hidden'
  const content = document.createElement('div')
  box.appendChild(content)
  const root = createRoot(content)

  flushSync(() => {
    root.render(<BenchChatList controller={controller} messages={messages} cacheScope="scroll" />)
  })
  forceLayout()
  await waitFrames(3)

  const nodes = content.querySelectorAll('*').length
  const scrollHeight = box.scrollHeight
  const maxScroll = Math.max(0, scrollHeight - box.clientHeight)

  const intervals: number[] = []
  let lastTs = performance.now()
  const startedAt = performance.now()

  await new Promise<void>((resolve) => {
    const step = (ts: number) => {
      intervals.push(ts - lastTs)
      lastTs = ts
      const elapsed = ts - startedAt
      const phase = elapsed / DURATION_MS
      const progress = phase <= 0.5 ? phase * 2 : (1 - phase) * 2
      box.scrollTop = maxScroll * progress
      if (elapsed < DURATION_MS) requestAnimationFrame(step)
      else resolve()
    }
    requestAnimationFrame(step)
  })

  const elapsedMs = performance.now() - startedAt
  const frames = intervals.length
  const expected = 1000 / 60
  const dropped = intervals.filter((dt) => dt > expected * 1.5).length

  flushSync(() => root.unmount())
  box.remove()

  return {
    frames,
    durationMs: round(elapsedMs, 1),
    fps: round((frames / elapsedMs) * 1000, 1),
    droppedFrames: dropped,
    droppedPct: round((dropped / Math.max(1, frames)) * 100, 1),
    p95FrameMs: round(percentile(intervals, 95), 2),
    maxFrameMs: round(intervals.length ? Math.max(...intervals) : 0, 2),
    nodes,
    scrollHeight,
  }
}
