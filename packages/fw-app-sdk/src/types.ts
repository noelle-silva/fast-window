export interface FwArgs {
  launched: boolean
  action: 'toggle' | 'show' | 'hide' | 'close'
  command?: string
  mode: 'default' | 'window' | 'top'
  x?: number
  y?: number
  width?: number
  height?: number
}
