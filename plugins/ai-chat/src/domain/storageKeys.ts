export function safeDirName(input: unknown, fallback: unknown) {
  const raw = String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
  const base = raw || String(fallback || '未命名')
  let s = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
  s = s.replace(/[. ]+$/g, '').trim()
  if (!s) s = String(fallback || '未命名')

  const up = s.toUpperCase()
  const reserved =
    up === 'CON' ||
    up === 'PRN' ||
    up === 'AUX' ||
    up === 'NUL' ||
    /^COM[1-9]$/.test(up) ||
    /^LPT[1-9]$/.test(up) ||
    s === '.' ||
    s === '..'
  if (reserved) s = '_' + s

  if (s.length > 60) s = s.slice(0, 60).trim()
  return s || String(fallback || '未命名')
}

export function roleFolderName(role: any) {
  return safeDirName(role?.name, '角色')
}

export function groupFolderName(group: any) {
  return safeDirName(group?.name, '群组')
}

export function splitRoleKey(folder: unknown) {
  return `roles/${String(folder || '')}/role`
}

export function splitChatKey(folder: unknown, chatId: unknown) {
  return `chats/${String(folder || '')}/${String(chatId || '')}`
}

export function splitGroupKey(folder: unknown) {
  return `groups/${String(folder || '')}/group`
}

export function splitGroupChatKey(folder: unknown, chatId: unknown) {
  return `groups/${String(folder || '')}/chats/${String(chatId || '')}`
}
