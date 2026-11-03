import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { createBenchController, makeBenchMessages } from './controller'
import { FIXTURES, makeBatchTexts, variantText } from './fixtures'
import { BenchChatList } from './chatTree'
import { mountBox } from './stage'
import { elementNodes, forceLayout, median, round } from './stats'
import type { BatchRow, SingleRow } from './types'

type Engine = {
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
}

function listTree(controller: ReturnType<typeof createBenchController>, messages: any[], cacheScope: string) {
  return <BenchChatList controller={controller} messages={messages} cacheScope={cacheScope} />
}

function mountList(host: HTMLElement, controller: ReturnType<typeof createBenchController>, messages: any[], cacheScope: string): Root {
  const root = createRoot(host)
  flushSync(() => {
    root.render(listTree(controller, messages, cacheScope))
  })
  return root
}

function unmountList(root: Root, host: HTMLElement) {
  flushSync(() => root.unmount())
  host.remove()
}

export function warmUpReact(engine: Engine, rounds = 3) {
  const controller = createBenchController(engine)
  const box = mountBox()
  for (let r = 0; r < rounds; r += 1) {
    const host = document.createElement('div')
    box.appendChild(host)
    forceLayout()
    const messages = makeBenchMessages(makeBatchTexts(20, `react-warm-${r}`), `react-warm-${r}`)
    const root = mountList(host, controller, messages, `warm-${r}`)
    forceLayout()
    unmountList(root, host)
  }
  box.remove()
}

export function measureReactSingle(engine: Engine, repeats = 5): SingleRow[] {
  const controller = createBenchController(engine)
  const rows: SingleRow[] = []
  for (const fixture of FIXTURES) {
    const box = mountBox()
    const host = document.createElement('div')
    box.appendChild(host)
    const root = createRoot(host)

    // 单条测的是「已有消息更新」而不是 React 根首次挂载：
    // 先在计时区外挂载同一条消息，再逐轮替换文本。
    const warmText = variantText(fixture.text, `react-single-warm-${fixture.id}`)
    flushSync(() => {
      root.render(listTree(controller, makeBenchMessages([warmText], `react-single-${fixture.id}`), `react-single-${fixture.id}`))
    })
    forceLayout()

    const samples: number[] = []
    let nodes = 0
    let height = 0
    for (let r = 0; r < repeats; r += 1) {
      const text = variantText(fixture.text, `react-single-${fixture.id}-${r}`)
      const messages = makeBenchMessages([text], `react-single-${fixture.id}`)
      const t0 = performance.now()
      flushSync(() => {
        root.render(listTree(controller, messages, `react-single-${fixture.id}`))
      })
      forceLayout()
      const t1 = performance.now()
      samples.push(t1 - t0)
      nodes = elementNodes(host)
      height = host.getBoundingClientRect().height
    }
    unmountList(root, host)
    box.remove()
    rows.push({
      fixture: fixture.id,
      label: fixture.label,
      engineMs: 0,
      engineNodes: 0,
      engineHeight: 0,
      reactMs: round(median(samples)),
      reactNodes: nodes,
      reactHeight: round(height, 2),
      engineSamples: [],
      reactSamples: samples.map((v) => round(v)),
    })
  }
  return rows
}

export function measureReactBatch(engine: Engine, counts: number[], repeats = 2): BatchRow[] {
  const controller = createBenchController(engine)
  const rows: BatchRow[] = []
  for (const count of counts) {
    const samples: number[] = []
    for (let r = 0; r < repeats; r += 1) {
      const box = mountBox()
      const host = document.createElement('div')
      box.appendChild(host)
      forceLayout()
      const messages = makeBenchMessages(makeBatchTexts(count, `react-${count}-${r}`), `react-${count}-${r}`)
      const root = createRoot(host)
      const t0 = performance.now()
      flushSync(() => {
        root.render(listTree(controller, messages, `react-${count}-${r}`))
      })
      forceLayout()
      const t1 = performance.now()
      samples.push(t1 - t0)
      unmountList(root, host)
      box.remove()
    }
    const total = median(samples)
    rows.push({
      count,
      engineTotalMs: 0,
      enginePerMessageMs: 0,
      engineSamples: [],
      reactTotalMs: round(total),
      reactPerMessageMs: round(total / count),
      reactSamples: samples.map((v) => round(v)),
    })
  }
  return rows
}
