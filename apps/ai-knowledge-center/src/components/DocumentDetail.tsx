import * as React from 'react'
import type { DocumentRecord } from '../types'
import { displayTime, joinTags, statusLabel } from '../knowledgePages'

export function DocumentDetail({ selectedDocument }: { selectedDocument: DocumentRecord | null }) {
  return (
    <article className="kc-card kc-detail-card" aria-label="笔记详情">
      {selectedDocument ? (
        <>
          <div className="kc-detail-heading">
            <div>
              <p className="kc-eyebrow">{statusLabel(selectedDocument.metadata.status)}</p>
              <h2>{selectedDocument.metadata.name}</h2>
            </div>
            <span>{joinTags(selectedDocument.metadata.tags)}</span>
          </div>
          <p className="kc-description">{selectedDocument.metadata.description || '无描述'}</p>
          <dl className="kc-meta-grid">
            <dt>更新</dt><dd>{displayTime(selectedDocument.metadata.updated_at)}</dd>
            <dt>引用</dt><dd>{selectedDocument.metadata.references.length ? selectedDocument.metadata.references.join(' / ') : '无'}</dd>
            <dt>路径</dt><dd>{selectedDocument.metadata.relative_path}</dd>
          </dl>
          <pre className="kc-content">{selectedDocument.content}</pre>
        </>
      ) : (
        <div className="kc-empty kc-empty-detail">
          <h2>选择一篇笔记</h2>
          <p>配置服务器并刷新后，笔记正文会显示在这里。</p>
        </div>
      )}
    </article>
  )
}
