import * as React from 'react'
import type { DocumentSummary } from '../types'
import { joinTags, statusLabel } from '../knowledgePages'

type DocumentListProps = {
  title: string
  documents: DocumentSummary[]
  selectedDocumentID: string | null
  emptyText: string
  onSelectDocument: (id: string) => void
}

export function DocumentList(props: DocumentListProps) {
  const { title, documents, selectedDocumentID, emptyText, onSelectDocument } = props
  return (
    <section className="kc-document-browser" aria-label={title}>
      <div className="kc-section-title-row">
        <h2>{title}</h2>
        <span>{documents.length}</span>
      </div>
      <div className="kc-document-grid">
        {documents.map(document => (
          <button
            key={document.id}
            type="button"
            className={`kc-document-card ${document.id === selectedDocumentID ? 'is-selected' : ''}`}
            onClick={() => onSelectDocument(document.id)}
          >
            <strong>{document.name}</strong>
            <span>{document.description || '无描述'}</span>
            <small>{statusLabel(document.status)} · {joinTags(document.tags)}</small>
          </button>
        ))}
        {!documents.length ? <p className="kc-empty">{emptyText}</p> : null}
      </div>
    </section>
  )
}
