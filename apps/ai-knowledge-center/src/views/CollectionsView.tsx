import * as React from 'react'
import { CollectionCards } from '../components/CollectionCards'
import { CollectionPathBar } from '../components/CollectionPathBar'
import { DocumentList } from '../components/DocumentList'
import { collectionChildren, collectionPath, rootCollections } from '../knowledgePages'
import type { CollectionSummary, DocumentSummary } from '../types'

type CollectionsViewProps = {
  collections: CollectionSummary[]
  documents: DocumentSummary[]
  selectedCollectionID: string | null
  selectedDocumentID: string | null
  onOpenCollection: (id: string) => void
  onCloseCollection: () => void
  onSelectDocument: (id: string) => void
}

export function CollectionsView(props: CollectionsViewProps) {
  const {
    collections,
    documents,
    selectedCollectionID,
    selectedDocumentID,
    onOpenCollection,
    onCloseCollection,
    onSelectDocument,
  } = props
  const selectedCollection = collections.find(collection => collection.id === selectedCollectionID) || null
  const visibleCollections = selectedCollection ? collectionChildren(selectedCollection, collections) : rootCollections(collections)
  const selectedCollectionPath = selectedCollection ? collectionPath(selectedCollection, collections) : []
  const collectionDocuments = selectedCollection
    ? selectedCollection.document_ids
      .map(id => documents.find(document => document.id === id))
      .filter((document): document is DocumentSummary => Boolean(document))
    : []

  return (
    <div className="kc-workspace" aria-label="收藏夹">
      <CollectionPathBar path={selectedCollectionPath} onOpenRoot={onCloseCollection} onOpenCollection={onOpenCollection} />
      {selectedCollection ? (
        <div className="kc-collection-detail">
          {visibleCollections.length ? (
            <section className="kc-card" aria-label="子收藏夹">
              <div className="kc-card-title-row">
                <h2>子收藏夹</h2>
                <span>{visibleCollections.length}</span>
              </div>
              <CollectionCards collections={visibleCollections} onOpenCollection={onOpenCollection} />
            </section>
          ) : null}
          <DocumentList
            title="收藏夹内笔记"
            documents={collectionDocuments}
            selectedDocumentID={selectedDocumentID}
            emptyText="这个收藏夹暂无笔记"
            onSelectDocument={onSelectDocument}
          />
        </div>
      ) : (
        <CollectionCards collections={visibleCollections} onOpenCollection={onOpenCollection} emptyText="暂无收藏夹" />
      )}
    </div>
  )
}
