import { classifyLines, lineTypeToClassName } from './lineClassifier'

export function extractText(root: HTMLDivElement): string {
  const lines = Array.from(root.children, (el) => el.textContent ?? '')
  return lines.join('\n')
}

export function rebuildDOM(root: HTMLDivElement, text: string): void {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const types = classifyLines(lines)

  const frag = document.createDocumentFragment()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const div = document.createElement('div')
    div.className = 'hc-line ' + lineTypeToClassName(types[i])
    if (line === '') {
      div.appendChild(document.createElement('br'))
    } else {
      div.textContent = line
    }
    frag.appendChild(div)
  }

  root.replaceChildren(frag)
}

export function reclassifyLines(root: HTMLDivElement): void {
  const els = Array.from(root.children) as HTMLElement[]
  const lines = els.map((el) => el.textContent ?? '')
  const types = classifyLines(lines)

  for (let i = 0; i < els.length; i++) {
    const next = 'hc-line ' + lineTypeToClassName(types[i])
    if (els[i].className !== next) els[i].className = next
  }
}

export function normalizeEditorDOM(root: HTMLDivElement): boolean {
  const paragraphClass = 'hc-line ' + lineTypeToClassName('paragraph')
  let changed = false

  const nodes = Array.from(root.childNodes)
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const div = document.createElement('div')
      div.className = paragraphClass
      root.insertBefore(div, node)
      div.appendChild(node)
      if ((div.textContent ?? '') === '') {
        div.textContent = ''
        div.appendChild(document.createElement('br'))
      }
      changed = true
      continue
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.tagName === 'DIV') continue

      const div = document.createElement('div')
      div.className = paragraphClass

      if (el.tagName === 'BR') {
        div.appendChild(document.createElement('br'))
      } else {
        while (el.firstChild) div.appendChild(el.firstChild)
        if (div.childNodes.length === 0) div.appendChild(document.createElement('br'))
      }

      root.replaceChild(div, el)
      changed = true
      continue
    }

    root.removeChild(node)
    changed = true
  }

  if (changed) reclassifyLines(root)
  return changed
}

export function domSelectionToTextOffset(
  root: HTMLDivElement,
): { start: number; end: number } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 }

  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return { start: 0, end: 0 }
  }

  const lines = Array.from(root.children) as HTMLElement[]
  const lengths = lines.map((el) => (el.textContent ?? '').length)
  const starts = buildLineStarts(lengths)
  const total = textTotalLength(lengths)

  const start = clamp(
    boundaryToOffset(root, lines, starts, total, range.startContainer, range.startOffset),
    0,
    total,
  )
  const end = clamp(
    boundaryToOffset(root, lines, starts, total, range.endContainer, range.endOffset),
    0,
    total,
  )

  return { start, end }
}

export function restoreSelectionFromTextOffset(
  root: HTMLDivElement,
  start: number,
  end: number,
): void {
  const sel = window.getSelection()
  if (!sel) return

  const lines = Array.from(root.children) as HTMLElement[]
  if (lines.length === 0) return

  const lengths = lines.map((el) => (el.textContent ?? '').length)
  const total = textTotalLength(lengths)
  const clampedStart = clamp(start, 0, total)
  const clampedEnd = clamp(end, 0, total)

  const a = locateTextOffset(lengths, clampedStart)
  const b = locateTextOffset(lengths, clampedEnd)

  const aPos = resolveDOMPosition(lines[a.lineIndex], a.inLineOffset)
  const bPos = resolveDOMPosition(lines[b.lineIndex], b.inLineOffset)

  const range = document.createRange()
  range.setStart(aPos.node, aPos.offset)
  range.setEnd(bPos.node, bPos.offset)

  sel.removeAllRanges()
  sel.addRange(range)
}

function buildLineStarts(lengths: number[]): number[] {
  const starts = new Array<number>(lengths.length)
  let acc = 0
  for (let i = 0; i < lengths.length; i++) {
    starts[i] = acc
    acc += lengths[i] + (i === lengths.length - 1 ? 0 : 1)
  }
  return starts
}

function textTotalLength(lengths: number[]): number {
  let total = 0
  for (let i = 0; i < lengths.length; i++) total += lengths[i]
  if (lengths.length >= 2) total += lengths.length - 1
  return total
}

function boundaryToOffset(
  root: HTMLDivElement,
  lines: HTMLElement[],
  starts: number[],
  total: number,
  container: Node,
  offset: number,
): number {
  if (container === root) {
    const idx = clamp(offset, 0, lines.length)
    return idx < lines.length ? starts[idx] : total
  }

  const lineEl = findDirectLine(root, container)
  if (!lineEl) return 0

  const lineIndex = indexOfElement(lines, lineEl)
  if (lineIndex === -1) return 0

  const inLine = textOffsetWithinLine(lineEl, container, offset)
  return starts[lineIndex] + inLine
}

function findDirectLine(root: HTMLDivElement, node: Node): HTMLElement | null {
  if (!root.contains(node)) return null
  let cur: Node | null = node
  while (cur && cur !== root) {
    if (cur.parentNode === root && cur.nodeType === Node.ELEMENT_NODE) return cur as HTMLElement
    cur = cur.parentNode
  }
  return null
}

function indexOfElement(list: readonly HTMLElement[], el: HTMLElement): number {
  for (let i = 0; i < list.length; i++) if (list[i] === el) return i
  return -1
}

function textOffsetWithinLine(lineEl: HTMLElement, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const text = container as Text
    return clamp(offset, 0, text.data.length)
  }

  const inside = textLengthOfChildNodes(container, offset)
  let acc = 0

  let cur: Node | null = container
  while (cur && cur !== lineEl) {
    const parent = cur.parentNode
    if (!parent) break
    const idx = indexInParent(parent, cur)
    if (idx !== -1) acc += textLengthOfChildNodes(parent, idx)
    cur = parent
  }

  return acc + inside
}

function textLengthOfChildNodes(container: Node, upToChildIndex: number): number {
  if (container.nodeType === Node.TEXT_NODE) return 0
  const el = container as ParentNode
  const nodes = el.childNodes
  const end = clamp(upToChildIndex, 0, nodes.length)
  let acc = 0
  for (let i = 0; i < end; i++) acc += textLengthOfNode(nodes[i])
  return acc
}

function textLengthOfNode(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').length
  if (node.nodeType !== Node.ELEMENT_NODE) return 0
  const el = node as HTMLElement
  if (el.tagName === 'BR') return 0
  let acc = 0
  for (const child of Array.from(el.childNodes)) acc += textLengthOfNode(child)
  return acc
}

function indexInParent(parent: Node, child: Node): number {
  const nodes = parent.childNodes
  for (let i = 0; i < nodes.length; i++) if (nodes[i] === child) return i
  return -1
}

function locateTextOffset(
  lengths: number[],
  pos: number,
): { lineIndex: number; inLineOffset: number } {
  let remaining = pos
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]
    if (remaining <= len) return { lineIndex: i, inLineOffset: remaining }
    remaining -= len

    if (i === lengths.length - 1) return { lineIndex: i, inLineOffset: len }
    if (remaining === 0) return { lineIndex: i, inLineOffset: len }
    remaining -= 1
    if (remaining === 0) return { lineIndex: i + 1, inLineOffset: 0 }
  }

  const last = lengths.length - 1
  return { lineIndex: last, inLineOffset: lengths[last] }
}

function resolveDOMPosition(
  lineEl: HTMLElement,
  inLineOffset: number,
): { node: Node; offset: number } {
  const lineTextLength = (lineEl.textContent ?? '').length
  const target = clamp(inLineOffset, 0, lineTextLength)

  if (target === 0 && lineTextLength === 0) return { node: lineEl, offset: 0 }

  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  let remaining = target
  let lastText: Text | null = null

  while (node) {
    lastText = node
    const len = node.data.length
    if (remaining <= len) return { node, offset: remaining }
    remaining -= len
    node = walker.nextNode() as Text | null
  }

  if (lastText) return { node: lastText, offset: lastText.data.length }
  return { node: lineEl, offset: lineEl.childNodes.length }
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min
  if (v > max) return max
  return v
}

