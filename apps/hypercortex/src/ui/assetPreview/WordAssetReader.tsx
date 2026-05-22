import * as React from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import type { AssetPreviewContext } from './registry'
import { createDocxPreviewDocumentHtml, renderDocxArrayBufferToHtml } from '../../docxDocumentRenderer'

function blobToArrayBuffer(blobUrl: string): Promise<ArrayBuffer> {
  return fetch(blobUrl).then(response => {
    if (!response.ok) throw new Error(`读取 Word 文件失败：${response.status}`)
    return response.arrayBuffer()
  })
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
        const result = await renderDocxArrayBufferToHtml(arrayBuffer)
        if (cancelled) return
        setSrcDoc(createDocxPreviewDocumentHtml(result.html))
        if (result.warnings) console.warn('[HyperCortex][word-preview] mammoth warnings:', result.warnings)
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
