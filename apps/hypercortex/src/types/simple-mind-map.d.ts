declare module 'simple-mind-map' {
  export type SimpleMindMapOptions = Record<string, unknown>

  export type SimpleMindMapNode = {
    getData(key: string): unknown
  }

  export type SimpleMindMapRenderer = {
    root: SimpleMindMapNode | null
    findNodeByUid(uid: string): SimpleMindMapNode | null
  }

  export default class MindMap {
    constructor(options: SimpleMindMapOptions)
    static usePlugin(plugin: unknown, opt?: Record<string, unknown>): typeof MindMap
    on(event: string, handler: (...args: any[]) => void): void
    off(event: string, handler: (...args: any[]) => void): void
    execCommand(command: string, ...args: unknown[]): void
    setData(data: unknown): void
    getData(withConfig?: boolean): unknown
    setLayout(layout: string, notRender?: boolean): void
    getLayout(): string
    setTheme(theme: string, notRender?: boolean): void
    setThemeConfig(config: Record<string, unknown>, notRender?: boolean): void
    setMode(mode: string): void
    render(callback?: (() => void) | null, source?: string): void
    resize(): void
    destroy(): void
    renderer: SimpleMindMapRenderer
    view: {
      setScale(scale: number, cx?: number, cy?: number): void
      fit(getRbox?: unknown, enlarge?: boolean, fitPadding?: number): void
    }
  }
}

declare module 'simple-mind-map/src/plugins/Drag.js' {
  const plugin: unknown
  export default plugin
}

declare module 'simple-mind-map/src/plugins/Select.js' {
  const plugin: unknown
  export default plugin
}

declare module 'simple-mind-map/src/plugins/MindMapLayoutPro.js' {
  const plugin: unknown
  export default plugin
}
