export type LineType =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'fence-open' | 'fence-body' | 'fence-close'
  | 'blockquote'
  | 'ul' | 'ol'
  | 'hr'
  | 'table'
  | 'empty'
  | 'paragraph'

export function classifyLines(lines: string[]): LineType[] {
  const result: LineType[] = new Array(lines.length)
  let inFence = false
  let fenceMarker = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedEnd = line.trimEnd()

    if (inFence) {
      if (isFenceClose(trimmedEnd, fenceMarker)) {
        result[i] = 'fence-close'
        inFence = false
        fenceMarker = ''
      } else {
        result[i] = 'fence-body'
      }
      continue
    }

    const open = trimmedEnd.match(/^(\x60{3,}|~{3,})/)
    if (open) {
      result[i] = 'fence-open'
      inFence = true
      fenceMarker = open[1]
      continue
    }

    if (trimmedEnd === '') {
      result[i] = 'empty'
      continue
    }

    const heading = trimmedEnd.match(/^(#{1,6})\s/)
    if (heading) {
      result[i] = ('h' + heading[1].length) as LineType
      continue
    }

    if (RE_HR.test(trimmedEnd)) {
      result[i] = 'hr'
      continue
    }

    if (trimmedEnd[0] === '>') {
      result[i] = 'blockquote'
      continue
    }

    if (RE_UL.test(trimmedEnd)) {
      result[i] = 'ul'
      continue
    }

    if (RE_OL.test(trimmedEnd)) {
      result[i] = 'ol'
      continue
    }

    if (trimmedEnd[0] === '|') {
      result[i] = 'table'
      continue
    }

    result[i] = 'paragraph'
  }

  return result
}

export function lineTypeToClassName(type: LineType): string {
  return 'hc-line--' + type
}

function isFenceClose(trimmedEnd: string, fenceMarker: string): boolean {
  const ch = fenceMarker[0]
  let count = 0
  while (count < trimmedEnd.length && trimmedEnd[count] === ch) count++
  if (count < fenceMarker.length) return false
  for (let i = count; i < trimmedEnd.length; i++) {
    if (trimmedEnd[i] !== ' ' && trimmedEnd[i] !== '\t') return false
  }
  return true
}

const RE_UL = /^\s*[-*+]\s/
const RE_OL = /^\s*\d+\.\s/
const RE_HR = /^(-{3,}|\*{3,}|_{3,})\s*$/
