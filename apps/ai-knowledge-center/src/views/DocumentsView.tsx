import * as React from 'react'
import { DocumentFilters } from '../components/DocumentFilters'
import { DocumentList } from '../components/DocumentList'
import { DOCUMENT_PAGE_TEXT, type KnowledgePage } from '../knowledgePages'
import type { ConnectionSettings, DocumentSummary } from '../types'

type DocumentsViewProps = {
  page: Exclude<KnowledgePage, 'collections'>
  connection: ConnectionSettings | null
  documents: DocumentSummary[]
  selectedDocumentID: string | null
  query: string
  tag: string
  busy: boolean
  onQueryChange: (value: string) => void
  onTagChange: (value: string) => void
  onApplyFilters: () => Promise<void> | void
  onSelectDocument: (id: string) => void
}

export function DocumentsView(props: DocumentsViewProps) {
  const {
    page,
    connection,
    documents,
    selectedDocumentID,
    query,
    tag,
    busy,
    onQueryChange,
    onTagChange,
    onApplyFilters,
    onSelectDocument,
  } = props
  const text = DOCUMENT_PAGE_TEXT[page]

  return (
    <div className="kc-workspace" aria-label={text.title}>
      <DocumentFilters
        query={query}
        tag={tag}
        busy={busy}
        hasServerKey={Boolean(connection?.hasServerKey)}
        onQueryChange={onQueryChange}
        onTagChange={onTagChange}
        onApplyFilters={onApplyFilters}
      />

      <DocumentList
        title="笔记"
        documents={documents}
        selectedDocumentID={selectedDocumentID}
        emptyText={text.empty}
        onSelectDocument={onSelectDocument}
      />
    </div>
  )
}
