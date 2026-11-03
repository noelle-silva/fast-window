import { createUnifiedAssistantRenderEngine } from '../src/render/unified/engine'
import { createBenchCapabilities } from './controller'
import { measureEngineBatch, measureEngineSingle, warmUpEngine } from './engineBench'
import { measureParallel, measureWorkerScreen, produceWorkerHtml } from './parallelBench'
import { measureReactBatch, measureReactSingle, warmUpReact } from './reactBench'
import { measureScroll } from './scrollBench'
import { measureStagedOpen } from './sessionBench'
import { clearStage } from './stage'
import type { BenchResults, BatchRow, SingleRow } from './types'

const BATCH_SIZES = [5, 10, 20, 40, 80, 160, 320, 400]

function mergeSingles(engineRows: SingleRow[], reactRows: SingleRow[]): SingleRow[] {
  return engineRows.map((row) => {
    const react = reactRows.find((item) => item.fixture === row.fixture)
    return {
      ...row,
      reactMs: react?.reactMs ?? 0,
      reactNodes: react?.reactNodes ?? 0,
      reactHeight: react?.reactHeight ?? 0,
      reactSamples: react?.reactSamples ?? [],
    }
  })
}

function mergeBatches(engineRows: BatchRow[], reactRows: BatchRow[]): BatchRow[] {
  return engineRows.map((row) => {
    const react = reactRows.find((item) => item.count === row.count)
    return {
      ...row,
      reactTotalMs: react?.reactTotalMs ?? 0,
      reactPerMessageMs: react?.reactPerMessageMs ?? 0,
      reactSamples: react?.reactSamples ?? [],
    }
  })
}

export async function runAll(): Promise<BenchResults> {
  const startedAt = new Date().toISOString()
  const engine = createUnifiedAssistantRenderEngine(createBenchCapabilities())
  await engine.ensureRenderer()

  clearStage()
  warmUpEngine(engine)
  warmUpReact(engine)

  clearStage()
  const engineSingle = measureEngineSingle(engine)
  const reactSingle = measureReactSingle(engine)
  const single = mergeSingles(engineSingle, reactSingle)

  clearStage()
  const engineBatch = measureEngineBatch(engine, BATCH_SIZES, 4)
  const reactBatch = measureReactBatch(engine, BATCH_SIZES, 2)
  const batch = mergeBatches(engineBatch, reactBatch)

  clearStage()
  const parallel = await measureParallel()
  const reference = batch.find((row) => row.count === 400)
  if (reference) {
    parallel.mainEngineReferenceMs = reference.engineTotalMs
    parallel.mainEngineReferencePerMessageMs = reference.enginePerMessageMs
  }

  clearStage()
  const htmls = await produceWorkerHtml(400, 4)
  const workerScreen = measureWorkerScreen(engine, htmls)

  clearStage()
  const staged = await measureStagedOpen(engine)

  clearStage()
  const scroll = await measureScroll(engine)

  clearStage()

  return {
    meta: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      startedAt,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    single,
    batch,
    parallel,
    workerScreen,
    staged,
    scroll,
  }
}
