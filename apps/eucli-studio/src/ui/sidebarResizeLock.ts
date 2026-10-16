// 侧边栏宽度拖拽期间的全局交互锁。
// 拖动中手柄原地不动、指针会离开手柄悬停到任意元素上，
// 因此必须用 !important 的全局规则强制保持左右缩放光标，并禁止选中文字。

const LOCK_ELEMENT_ID = 'fw-sidebar-resize-lock'
const LOCK_CSS =
  '*,*::before,*::after{cursor:col-resize !important;user-select:none !important;-webkit-user-select:none !important;}'

export function setSidebarResizeLock(active: boolean): void {
  const existing = document.getElementById(LOCK_ELEMENT_ID)
  if (active) {
    if (existing) return
    const el = document.createElement('style')
    el.id = LOCK_ELEMENT_ID
    el.textContent = LOCK_CSS
    document.head.appendChild(el)
    return
  }
  if (existing) existing.remove()
}
