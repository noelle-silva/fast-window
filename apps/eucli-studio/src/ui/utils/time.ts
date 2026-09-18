export function numericTimeValue(value: unknown) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return value
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = Date.parse(text)
  return isFinite(parsed) && parsed > 0 ? parsed : 0
}
