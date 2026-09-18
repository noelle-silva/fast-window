export function plainObject(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function stringField(value: any): string {
  return typeof value === 'string' ? value.trim() : ''
}
