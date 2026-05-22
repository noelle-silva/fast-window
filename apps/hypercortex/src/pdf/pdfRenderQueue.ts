type QueuedPdfRenderJob = {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  cancelled: boolean
  started: boolean
}

export type QueuedPdfRender<T> = {
  promise: Promise<T>
  cancel: () => void
}

const PDF_RENDER_ABORT_NAME = 'AbortError'
const PDF_RENDER_CANCELLED_NAME = 'RenderingCancelledException'

export function isPdfRenderCancelled(error: unknown): boolean {
  const name = String((error as { name?: unknown } | null)?.name || '')
  return name === PDF_RENDER_ABORT_NAME || name === PDF_RENDER_CANCELLED_NAME
}

export class PdfRenderQueue {
  private readonly queue: QueuedPdfRenderJob[] = []
  private running = false

  enqueue<T>(run: () => Promise<T>): QueuedPdfRender<T> {
    let job: QueuedPdfRenderJob
    const promise = new Promise<T>((resolve, reject) => {
      job = { run, resolve: value => resolve(value as T), reject, cancelled: false, started: false }
    })

    this.queue.push(job!)
    this.pump()

    return {
      promise,
      cancel: () => {
        job!.cancelled = true
        if (!job!.started) job!.reject(new DOMException('PDF 页面渲染已取消', PDF_RENDER_ABORT_NAME))
      },
    }
  }

  private pump(): void {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    if (job.cancelled) {
      this.pump()
      return
    }

    this.running = true
    job.started = true
    job.run()
      .then(value => job.resolve(value))
      .catch(error => job.reject(error))
      .finally(() => {
        this.running = false
        this.pump()
      })
  }
}

export const pdfPageRenderQueue = new PdfRenderQueue()
