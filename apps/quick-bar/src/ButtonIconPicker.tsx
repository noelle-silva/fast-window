import * as React from 'react'
import { Shuffle } from 'lucide-react'
import {
  BUTTON_ICON_NAMES,
  BUTTON_ICON_TOTAL,
  ButtonIconGlyph,
  type ButtonIconId,
  resolveButtonIconId,
} from './buttonIcons'
import { QuickActionButton } from './QuickActionButton'

type ButtonIconPickerProps = {
  title: string
  description?: string
  seed: string
  value: string | null | undefined
  onPick: (iconId: ButtonIconId) => void
  onRandom: () => void
}

export function ButtonIconPicker(props: ButtonIconPickerProps) {
  const { title, description, seed, value, onPick, onRandom } = props
  const selectedIconId = resolveButtonIconId(value, seed)
  const searchInputId = React.useId()
  const [searchText, setSearchText] = React.useState('')
  const deferredSearchText = React.useDeferredValue(searchText)
  const iconQuery = deferredSearchText.trim().toLowerCase()
  const visibleIconNames = iconQuery
    ? BUTTON_ICON_NAMES.filter(iconName => iconName.includes(iconQuery))
    : BUTTON_ICON_NAMES

  return (
    <section className="quickbar-icon-picker" aria-label={title}>
      <div className="quickbar-icon-picker-header">
        <div>
          <h5>{title}</h5>
          {description ? <p>{description}</p> : null}
        </div>
        <div className="quickbar-icon-picker-current" title="当前图标">
          <ButtonIconGlyph className="quickbar-icon-picker-current-icon" iconId={selectedIconId} seed={seed} size={30} />
        </div>
      </div>

      <div className="quickbar-icon-picker-toolbar">
        <label className="quickbar-icon-picker-search" htmlFor={searchInputId}>
          <span>查找图标</span>
          <input
            id={searchInputId}
            type="search"
            value={searchText}
            placeholder={`搜索 ${BUTTON_ICON_TOTAL} 个图标`}
            onChange={event => setSearchText(event.currentTarget.value)}
          />
        </label>
        <span className="quickbar-icon-picker-count">{visibleIconNames.length} / {BUTTON_ICON_TOTAL}</span>
        <QuickActionButton variant="subtle" compact icon={<Shuffle size={15} />} onClick={onRandom}>随机图标</QuickActionButton>
      </div>

      <div className="quickbar-icon-picker-grid" role="listbox" aria-label={title}>
        {visibleIconNames.map(iconId => {
          const active = iconId === selectedIconId
          return (
            <button
              key={iconId}
              type="button"
              role="option"
              aria-selected={active}
              aria-label="选择这个图标"
              className={`quickbar-icon-option${active ? ' quickbar-icon-option-active' : ''}`}
              title="选择这个图标"
              onClick={() => onPick(iconId)}
            >
              <ButtonIconGlyph className="quickbar-icon-option-icon" iconId={iconId} seed={seed} size={22} />
            </button>
          )
        })}
        {visibleIconNames.length ? null : <p className="quickbar-icon-picker-empty">没有找到匹配图标</p>}
      </div>
    </section>
  )
}

export function ButtonIconGlyphOnly(props: { iconId: string | null | undefined; seed: string; className?: string; size?: number }) {
  return <ButtonIconGlyph {...props} />
}
