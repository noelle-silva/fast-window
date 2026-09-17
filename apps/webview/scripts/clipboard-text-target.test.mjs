import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { parseClipboardTextTarget } from '../src/collections/clipboardTextTarget.ts'
import { deriveNameFromTarget } from '../src/collections/targetNaming.ts'

describe('clipboard text target parsing', () => {
  it('accepts explicit http and https urls only', () => {
    assert.deepEqual(parseClipboardTextTarget('https://www.example.com/docs?q=1'), {
      kind: 'url',
      target: 'https://www.example.com/docs?q=1',
      name: 'example.com',
    })

    assert.equal(parseClipboardTextTarget('example.com'), null)
    assert.equal(parseClipboardTextTarget('ftp://example.com'), null)
  })

  it('rejects local paths because only url collections are supported', () => {
    assert.equal(parseClipboardTextTarget('"C:\\Users\\eucli\\Desktop\\note.txt"'), null)
    assert.equal(parseClipboardTextTarget('\\\\server\\share\\folder'), null)
    assert.equal(parseClipboardTextTarget('relative\\file.txt'), null)
  })

  it('rejects multi-line clipboard text as ambiguous', () => {
    assert.equal(parseClipboardTextTarget('https://example.com\nhttps://example.org'), null)
  })
})

describe('target naming', () => {
  it('uses normalized host names for http urls', () => {
    assert.equal(deriveNameFromTarget('https://www.example.com/docs'), 'example.com')
  })

  it('does not derive names from local paths', () => {
    assert.equal(deriveNameFromTarget('C:\\Users\\eucli\\Desktop\\note.txt'), '')
    assert.equal(deriveNameFromTarget('relative\\file.txt'), '')
  })
})
