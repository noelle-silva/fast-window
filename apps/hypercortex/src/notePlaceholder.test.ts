import { describe, expect, it } from 'vitest'
import { buildNotePlaceholderForCopy, parseNotePlaceholderBody } from './notePlaceholder'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 只喂文本、看解析/构造结果，锁定当前占位符语法的真实行为（含空值与怪癖）。
 */

describe('parseNotePlaceholderBody', () => {
  it('parses the minimum body with only a note id', () => {
    expect(parseNotePlaceholderBody('note_id=n1')).toEqual({ noteId: 'n1' })
  })

  it('parses face, title and remarks segments', () => {
    expect(parseNotePlaceholderBody('note_id=n1|face=f1|title=Hello|remarks=World')).toEqual({
      noteId: 'n1',
      face: 'f1',
      title: 'Hello',
      remarks: 'World',
    })
  })

  it('trims keys and note id / face values but keeps raw title and remarks', () => {
    expect(parseNotePlaceholderBody('  note_id = n1 | face = f1 | title=  spaced  | remarks= keep me ')).toEqual({
      noteId: 'n1',
      face: 'f1',
      title: '  spaced',
      remarks: ' keep me',
    })
  })

  it('returns null when the body is empty or whitespace', () => {
    expect(parseNotePlaceholderBody('')).toBeNull()
    expect(parseNotePlaceholderBody('   ')).toBeNull()
    expect(parseNotePlaceholderBody(null as unknown as string)).toBeNull()
    expect(parseNotePlaceholderBody(undefined as unknown as string)).toBeNull()
  })

  it('returns null when note_id is missing or blank', () => {
    expect(parseNotePlaceholderBody('face=f1|title=x')).toBeNull()
    expect(parseNotePlaceholderBody('note_id=')).toBeNull()
    expect(parseNotePlaceholderBody('note_id=   ')).toBeNull()
  })

  it('skips segments without an equals sign and unknown keys', () => {
    expect(parseNotePlaceholderBody('junk|foo=bar|note_id=n1|other')).toEqual({ noteId: 'n1' })
  })

  it('skips empty segments', () => {
    expect(parseNotePlaceholderBody('||note_id=n1||face=f1||')).toEqual({ noteId: 'n1', face: 'f1' })
  })

  it('keeps an explicitly empty title but drops an empty face', () => {
    expect(parseNotePlaceholderBody('note_id=n1|title=')).toEqual({ noteId: 'n1', title: '' })
    expect(parseNotePlaceholderBody('note_id=n1|face=')).toEqual({ noteId: 'n1' })
    expect(parseNotePlaceholderBody('note_id=n1|remarks=')).toEqual({ noteId: 'n1', remarks: '' })
  })

  it('lets later duplicate keys override earlier ones', () => {
    expect(parseNotePlaceholderBody('note_id=a|note_id=b|face=f1|face=f2')).toEqual({ noteId: 'b', face: 'f2' })
  })
})

describe('buildNotePlaceholderForCopy', () => {
  it('builds a placeholder with an empty title slot', () => {
    expect(buildNotePlaceholderForCopy('n1', 'My Note')).toBe('[[note_id=n1|title=|remarks=My Note]]')
  })

  it('adds the face segment when a face is provided', () => {
    expect(buildNotePlaceholderForCopy('n1', 'My Note', 'f1')).toBe('[[note_id=n1|face=f1|title=|remarks=My Note]]')
  })

  it('sanitizes newlines, pipes and closing brackets in the remarks', () => {
    expect(buildNotePlaceholderForCopy('n1', '  a|b]]\r\nc  ')).toBe('[[note_id=n1|title=|remarks=a｜b］］ c]]')
    expect(buildNotePlaceholderForCopy('n1', 'line1\nline2')).toBe('[[note_id=n1|title=|remarks=line1 line2]]')
  })

  it('trims the note id and ignores a blank face', () => {
    expect(buildNotePlaceholderForCopy('  n1  ', 'X', '   ')).toBe('[[note_id=n1|title=|remarks=X]]')
    expect(buildNotePlaceholderForCopy('', 'X')).toBe('[[note_id=|title=|remarks=X]]')
  })

  it('round-trips its inner body through parseNotePlaceholderBody', () => {
    const marker = buildNotePlaceholderForCopy('n1', 'Title|With]]Specials', 'f1')
    expect(marker).toBe('[[note_id=n1|face=f1|title=|remarks=Title｜With］］Specials]]')
    expect(parseNotePlaceholderBody(marker.slice(2, -2))).toEqual({
      noteId: 'n1',
      face: 'f1',
      title: '',
      remarks: 'Title｜With］］Specials',
    })
  })
})
