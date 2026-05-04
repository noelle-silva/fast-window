import * as React from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import mammoth from 'mammoth'
import type { AssetPreviewContext } from './registry'
import { sanitizeAssetPreviewHtml } from './registry'

function blobToArrayBuffer(blobUrl: string): Promise<ArrayBuffer> {
  return fetch(blobUrl).then(response => {
    if (!response.ok) throw new Error(`读取 Word 文件失败：${response.status}`)
    return response.arrayBuffer()
  })
}

function createWordHtmlDocument(bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      padding: 40px 48px;
      background: #f5f1e8;
      color: #151515;
      font: 16px/1.72 Georgia, 'Times New Roman', serif;
    }
    main {
      box-sizing: border-box;
      max-width: 860px;
      min-height: calc(100vh - 80px);
      margin: 0 auto;
      padding: 56px 64px;
      background: #fffdf8;
      border: 1px solid rgba(67, 50, 24, .12);
      border-radius: 18px;
      box-shadow: 0 18px 54px rgba(57, 45, 26, .14);
    }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.45em 0 .55em; font-family: ui-serif, Georgia, serif; }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p { margin: 0 0 1em; }
    img { max-width: 100%; height: auto; }
    table { width: 100%; border-collapse: collapse; margin: 1em 0; }
    td, th { border: 1px solid rgba(0,0,0,.16); padding: 6px 8px; vertical-align: top; }
    a { color: #1565c0; }
    @media (max-width: 720px) {
      body { padding: 14px; font-size: 15px; }
      main { min-height: calc(100vh - 28px); padding: 28px 22px; border-radius: 14px; }
    }
  </style>
</head>
<body>
  <main>${bodyHtml}</main>
</body>
</html>`
}

export function WordAssetReader({ blobUrl, title }: AssetPreviewContext) {
  const [srcDoc, setSrcDoc] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setSrcDoc('')
    setError(null)

    ;(async () => {
      try {
        const arrayBuffer = await blobToArrayBuffer(blobUrl)
        const result = await mammoth.convertToHtml({ arrayBuffer })
        if (cancelled) return
        const safeHtml = sanitizeAssetPreviewHtml(result.value || '<p>这个 Word 文档没有可显示的正文。</p>')
        setSrcDoc(createWordHtmlDocument(safeHtml))
        const warnings = Array.isArray(result.messages) ? result.messages.length : 0
        if (warnings) console.warn('[HyperCortex][word-preview] mammoth warnings:', result.messages)
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e || 'Word 文档读取失败'))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [blobUrl])

  if (error) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography color="error" sx={{ fontSize: 13 }}>{error}</Typography>
      </Box>
    )
  }

  if (!srcDoc) return <CircularProgress size={20} />

  return <iframe srcDoc={srcDoc} title={title} style={{ width: '100%', height: '100%', border: 0, background: '#f5f1e8' }} />
}
