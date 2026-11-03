export type SampleStats = {
  medianMs: number
  minMs: number
  maxMs: number
  samples: number[]
}

export type SingleRow = {
  fixture: string
  label: string
  engineMs: number
  engineNodes: number
  engineHeight: number
  reactMs: number
  reactNodes: number
  reactHeight: number
  engineSamples: number[]
  reactSamples: number[]
}

export type BatchRow = {
  count: number
  engineTotalMs: number
  enginePerMessageMs: number
  engineSamples: number[]
  reactTotalMs: number
  reactPerMessageMs: number
  reactSamples: number[]
}

export type ParallelWorkerRow = {
  workers: number
  wallMs: number
  computeMs: number
  perMessageMs: number
  speedup: number
}

export type ParallelResult = {
  count: number
  mainParseMs: number
  mainParsePerMessageMs: number
  workers: ParallelWorkerRow[]
  mainEngineReferenceMs: number
  mainEngineReferencePerMessageMs: number
}

export type WorkerScreenRow = {
  count: number
  injectMs: number
  injectPerMessageMs: number
  sanitizeInjectMs: number
  sanitizeInjectPerMessageMs: number
}

export type StagedRow = {
  strategy: string
  waitMode: string
  batches: number
  totalWallMs: number
  mountMs: number
  waitMs: number
  maxBlockMs: number
  finalLayoutMs: number
}

export type ScrollResult = {
  frames: number
  durationMs: number
  fps: number
  droppedFrames: number
  droppedPct: number
  p95FrameMs: number
  maxFrameMs: number
  nodes: number
  scrollHeight: number
}

export type BenchResults = {
  meta: {
    userAgent: string
    hardwareConcurrency: number
    startedAt: string
    viewport: { width: number; height: number }
  }
  single: SingleRow[]
  batch: BatchRow[]
  parallel: ParallelResult
  workerScreen: WorkerScreenRow
  staged: StagedRow[]
  scroll: ScrollResult
}
