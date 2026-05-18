export type ListMovePosition = 'before' | 'after'

export function moveListItemById<T>(items: T[], getId: (item: T) => string, itemId: string, targetItemId: string, position: ListMovePosition): T[] {
  const fromIndex = items.findIndex((item) => getId(item) === itemId)
  const targetIndex = items.findIndex((item) => getId(item) === targetItemId)
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return items

  const next = items.slice()
  const [moved] = next.splice(fromIndex, 1)
  const targetIndexAfterRemove = next.findIndex((item) => getId(item) === targetItemId)
  if (targetIndexAfterRemove < 0) return items

  next.splice(position === 'after' ? targetIndexAfterRemove + 1 : targetIndexAfterRemove, 0, moved)
  return next
}
