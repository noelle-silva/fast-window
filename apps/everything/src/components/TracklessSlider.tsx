import * as React from 'react'

type TracklessSliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
  disabled?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function decimalPlaces(value: number) {
  const text = String(value)
  const dotIndex = text.indexOf('.')
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1
}

function snapValue(value: number, min: number, max: number, step: number) {
  const next = min + Math.round((value - min) / step) * step
  return Number(clamp(next, min, max).toFixed(decimalPlaces(step)))
}

export function TracklessSlider(props: TracklessSliderProps) {
  const { label, value, min, max, step, onChange, formatValue = String, disabled = false } = props
  const sliderRef = React.useRef<HTMLDivElement | null>(null)
  const activePointerIdRef = React.useRef<number | null>(null)
  const safeValue = snapValue(value, min, max, step)
  const ratio = max === min ? 0 : (safeValue - min) / (max - min)
  const displayValue = formatValue(safeValue)

  const updateFromClientX = React.useCallback((clientX: number) => {
    const slider = sliderRef.current
    if (!slider) return
    const rect = slider.getBoundingClientRect()
    const nextRatio = rect.width <= 0 ? 0 : clamp((clientX - rect.left) / rect.width, 0, 1)
    onChange(snapValue(min + nextRatio * (max - min), min, max, step))
  }, [max, min, onChange, step])

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    activePointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    updateFromClientX(event.clientX)
  }, [disabled, updateFromClientX])

  const onPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || activePointerIdRef.current !== event.pointerId) return
    updateFromClientX(event.clientX)
  }, [disabled, updateFromClientX])

  const onPointerEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return
    activePointerIdRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const setByDelta = React.useCallback((delta: number) => {
    onChange(snapValue(safeValue + delta, min, max, step))
  }, [max, min, onChange, safeValue, step])

  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      setByDelta(-step)
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      setByDelta(step)
      return
    }
    if (event.key === 'PageDown') {
      event.preventDefault()
      setByDelta(-step * 10)
      return
    }
    if (event.key === 'PageUp') {
      event.preventDefault()
      setByDelta(step * 10)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onChange(min)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      onChange(max)
    }
  }, [disabled, max, min, onChange, setByDelta, step])

  return (
    <div className="everything-trackless-slider">
      <div className="everything-trackless-slider-header">
        <span className="everything-trackless-slider-label">{label}</span>
        <output className="everything-trackless-slider-value" aria-live="polite">{displayValue}</output>
      </div>

      <div
        ref={sliderRef}
        className="everything-trackless-slider-field"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={safeValue}
        aria-valuetext={displayValue}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <div className="everything-trackless-slider-thumb" style={{ left: `${ratio * 100}%` }} aria-hidden="true" />
      </div>
    </div>
  )
}
