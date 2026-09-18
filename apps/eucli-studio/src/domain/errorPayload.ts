export type ErrorPayload = {
  code?: string
  message: string
  system?: string
  details?: unknown
  cause?: ErrorPayload
  causes?: ErrorPayload[]
}

export function normalizeErrorPayload(input: unknown): ErrorPayload | null {
  const raw = input && typeof input === 'object' ? (input as any) : null
  if (!raw) return null
  const message = String(raw.message || '').trim()
  if (!message) return null
  const out: ErrorPayload = { message }
  const code = String(raw.code || '').trim()
  const system = String(raw.system || '').trim()
  if (code) out.code = code
  if (system) out.system = system
  if (Object.prototype.hasOwnProperty.call(raw, 'details')) out.details = raw.details
  const cause = normalizeErrorPayload(raw.cause)
  if (cause) out.cause = cause
  const causes = normalizeErrorPayloads(raw.causes)
  if (causes.length) out.causes = causes
  return out
}

export function normalizeErrorPayloads(input: unknown): ErrorPayload[] {
  if (!Array.isArray(input)) return []
  const out: ErrorPayload[] = []
  for (const item of input) {
    const payload = normalizeErrorPayload(item)
    if (payload) out.push(payload)
  }
  return out
}

export function assignErrorPayload(error: any, payload: ErrorPayload | null) {
  if (!payload) return error
  if (payload.code) error.code = payload.code
  if (payload.system) error.system = payload.system
  if (Object.prototype.hasOwnProperty.call(payload, 'details')) error.details = payload.details
  if (payload.cause) error.cause = payload.cause
  if (payload.causes?.length) error.causes = payload.causes
  return error
}
