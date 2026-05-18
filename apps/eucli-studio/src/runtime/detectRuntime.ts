export function detectRuntime(): 'ui' | 'background' {
  try {
    const meta = (window as any).fastWindow?.__meta
    return String(meta?.runtime || '').trim() === 'background' ? 'background' : 'ui'
  } catch {
    return 'ui'
  }
}
