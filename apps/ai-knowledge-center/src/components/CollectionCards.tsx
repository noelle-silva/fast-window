import * as React from 'react'
import type { CollectionSummary } from '../types'

type CollectionCardsProps = {
  collections: CollectionSummary[]
  onOpenCollection: (id: string) => void
  emptyText?: string
}

export function CollectionCards(props: CollectionCardsProps) {
  const { collections, onOpenCollection, emptyText } = props
  return (
    <div className="kc-collection-grid" aria-label="收藏夹列表">
      {collections.map(collection => (
        <button key={collection.id} type="button" className="kc-collection-card" onClick={() => onOpenCollection(collection.id)}>
          <strong>{collection.name}</strong>
          <span>{collection.description || '无描述'}</span>
          <small>{collection.document_ids.length} 篇笔记 · {collection.child_collection_ids.length} 个子收藏夹</small>
        </button>
      ))}
      {!collections.length && emptyText ? <p className="kc-empty">{emptyText}</p> : null}
    </div>
  )
}
