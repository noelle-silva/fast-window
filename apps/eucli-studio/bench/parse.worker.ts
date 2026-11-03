import { createParsePipeline } from './parsePipeline'

type Request = { id: number; texts: string[] }
type Response = { id: number; count: number; computeMs: number; htmls: string[] }

const parse = createParsePipeline()
const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<Request>) => void) => void
  postMessage: (message: Response) => void
}

scope.addEventListener('message', (event) => {
  const { id, texts } = event.data
  const t0 = performance.now()
  const htmls = texts.map((text) => parse(text))
  const computeMs = performance.now() - t0
  scope.postMessage({ id, count: texts.length, computeMs, htmls })
})
