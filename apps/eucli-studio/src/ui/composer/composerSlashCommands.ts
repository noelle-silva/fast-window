import { clampNum } from '../utils/numbers'

export type ComposerSlashCommand = {
  command: string
  title: string
  description: string
  keywords: string[]
}

export const COMPOSER_SLASH_COMMANDS: ComposerSlashCommand[] = [
  {
    command: '/compact',
    title: '上下文压缩',
    description: '整理较早聊天，后续使用摘要加最近原文继续。',
    keywords: ['compact', 'context', 'compression', 'summary', '压缩', '摘要', '上下文'],
  },
]

export function findSlashCommandTrigger(text: string, cursorIndex: number) {
  const value = String(text || '')
  if (!value.startsWith('/')) return null
  const cursor = clampNum(Math.floor(Number(cursorIndex || 0)), 0, value.length)
  const firstSpace = value.search(/\s/)
  if (firstSpace >= 0 && cursor > firstSpace) return null
  const tokenEnd = firstSpace >= 0 ? Math.min(cursor, firstSpace) : cursor
  if (tokenEnd < 1) return { query: '' }
  const token = value.slice(1, tokenEnd)
  if (/\s/.test(token)) return null
  return { query: token.trim().toLowerCase() }
}
