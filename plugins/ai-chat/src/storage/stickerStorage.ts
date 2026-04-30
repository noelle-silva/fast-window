import { now, uid } from '../core/utils'
import { imageExtFromDataUrl } from '../domain/stickerValidator'
import { looksLikeImageDataUrl } from '../domain/textProcessing'
import type { AiChatImageStorageAdapter } from './types'

export function createStickerStorage(deps: {
  filesImages: AiChatImageStorageAdapter
  getState: () => any
}) {
  const { filesImages, getState } = deps

  async function addStickerInternal(cat: any, name: any, dataUrl: any) {
    const data = getState()
    if (!data) return { ok: false, kind: 'no-data' as const }
    if (!data.settings.stickers || typeof data.settings.stickers !== 'object')
      data.settings.stickers = { enabled: false, categories: [], map: {} }
    const st = data.settings.stickers

    if (!Array.isArray(st.categories)) st.categories = []
    if (!st.categories.some((x: any) => String(x || '') === cat))
      st.categories = st.categories.concat([cat]).slice(0, 200)
    if (!st.map || typeof st.map !== 'object') st.map = {}
    if (!st.map[cat] || typeof st.map[cat] !== 'object') st.map[cat] = {}
    if (st.map[cat][name]) return { ok: false, kind: 'dup' as const }

    const u = String(dataUrl || '').trim()
    if (!looksLikeImageDataUrl(u)) return { ok: false, kind: 'bad-image' as const }
    const ext = imageExtFromDataUrl(u)
    if (!ext) return { ok: false, kind: 'bad-image' as const }

    if (typeof filesImages?.writeBase64 !== 'function') return { ok: false, kind: 'no-perm' as const }

    const relPath = `stickers/${cat}/sticker-${uid('st')}.${ext}`
    await filesImages.writeBase64({ scope: 'data', relPath, overwrite: false, dataUrlOrBase64: u })

    const t = now()
    st.map[cat][name] = { relPath, createdAt: t, updatedAt: t }
    return { ok: true, kind: 'ok' as const, relPath }
  }

  async function syncRoleAvatarFile(folder: any, role: any) {
    const f = String(folder || '').trim()
    if (!f) return

    const relPath = `roles/${f}/avatar.png`
    const avatarImage = String(role?.avatarImage || '').trim()

    if (looksLikeImageDataUrl(avatarImage)) {
      if (typeof filesImages?.writeBase64 !== 'function') return
      await filesImages
        .writeBase64({ scope: 'data', relPath, overwrite: true, dataUrlOrBase64: avatarImage })
        .catch(() => {})
      return
    }

    if (typeof filesImages?.delete !== 'function') return
    await filesImages.delete({ scope: 'data', path: relPath }).catch(() => {})
  }

  async function syncGroupAvatarFile(folder: any, group: any) {
    const f = String(folder || '').trim()
    if (!f) return

    const relPath = `groups/${f}/avatar.png`
    const avatarImage = String(group?.avatarImage || '').trim()

    if (looksLikeImageDataUrl(avatarImage)) {
      if (typeof filesImages?.writeBase64 !== 'function') return
      await filesImages
        .writeBase64({ scope: 'data', relPath, overwrite: true, dataUrlOrBase64: avatarImage })
        .catch(() => {})
      return
    }

    if (typeof filesImages?.delete !== 'function') return
    await filesImages.delete({ scope: 'data', path: relPath }).catch(() => {})
  }

  function getStickerRelPath(category: any, name: any) {
    const cat = typeof category === 'string' ? category.trim() : ''
    const nm = typeof name === 'string' ? name.trim() : ''
    if (!cat || !nm) return ''
    const data = getState()
    const st = data?.settings?.stickers
    const box = st && typeof st === 'object' ? st.map?.[cat] : null
    const it = box && typeof box === 'object' ? box[nm] : null
    const relPath = it && typeof it === 'object' ? String(it.relPath || '').trim() : ''
    return relPath
  }

  return { addStickerInternal, syncRoleAvatarFile, syncGroupAvatarFile, getStickerRelPath }
}
