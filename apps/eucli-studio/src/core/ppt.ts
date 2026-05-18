import JSZip from 'jszip'

const MAX_OUTPUT_CHARS = 2_000_000
const MAX_SLIDES = 200

function clamp(n: number, min: number, max: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

function isZip(u8: Uint8Array) {
  return u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04
}

function normalizeZipPath(p: string) {
  const raw = String(p || '').replaceAll('\\', '/')
  const parts = raw.split('/').filter((x) => x && x !== '.')
  const out: string[] = []
  for (const it of parts) {
    if (it === '..') out.pop()
    else out.push(it)
  }
  return out.join('/')
}

function resolveZipTarget(fromPath: string, target: string) {
  const t = String(target || '').trim()
  if (!t) return ''
  const fromDir = normalizeZipPath(String(fromPath || '')).split('/').slice(0, -1).join('/')
  return normalizeZipPath((fromDir ? fromDir + '/' : '') + t)
}

function escapeHtml(s: string) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function parseXml(xml: string) {
  const raw = String(xml || '')
  const doc = new DOMParser().parseFromString(raw, 'application/xml')
  const err = doc.getElementsByTagName('parsererror')
  if (err && err.length) throw new Error('pptx 解析失败：XML 解析错误')
  return doc
}

function firstElNS(root: ParentNode, local: string): Element | null {
  const anyRoot = root as any
  const list = typeof anyRoot?.getElementsByTagNameNS === 'function' ? anyRoot.getElementsByTagNameNS('*', local) : null
  return list && list.length ? (list[0] as Element) : null
}

function childEls(el: Element) {
  return Array.from(el.children || []) as Element[]
}

function localName(el: Element | null | undefined) {
  return el ? String((el as any).localName || '').trim() : ''
}

function appendLimited(buf: { s: string }, t: string) {
  if (!t) return
  if (buf.s.length >= MAX_OUTPUT_CHARS) return
  buf.s += t.slice(0, Math.max(0, MAX_OUTPUT_CHARS - buf.s.length))
}

function textFromInline(el: Element) {
  const buf = { s: '' }

  function walk(n: Node) {
    if (buf.s.length >= MAX_OUTPUT_CHARS) return
    if (!n) return
    const anyN = n as any
    if (anyN.nodeType !== 1) return
    const ln = String(anyN.localName || '')

    if (ln === 't' || ln === 'text') {
      appendLimited(buf, String(anyN.textContent || ''))
      return
    }
    if (ln === 'br') {
      appendLimited(buf, '\n')
      return
    }
    if (ln === 'tab') {
      appendLimited(buf, ' ')
      return
    }

    const kids = Array.from(anyN.childNodes || []) as Node[]
    for (const k of kids) walk(k)
  }

  walk(el)
  return buf.s
}

function extractParagraphLines(txBody: Element) {
  const ps = Array.from((txBody as any).getElementsByTagNameNS?.('*', 'p') || []) as Element[]
  const lines: string[] = []

  for (const p of ps) {
    const pPr = childEls(p).find((x) => localName(x) === 'pPr') || null
    const lvl = clamp(Number(pPr?.getAttribute('lvl') || 0), 0, 10)
    const hasBu = !!pPr && childEls(pPr).some((x) => {
      const ln = localName(x)
      if (!ln) return false
      if (ln === 'buNone') return false
      return ln.startsWith('bu')
    })

    const raw = textFromInline(p)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \f\v]+/g, ' ')
      .replace(/[ \t]+$/g, '')

    const t = raw.trim()
    if (!t) continue

    if (hasBu) {
      const indent = '  '.repeat(lvl)
      lines.push(`${indent}- ${t}`)
    } else {
      lines.push(t)
    }

    if (lines.join('\n').length > MAX_OUTPUT_CHARS) break
  }

  return lines
}

function shapeToMarkdown(sp: Element) {
  const txBody = firstElNS(sp, 'txBody')
  if (!txBody) return ''

  const lines = extractParagraphLines(txBody)
  const text = lines.join('\n').trim()
  if (!text) return ''

  const ph = firstElNS(sp, 'ph')
  const phType = String(ph?.getAttribute('type') || '').trim()
  const isTitle = phType === 'title' || phType === 'ctrTitle'
  if (isTitle) {
    const one = text.split('\n').map((x) => x.trim()).filter(Boolean)[0] || ''
    return one ? `### ${one}` : ''
  }

  return text
}

type TableCell = { html: string; colSpan: number; rowSpan: number; skip: boolean }

function tcTextToHtml(tc: Element) {
  const txBody = firstElNS(tc, 'txBody')
  if (!txBody) return ''
  const raw = extractParagraphLines(txBody).join('\n').trim()
  return escapeHtml(raw).replaceAll('\n', '<br/>')
}

function parseGridSpan(tc: Element) {
  const tcPr = firstElNS(tc, 'tcPr')
  const n = Number(tcPr?.getAttribute('gridSpan') || 1)
  return clamp(n, 1, 100)
}

function parseVMerge(tc: Element) {
  const tcPr = firstElNS(tc, 'tcPr')
  if (!tcPr) return ''
  const vMerge = childEls(tcPr).find((x) => localName(x) === 'vMerge') || null
  if (!vMerge) return ''
  const v = String(vMerge.getAttribute('val') || '').trim()
  return v || 'cont'
}

function tableToHtml(tbl: Element) {
  const trs = childEls(tbl).filter((x) => localName(x) === 'tr')
  if (!trs.length) return ''

  const grid: TableCell[][] = []
  let maxCols = 0

  for (const tr of trs) {
    const tcs = childEls(tr).filter((x) => localName(x) === 'tc')
    const row: TableCell[] = []
    let col = 0

    for (const tc of tcs) {
      const colSpan = parseGridSpan(tc)
      const vMerge = parseVMerge(tc)
      const html = vMerge && vMerge !== 'restart' ? '' : tcTextToHtml(tc)

      while (row[col] && row[col].skip) col++
      row[col] = { html, colSpan, rowSpan: 1, skip: false }
      for (let k = 1; k < colSpan; k++) {
        row[col + k] = { html: '', colSpan: 1, rowSpan: 1, skip: true }
      }
      col += colSpan
    }

    maxCols = Math.max(maxCols, row.length)
    grid.push(row)
  }

  // 纵向合并：基于 vMerge(cont) 的粗略推断（连续空 html 的单元格视为延续）
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < maxCols; c++) {
      const cell = grid[r]?.[c]
      if (!cell || cell.skip) continue
      if (!cell.html) continue

      let span = 1
      for (let rr = r + 1; rr < grid.length; rr++) {
        const below = grid[rr]?.[c]
        if (!below || below.skip) break
        if (below.html !== '') break
        span++
        below.skip = true
      }
      cell.rowSpan = Math.max(1, span)
    }
  }

  const rowsHtml: string[] = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || []
    const tds: string[] = []
    for (let c = 0; c < maxCols; c++) {
      const cell = row[c]
      if (!cell || cell.skip) continue
      const attrs: string[] = []
      if (cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`)
      if (cell.rowSpan > 1) attrs.push(`rowspan="${cell.rowSpan}"`)
      const a = attrs.length ? ' ' + attrs.join(' ') : ''
      tds.push(`<td${a}>${cell.html || ''}</td>`)
    }
    if (tds.length) rowsHtml.push(`<tr>${tds.join('')}</tr>`)
  }

  if (!rowsHtml.length) return ''
  return `<table>${rowsHtml.join('')}</table>`
}

function graphicFrameToMarkdown(gf: Element) {
  const tbl = firstElNS(gf, 'tbl')
  if (tbl) {
    const html = tableToHtml(tbl)
    if (html) return html
  }
  const raw = textFromInline(gf).trim()
  return raw || ''
}

function walkSpTree(node: Element, blocks: string[]) {
  const kids = childEls(node)
  for (const el of kids) {
    const ln = localName(el)
    if (ln === 'sp') {
      const t = shapeToMarkdown(el)
      if (t) blocks.push(t)
      continue
    }
    if (ln === 'graphicFrame') {
      const t = graphicFrameToMarkdown(el)
      if (t) blocks.push(t)
      continue
    }
    if (ln === 'grpSp') {
      walkSpTree(el, blocks)
      continue
    }
  }
}

async function readZipText(zip: JSZip, path: string) {
  const f = zip.file(path)
  if (!f) return null
  const u8 = await f.async('uint8array')
  return new TextDecoder().decode(u8)
}

async function readZipXml(zip: JSZip, path: string) {
  const raw = await readZipText(zip, path)
  if (raw == null) return null
  return parseXml(raw)
}

type RelItem = { id: string; type: string; target: string; external: boolean }

async function readZipRels(zip: JSZip, relsPath: string) {
  const doc = await readZipXml(zip, relsPath)
  if (!doc) return new Map<string, RelItem>()
  const out = new Map<string, RelItem>()

  const rels = Array.from(doc.getElementsByTagName('Relationship') || []) as Element[]
  for (const r of rels) {
    const id = String(r.getAttribute('Id') || '').trim()
    const type = String(r.getAttribute('Type') || '').trim()
    const target0 = String(r.getAttribute('Target') || '').trim()
    const mode = String(r.getAttribute('TargetMode') || '').trim()
    if (!id || !target0) continue

    const external = mode.toLowerCase() === 'external'
    const target = external ? target0 : resolveZipTarget(relsPath, target0)
    out.set(id, { id, type, target, external })
  }

  return out
}

function listNumberedZipEntries(zip: JSZip, re: RegExp) {
  const out: { name: string; num: number }[] = []
  for (const name of Object.keys(zip.files || {})) {
    const m = re.exec(name)
    if (!m) continue
    const n = Number(m[1] || 0)
    if (!Number.isFinite(n) || n <= 0) continue
    out.push({ name, num: n })
  }
  out.sort((a, b) => a.num - b.num)
  return out
}

async function extractPptxMarkdown(ab: ArrayBuffer) {
  const zip = await JSZip.loadAsync(ab)
  const slides = listNumberedZipEntries(zip, /^ppt\/slides\/slide(\d+)\.xml$/)
  if (!slides.length) throw new Error('pptx 解析失败：未找到 slide XML')

  const parts: string[] = []
  for (const s of slides.slice(0, MAX_SLIDES)) {
    const slideDoc = await readZipXml(zip, s.name)
    if (!slideDoc) continue

    parts.push(`## Slide ${s.num}`)

    const spTree = firstElNS(slideDoc, 'spTree')
    if (spTree) {
      const blocks: string[] = []
      walkSpTree(spTree, blocks)
      const t = blocks.join('\n\n').trim()
      if (t) parts.push(t)
    }

    const relsPath = normalizeZipPath(s.name.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels')
    const rels = await readZipRels(zip, relsPath)
    const notesRel = Array.from(rels.values()).find((x) => /\/notesSlide$/.test(String(x.type || '')))
    if (notesRel && !notesRel.external && notesRel.target) {
      const notesDoc = await readZipXml(zip, notesRel.target)
      const notesTree = notesDoc ? firstElNS(notesDoc, 'spTree') : null
      if (notesTree) {
        const blocks: string[] = []
        walkSpTree(notesTree, blocks)
        const t = blocks.join('\n\n').trim()
        if (t) parts.push(`#### Notes\n\n${t}`)
      }
    }

    if (parts.join('\n\n').length > MAX_OUTPUT_CHARS) break
  }

  return parts.join('\n\n').trim()
}

function extractLegacyPptText(u8: Uint8Array) {
  const out: string[] = []
  const seen = new Set<string>()

  const minChars = 4
  const maxItems = 3000

  let i = 0
  while (i + 1 < u8.length) {
    const cu0 = u8[i] | (u8[i + 1] << 8)
    const isStart = cu0 !== 0 && cu0 !== 0xffff && cu0 !== 0xfffe
    if (!isStart) {
      i += 2
      continue
    }

    let j = i
    let s = ''
    while (j + 1 < u8.length) {
      const cu = u8[j] | (u8[j + 1] << 8)
      if (cu === 0) break
      if ((cu >= 0xd800 && cu <= 0xdfff) || (cu < 0x09 && cu !== 0x0a) || cu === 0x0b || cu === 0x0c) {
        s = ''
        break
      }
      s += String.fromCharCode(cu)
      if (s.length > 4000) break
      j += 2
    }

    if (s.length >= minChars) {
      const t = s.replace(/\s+/g, ' ').trim()
      const hasWord = /[0-9A-Za-z\u4e00-\u9fff]/.test(t)
      if (hasWord && t.length >= minChars && !seen.has(t)) {
        seen.add(t)
        out.push(t)
        if (out.length >= maxItems) break
        if (out.join('\n').length >= MAX_OUTPUT_CHARS) break
      }
    }

    i = j + 2
  }

  return out.join('\n').trim()
}

export async function extractPptMarkdown(file: File) {
  const buf = await file.arrayBuffer()
  const u8 = new Uint8Array(buf)
  if (isZip(u8)) return await extractPptxMarkdown(buf)
  return extractLegacyPptText(u8)
}

