import * as React from 'react'
import type { CollectionSummary } from '../types'

type CollectionPathBarProps = {
  path: CollectionSummary[]
  onOpenRoot: () => void
  onOpenCollection: (id: string) => void
}

export function CollectionPathBar(props: CollectionPathBarProps) {
  const { path, onOpenRoot, onOpenCollection } = props
  const currentID = path.length ? path[path.length - 1].id : null

  return (
    <nav className="kc-collection-path" aria-label="收藏夹路径">
      {currentID ? (
        <button type="button" onClick={onOpenRoot}>收藏夹首页</button>
      ) : (
        <strong aria-current="page">收藏夹首页</strong>
      )}
      {path.map(collection => (
        <React.Fragment key={collection.id}>
          <span aria-hidden="true">/</span>
          {collection.id === currentID ? (
            <strong aria-current="page">{collection.name}</strong>
          ) : (
            <button type="button" onClick={() => onOpenCollection(collection.id)}>{collection.name}</button>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}
