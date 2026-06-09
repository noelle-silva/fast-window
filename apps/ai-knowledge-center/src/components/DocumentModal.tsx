import * as React from 'react'
import type { DocumentRecord } from '../types'
import { displayTime, joinTags, statusLabel } from '../knowledgePages'

type DocumentModalProps = {
  open: boolean
  document: DocumentRecord | null
  onClose: () => void
}

export function DocumentModal(props: DocumentModalProps) {
  const { open, document, onClose } = props
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  React.useEffect(() => {
    if (open) closeButtonRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="kc-modal-overlay" role="presentation" onMouseDown={onClose}>
      <article
        className="kc-note-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kc-note-modal-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="kc-modal-head">
          <div>
            <p className="kc-eyebrow">{document ? statusLabel(document.metadata.status) : 'Loading'}</p>
            <h2 id="kc-note-modal-title">{document ? document.metadata.name : '正在打开笔记'}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="kc-modal-close" onClick={onClose} aria-label="关闭笔记">×</button>
        </header>
        {document ? (
          <>
            <p className="kc-description">{document.metadata.description || '无描述'}</p>
            <dl className="kc-meta-grid">
              <dt>更新</dt><dd>{displayTime(document.metadata.updated_at)}</dd>
              <dt>标签</dt><dd>{joinTags(document.metadata.tags)}</dd>
              <dt>引用</dt><dd>{document.metadata.references.length ? document.metadata.references.join(' / ') : '无'}</dd>
              <dt>路径</dt><dd>{document.metadata.relative_path}</dd>
            </dl>
            <pre className="kc-content">{document.content}</pre>
          </>
        ) : (
          <div className="kc-modal-loading">正在读取笔记内容...</div>
        )}
      </article>
    </div>
  )
}
