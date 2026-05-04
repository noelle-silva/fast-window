export function createUiCore() {
  let ver = 0
  const subs = new Set<() => void>()
  return {
    emit: () => { ver++; subs.forEach(fn => { try { fn() } catch (_) {} }) },
    subscribe: (fn: () => void) => { subs.add(fn); return () => subs.delete(fn) },
    getVer: () => ver,
  }
}
