import { LineType } from './lineClassifier'

export interface Segment {
  startLine: number
  endLine: number
  markdown: string
}

export function groupLinesIntoSegments(lines: string[], types: LineType[]): Segment[] {
  if (lines.length !== types.length) {
    throw new Error('groupLinesIntoSegments: lines/types length mismatch')
  }

  const seg = (startLine: number, endLine: number): Segment => ({
    startLine,
    endLine,
    markdown: lines.slice(startLine, endLine).join('\n'),
  })

  const segments: Segment[] = []
  let i = 0

  while (i < lines.length) {
    const t = types[i]

    if (t === 'fence-open') {
      const start = i
      i++
      while (i < lines.length && types[i] !== 'fence-close') i++
      if (i < lines.length) i++
      segments.push(seg(start, i))
      continue
    }

    if (t === 'blockquote' || t === 'ul' || t === 'ol' || t === 'table' || t === 'paragraph') {
      const start = i
      const kind: LineType = t
      i++
      while (i < lines.length && types[i] === kind) i++
      segments.push(seg(start, i))
      continue
    }

    segments.push(seg(i, i + 1))
    i++
  }

  return segments
}

