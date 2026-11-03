import { makeBatchTexts } from './fixtures'
import { createParsePipeline } from './parsePipeline'
import { mountBox } from './stage'
import { forceLayout, median, round } from './stats'
import type { ParallelResult, ParallelWorkerRow, WorkerScreenRow } from './types'
import { ParseWorkerPool } from './workerPool'

const PARALLEL_COUNT = 400
const WORKER_SIZES = [1, 4, 8]
const REPEATS = 2

type Engine = {
  sanitizeHtml: (html: unknown, policy?: any) => string
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
}

export async function measureParallel(): Promise<ParallelResult> {
  const texts = makeBatchTexts(PARALLEL_COUNT, 'parallel')
  const parse = createParsePipeline()

  for (let i = 0; i < 12; i += 1) parse(texts[i])

  const mainSamples: number[] = []
  for (let r = 0; r < REPEATS; r += 1) {
    const t0 = performance.now()
    for (const text of texts) parse(text)
    mainSamples.push(performance.now() - t0)
  }
  const mainParseMs = median(mainSamples)

  const workers: ParallelWorkerRow[] = []
  for (const size of WORKER_SIZES) {
    const pool = new ParseWorkerPool(size)
    await pool.warmUp(texts[0])
    const wallSamples: number[] = []
    const computeSamples: number[] = []
    for (let r = 0; r < REPEATS; r += 1) {
      const result = await pool.parseAll(texts)
      wallSamples.push(result.wallMs)
      computeSamples.push(result.computeMs)
    }
    pool.terminate()
    const wallMs = median(wallSamples)
    workers.push({
      workers: size,
      wallMs: round(wallMs),
      computeMs: round(median(computeSamples)),
      perMessageMs: round(wallMs / texts.length),
      speedup: wallMs > 0 ? round(mainParseMs / wallMs, 2) : 0,
    })
  }

  return {
    count: PARALLEL_COUNT,
    mainParseMs: round(mainParseMs),
    mainParsePerMessageMs: round(mainParseMs / texts.length),
    workers,
    mainEngineReferenceMs: 0,
    mainEngineReferencePerMessageMs: 0,
  }
}

export async function produceWorkerHtml(count: number, workers = 4): Promise<string[]> {
  const texts = makeBatchTexts(count, 'worker-screen')
  const pool = new ParseWorkerPool(workers)
  await pool.warmUp(texts[0])
  const result = await pool.parseAll(texts)
  pool.terminate()
  return result.htmls
}

export function measureWorkerScreen(engine: Engine, htmls: string[], repeats = 2): WorkerScreenRow {
  const warmBox = mountBox()
  for (let i = 0; i < Math.min(20, htmls.length); i += 1) {
    const host = document.createElement('div')
    warmBox.appendChild(host)
    host.innerHTML = engine.sanitizeHtml(htmls[i])
  }
  forceLayout()
  warmBox.remove()

  const injectSamples: number[] = []
  const sanitizeSamples: number[] = []

  for (let r = 0; r < repeats; r += 1) {
    {
      const box = mountBox()
      const hosts: HTMLDivElement[] = []
      for (let i = 0; i < htmls.length; i += 1) {
        const host = document.createElement('div')
        box.appendChild(host)
        hosts.push(host)
      }
      forceLayout()
      const t0 = performance.now()
      for (let i = 0; i < hosts.length; i += 1) hosts[i].innerHTML = htmls[i]
      forceLayout()
      injectSamples.push(performance.now() - t0)
      box.remove()
    }

    {
      const box = mountBox()
      const hosts: HTMLDivElement[] = []
      for (let i = 0; i < htmls.length; i += 1) {
        const host = document.createElement('div')
        box.appendChild(host)
        hosts.push(host)
      }
      forceLayout()
      const t0 = performance.now()
      for (let i = 0; i < hosts.length; i += 1) hosts[i].innerHTML = engine.sanitizeHtml(htmls[i])
      forceLayout()
      sanitizeSamples.push(performance.now() - t0)
      box.remove()
    }
  }

  const injectMs = median(injectSamples)
  const sanitizeMs = median(sanitizeSamples)
  return {
    count: htmls.length,
    injectMs: round(injectMs),
    injectPerMessageMs: round(injectMs / Math.max(1, htmls.length)),
    sanitizeInjectMs: round(sanitizeMs),
    sanitizeInjectPerMessageMs: round(sanitizeMs / Math.max(1, htmls.length)),
  }
}
