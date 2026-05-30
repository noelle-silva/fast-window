import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { parseClipboardTextTarget, resolvedClipboardTargetFromPathInspection } from '../src/clipboardTextTarget.ts'
import { deriveNameFromTarget } from '../src/targetNaming.ts'

describe('clipboard text target parsing', () => {
  it('accepts explicit http and https urls only', () => {
    assert.deepEqual(parseClipboardTextTarget('https://www.example.com/docs?q=1'), {
      kind: 'url',
      categoryId: 'url',
      target: 'https://www.example.com/docs?q=1',
      name: 'example.com',
    })

    assert.equal(parseClipboardTextTarget('example.com'), null)
    assert.equal(parseClipboardTextTarget('ftp://example.com'), null)
  })

  it('accepts a single absolute path candidate before native inspection', () => {
    assert.deepEqual(parseClipboardTextTarget('"C:\\Users\\eucli\\Desktop\\note.txt"'), {
      kind: 'path',
      target: 'C:\\Users\\eucli\\Desktop\\note.txt',
    })

    assert.deepEqual(parseClipboardTextTarget('\\\\server\\share\\folder'), {
      kind: 'path',
      target: '\\\\server\\share\\folder',
    })

    assert.equal(parseClipboardTextTarget('relative\\file.txt'), null)
  })

  it('rejects multi-line clipboard text as ambiguous', () => {
    assert.equal(parseClipboardTextTarget('https://example.com\nhttps://example.org'), null)
  })

  it('resolves inspected paths to matching categories and names', () => {
    assert.deepEqual(resolvedClipboardTargetFromPathInspection({ kind: 'folder', path: 'C:\\Users\\eucli\\Desktop', name: 'Desktop' }), {
      categoryId: 'folder',
      target: 'C:\\Users\\eucli\\Desktop',
      name: 'Desktop',
    })

    assert.deepEqual(resolvedClipboardTargetFromPathInspection({ kind: 'file', path: 'C:\\Users\\eucli\\Desktop\\note.txt', name: 'note.txt' }), {
      categoryId: 'file',
      target: 'C:\\Users\\eucli\\Desktop\\note.txt',
      name: 'note.txt',
    })
  })
})

describe('target naming', () => {
  it('uses normalized host names for http urls', () => {
    assert.equal(deriveNameFromTarget('https://www.example.com/docs'), 'example.com')
  })

  it('uses the final segment for paths', () => {
    assert.equal(deriveNameFromTarget('C:\\Users\\eucli\\Desktop\\note.txt'), 'note.txt')
  })
})
