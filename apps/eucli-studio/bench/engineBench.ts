import { FIXTURES, variantText } from './fixtures'
import { mountBox } from './stage'
import { elementNodes, forceLayout, median, round } from './stats'
import type { BatchRow, SingleRow } from './types'

type Engine = {
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
}

function newHost(parent: HTMLElement): HTMLDivElement {
  const host = document.createElement('div')
  host.style.width = '100%'
  parent.appendChild(host)
  return host
}

export function warmUpEngine(engine: Engine, rounds = 4) {
  const box = mountBox()
  for (let round = 0; round < rounds; round += 1) {
    for (const fixture of FIXTURES) {
      const host = newHost(box)
      engine.renderAssistantInto(host, variantText(fixture.text, `warm-${round}`))
    }
    forceLayout()
  }
  box.remove()
}

export function measureEngineSingle(engine: Engine, repeats = 5): SingleRow[] {
  const rows: SingleRow[] = []
  for (const fixture of FIXTURES) {
    const box = mountBox()
    const samples: number[] = []
    let nodes = 0
    let height = 0
    for (let r = 0; r < repeats; r += 1) {
      const host = newHost(box)
      forceLayout()
      const text = variantText(fixture.text, `single-${fixture.id}-${r}`)
      const t0 = performance.now()
      engine.renderAssistantInto(host, text)
      forceLayout()
      const t1 = performance.now()
      samples.push(t1 - t0)
      nodes = elementNodes(host)
      height = host.getBoundingClientRect().height
      host.remove()
    }
    box.remove()
    rows.push({
      fixture: fixture.id,
      label: fixture.label,
      engineMs: round(median(samples)),
      engineNodes: nodes,
      engineHeight: round(height, 2),
      reactMs: 0,
      reactNodes: 0,
      reactHeight: 0,
      engineSamples: samples.map((v) => round(v)),
      reactSamples: [],
    })
  }
  return rows
}

export function measureEngineBatch(engine: Engine, counts: number[], repeats = 3): BatchRow[] {
  const rows: BatchRow[] = []
  for (const count of counts) {
    const samples: number[] = []
    for (let r = 0; r < repeats; r += 1) {
      const box = mountBox()
      const hosts: HTMLDivElement[] = []
      for (let i = 0; i < count; i += 1) hosts.push(newHost(box))
      const texts = FIXTURES[0].text
      const prefix = `${texts}\n\n> 批量变体 #${count}-${r}`
      const batchTexts = Array.from({ length: count }, (_, i) => `${prefix}-${i}：用于避开消息级缓存。`)
      forceLayout()
      const t0 = performance.now()
      for (let i = 0; i < count; i += 1) engine.renderAssistantInto(hosts[i], batchTexts[i])
      forceLayout()
      const t1 = performance.now()
      samples.push(t1 - t0)
      box.remove()
    }
    const total = median(samples)
    rows.push({
      count,
      engineTotalMs: round(total),
      enginePerMessageMs: round(total / count),
      engineSamples: samples.map((v) => round(v)),
      reactTotalMs: 0,
      reactPerMessageMs: 0,
      reactSamples: [],
    })
  }
  return rows
}
