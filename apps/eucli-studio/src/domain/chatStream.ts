export function chatStreamEnabled(chat: unknown): boolean {
  return (chat as any)?.streamEnabled !== false
}
