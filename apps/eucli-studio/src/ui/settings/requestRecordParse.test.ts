import { describe, expect, it } from 'vitest'
import { parseRequestPayloadText, parseResponseStreamText } from './requestRecordParse'

describe('parseRequestPayloadText', () => {
  it('parses an openai style request payload', () => {
    const text = JSON.stringify({
      model: 'deepseek-v4.1-flash',
      stream: true,
      reasoning_effort: 'xhigh',
      messages: [
        { role: 'system', content: '你是 nova' },
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '', reasoning_content: '先想一下', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'shell_command', arguments: '{"command":"pwd"}' } }] },
        { role: 'tool', tool_call_id: 'call-1', name: 'shell_command', content: 'ok' },
      ],
      tools: [{ type: 'function', function: { name: 'shell_command', description: 'run shell', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }],
    })
    const view = parseRequestPayloadText(text)
    expect(view).not.toBeNull()
    expect(view?.params).toEqual([
      { key: 'model', value: 'deepseek-v4.1-flash' },
      { key: 'stream', value: 'true' },
      { key: 'reasoning_effort', value: 'xhigh' },
    ])
    expect(view?.messages).toHaveLength(4)
    expect(view?.messages[0].role).toBe('system')
    expect(view?.messages[1].content).toBe('你好')
    expect(view?.messages[2].reasoning).toBe('先想一下')
    expect(view?.messages[2].toolCalls).toEqual([{ name: 'shell_command', arguments: '{"command":"pwd"}' }])
    expect(view?.messages[3].toolCallId).toBe('call-1')
    expect(view?.messages[3].name).toBe('shell_command')
    expect(view?.tools).toHaveLength(1)
    expect(view?.tools[0].name).toBe('shell_command')
    expect(view?.tools[0].description).toBe('run shell')
    expect(view?.tools[0].parameters).toContain('"command"')
  })

  it('returns null when messages are absent', () => {
    expect(parseRequestPayloadText('{"model":"x"}')).toBeNull()
    expect(parseRequestPayloadText('not json')).toBeNull()
    expect(parseRequestPayloadText('[1,2]')).toBeNull()
  })

  it('describes multimodal content parts', () => {
    const text = JSON.stringify({
      messages: [{ role: 'user', content: [{ type: 'text', text: '看看这张图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } }] }],
    })
    const view = parseRequestPayloadText(text)
    expect(view?.messages[0].content).toBe('看看这张图\n[图片]')
  })
})

describe('parseResponseStreamText', () => {
  it('merges sse deltas into a round timeline', () => {
    const lines = [
      'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"一下"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{"content":"呀"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"shell_command","arguments":"{\\"comm"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"and\\":\\"pwd\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"total_tokens":42}}',
      'data: [DONE]',
    ].join('\n')
    const view = parseResponseStreamText(lines)
    expect(view).not.toBeNull()
    expect(view?.done).toBe(true)
    expect(view?.segments).toEqual([
      { kind: 'reasoning', text: '先想一下' },
      { kind: 'content', text: '你好呀' },
      { kind: 'toolCall', name: 'shell_command', arguments: '{"command":"pwd"}' },
      { kind: 'finish', text: '结束原因：tool_calls；用量：{"total_tokens":42}' },
    ])
  })

  it('keeps interleaved text segments separated', () => {
    const lines = [
      'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}',
      'data: {"choices":[{"delta":{"content":"说"}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"再想"}}]}',
    ].join('\n')
    const view = parseResponseStreamText(lines)
    expect(view?.segments).toEqual([
      { kind: 'reasoning', text: '想' },
      { kind: 'content', text: '说' },
      { kind: 'reasoning', text: '再想' },
    ])
  })

  it('merges reasoning deltas from alternate channel fields', () => {
    const lines = [
      'data: {"choices":[{"delta":{"reasoning":"想","reasoning_details":[{"type":"reasoning.text","text":"想","format":"unknown","index":0}]}}]}',
      'data: {"choices":[{"delta":{"reasoning":"一下"}}]}',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
    ].join('\n')
    const view = parseResponseStreamText(lines)
    expect(view?.segments).toEqual([
      { kind: 'reasoning', text: '想一下' },
      { kind: 'content', text: '好' },
    ])
  })

  it('falls back to reasoning_details text and reasoning object text', () => {
    const detailOnly = parseResponseStreamText('data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"细节"}]}}]}')
    expect(detailOnly?.segments).toEqual([{ kind: 'reasoning', text: '细节' }])
    const objectOnly = parseResponseStreamText('data: {"choices":[{"delta":{"reasoning":{"text":"对象"}}}]}')
    expect(objectOnly?.segments).toEqual([{ kind: 'reasoning', text: '对象' }])
  })

  it('collects unknown events into other segments', () => {
    const lines = [
      'event: ping',
      'data: {"type":"unknown_event","value":1}',
      'data: not-json',
    ].join('\n')
    const view = parseResponseStreamText(lines)
    expect(view?.segments).toEqual([
      { kind: 'other', text: '{"type":"unknown_event","value":1}' },
      { kind: 'other', text: 'not-json' },
    ])
  })

  it('returns null for non sse text', () => {
    expect(parseResponseStreamText('plain text')).toBeNull()
    expect(parseResponseStreamText('')).toBeNull()
    expect(parseResponseStreamText('{"data":[]}')).toBeNull()
  })
})
