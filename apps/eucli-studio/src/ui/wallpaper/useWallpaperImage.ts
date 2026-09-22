import * as React from 'react'

// 壁纸图片是不可变素材（id 唯一、不复用），读取一次后在会话内缓存，
// 与贴图/引用图的 dataURL 使用方式保持一致。
const wallpaperImageCache = new Map<string, string>()
const wallpaperImagePending = new Map<string, Promise<string>>()

export function clearWallpaperImage(relPath?: string) {
  if (!relPath) {
    wallpaperImageCache.clear()
    return
  }
  wallpaperImageCache.delete(String(relPath || '').trim())
}

export function readWallpaperImage(controller: any, relPath: string): Promise<string> {
  const path = String(relPath || '').trim()
  if (!path) return Promise.resolve('')

  const cached = wallpaperImageCache.get(path)
  if (cached) return Promise.resolve(cached)
  const pending = wallpaperImagePending.get(path)
  if (pending) return pending

  const read = controller?.capabilities?.files?.images?.read
  if (typeof read !== 'function') return Promise.resolve('')

  const task = Promise.resolve(read({ scope: 'data', path }))
    .then((value: unknown) => {
      const src = typeof value === 'string' && value.startsWith('data:') ? value : ''
      if (src) wallpaperImageCache.set(path, src)
      return src
    })
    .catch(() => '')
    .finally(() => {
      wallpaperImagePending.delete(path)
    })

  wallpaperImagePending.set(path, task)
  return task
}

export function useWallpaperImage(controller: any, relPath: string): string {
  const path = String(relPath || '').trim()
  const [src, setSrc] = React.useState(() => (path ? wallpaperImageCache.get(path) || '' : ''))

  React.useEffect(() => {
    if (!path) {
      setSrc('')
      return
    }
    const cached = wallpaperImageCache.get(path)
    if (cached) {
      setSrc(cached)
      return
    }
    let alive = true
    setSrc('')
    readWallpaperImage(controller, path).then((value) => {
      if (alive) setSrc(value)
    })
    return () => {
      alive = false
    }
  }, [controller, path])

  return src
}
