declare module 'mammoth' {
  export type MammothMessage = {
    type?: string
    message: string
  }

  export type MammothHtmlResult = {
    value: string
    messages: MammothMessage[]
  }

  const mammoth: {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>) => Promise<MammothHtmlResult>
  }

  export default mammoth
}
