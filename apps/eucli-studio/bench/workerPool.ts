type WorkerResponse = {
  id: number
  count: number
  computeMs: number
  htmls: string[]
}

type Pending = {
  resolve: (value: WorkerResponse) => void
  reject: (error: Error) => void
}

export class ParseWorkerPool {
  private workers: Worker[] = []
  private pending = new Map<number, Pending>()
  private nextId = 1

  constructor(size: number) {
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const pending = this.pending.get(event.data.id)
        if (!pending) return
        this.pending.delete(event.data.id)
        pending.resolve(event.data)
      })
      worker.addEventListener('error', (event) => {
        this.rejectAll(new Error(`解析 worker 失败：${event.message || '未知错误'}`))
      })
      this.workers.push(worker)
    }
  }

  get size() {
    return this.workers.length
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private request(worker: Worker, texts: string[]): Promise<WorkerResponse> {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, texts })
    })
  }

  async warmUp(text: string) {
    await Promise.all(this.workers.map((worker) => this.request(worker, [text])))
  }

  async parseAll(texts: string[]): Promise<{ count: number; computeMs: number; htmls: string[]; wallMs: number }> {
    const startedAt = performance.now()
    const chunkSize = Math.max(1, Math.ceil(texts.length / this.workers.length))
    const chunks: string[][] = []
    for (let i = 0; i < texts.length; i += chunkSize) chunks.push(texts.slice(i, i + chunkSize))
    while (chunks.length < this.workers.length) chunks.push([])

    const responses = await Promise.all(
      chunks.map((chunk, index) => (chunk.length ? this.request(this.workers[index], chunk) : Promise.resolve(null))),
    )
    const wallMs = performance.now() - startedAt
    let computeMs = 0
    const htmls: string[] = []
    for (const response of responses) {
      if (!response) continue
      computeMs += response.computeMs
      htmls.push(...response.htmls)
    }
    return { count: texts.length, computeMs, htmls, wallMs }
  }

  terminate() {
    this.rejectAll(new Error('解析 worker 已终止'))
    for (const worker of this.workers) worker.terminate()
    this.workers = []
  }
}
