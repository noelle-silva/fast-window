import * as React from 'react'

// copyTextToClipboard 复制文本到系统剪贴板：优先现代剪贴板接口，失败时回退旧式通路。
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续尝试旧式复制通路
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

// useCopyFeedback 管理「复制按钮短暂变为已复制」的反馈状态：
// 以 key 标识是哪一个按钮刚复制成功，超时后自动复位。
export function useCopyFeedback(durationMs = 1500) {
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const timerRef = React.useRef<number | null>(null)

  const copy = React.useCallback(async (key: string, text: string) => {
    const copied = await copyTextToClipboard(text)
    if (!copied) return
    setCopiedKey(key)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setCopiedKey(null)
    }, durationMs)
  }, [durationMs])

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return { copiedKey, copy }
}
