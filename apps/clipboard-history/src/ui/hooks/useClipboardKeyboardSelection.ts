import * as React from 'react'
import { CLIPBOARD_PAGE_SIZE } from '../../shared/constants'
import type { ClipboardHistoryItem } from '../../shared/types'
import { historyKey } from '../clipboardUiUtils'
import type { ClipboardHistoryController } from './useClipboardHistoryController'

const CLIPBOARD_ITEM_ID_PREFIX = 'clipboard-item-'

type KeyboardSelectionAction = 'previous' | 'next' | 'copy' | null

export function clipboardItemDomId(key: string): string {
  return `${CLIPBOARD_ITEM_ID_PREFIX}${key}`
}

function isKeyboardInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]')
}

function nextClipboardLimitForIndex(index: number, limit: number, total: number, maxHistory: number): number {
  if (index < limit) return limit
  return Math.min(maxHistory, Math.max(index + 1, limit + CLIPBOARD_PAGE_SIZE), total)
}

function keyboardSelectionAction(event: KeyboardEvent): KeyboardSelectionAction {
  if (event.defaultPrevented || event.altKey || event.metaKey || event.shiftKey || isKeyboardInputTarget(event.target)) return null
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  if (!event.ctrlKey && (event.key === 'Enter' || event.key === ' ')) return 'copy'
  return null
}

export function useClipboardKeyboardSelection(params: {
  items: ClipboardHistoryItem[]
  limit: number
  total: number
  maxHistory: number
  bootStatus: ClipboardHistoryController['bootStatus']
  blocked: boolean
  setClipboardLimit(limit: number): void
  copyHistoryItem(item: ClipboardHistoryItem): Promise<void>
}) {
  const { items, limit, total, maxHistory, bootStatus, blocked, setClipboardLimit, copyHistoryItem } = params
  const [selectedKey, setSelectedKey] = React.useState('')
  const itemKeys = React.useMemo(() => items.map(historyKey), [items])
  const selectedIndex = selectedKey ? itemKeys.indexOf(selectedKey) : -1

  const ensureLimitForIndex = React.useCallback((index: number) => {
    const next = nextClipboardLimitForIndex(index, limit, total, maxHistory)
    if (next > limit) setClipboardLimit(next)
  }, [limit, maxHistory, setClipboardLimit, total])

  React.useEffect(() => {
    if (!itemKeys.length) {
      if (selectedKey) setSelectedKey('')
      return
    }
    const currentIndex = selectedKey ? itemKeys.indexOf(selectedKey) : -1
    if (currentIndex >= 0) {
      ensureLimitForIndex(currentIndex)
      return
    }
    setSelectedKey(itemKeys[0])
  }, [ensureLimitForIndex, itemKeys, selectedKey])

  React.useEffect(() => {
    if (!selectedKey) return
    document.getElementById(clipboardItemDomId(selectedKey))?.scrollIntoView({ block: 'nearest' })
  }, [selectedKey, limit])

  const selectByOffset = React.useCallback((offset: number) => {
    if (!itemKeys.length) return
    const fallbackIndex = offset > 0 ? -1 : itemKeys.length
    const currentIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex
    const nextIndex = Math.min(itemKeys.length - 1, Math.max(0, currentIndex + offset))
    ensureLimitForIndex(nextIndex)
    setSelectedKey(itemKeys[nextIndex])
  }, [ensureLimitForIndex, itemKeys, selectedIndex])

  const copySelected = React.useCallback(() => {
    if (!items.length) return
    const item = items[selectedIndex >= 0 ? selectedIndex : 0]
    if (!item) return
    setSelectedKey(historyKey(item))
    void copyHistoryItem(item)
  }, [copyHistoryItem, items, selectedIndex])

  React.useEffect(() => {
    if (bootStatus !== 'ready' || blocked) return
    const onKeyDown = (event: KeyboardEvent) => {
      const action = keyboardSelectionAction(event)
      if (!action) return
      if (action === 'copy' && event.repeat) return
      event.preventDefault()
      if (action === 'next') selectByOffset(1)
      else if (action === 'previous') selectByOffset(-1)
      else copySelected()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blocked, bootStatus, copySelected, selectByOffset])

  return { selectedKey, selectKey: setSelectedKey }
}
