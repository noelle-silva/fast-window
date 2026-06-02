import * as React from 'react'

export type SettingsTabItem<T extends string> = {
  id: T
  label: string
}

type SettingsTabsProps<T extends string> = {
  items: Array<SettingsTabItem<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}

export function SettingsTabs<T extends string>(props: SettingsTabsProps<T>) {
  const { items, value, onChange, ariaLabel } = props
  const selectedIndex = Math.max(0, items.findIndex(item => item.id === value))

  const focusTab = React.useCallback((index: number) => {
    const item = items[index]
    if (!item) return
    onChange(item.id)
    requestAnimationFrame(() => {
      document.getElementById(`reference-settings-tab-${item.id}`)?.focus()
    })
  }, [items, onChange])

  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!items.length) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusTab((selectedIndex - 1 + items.length) % items.length)
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusTab((selectedIndex + 1) % items.length)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusTab(items.length - 1)
    }
  }, [focusTab, items.length, selectedIndex])

  return (
    <div className="reference-settings-toolbar">
      <div className="reference-settings-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
        {items.map(item => {
          const selected = item.id === value
          return (
            <button
              key={item.id}
              type="button"
              className="reference-settings-tab"
              role="tab"
              id={`reference-settings-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`reference-settings-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
