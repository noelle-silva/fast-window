// numberNormalize 提供「外部输入 → 有限数 → 范围收敛」的共享基元，
// 供各外观/设置领域模块复用，避免每个模块各写一份容错与精度处理逻辑。

export function toFiniteNumber(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim() : ''
  const raw = typeof value === 'number' ? value : text ? Number(text) : NaN
  return Number.isFinite(raw) ? raw : null
}

export function clampWithPrecision(value: number, min: number, max: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(Math.min(max, Math.max(min, value)) * factor) / factor
}
