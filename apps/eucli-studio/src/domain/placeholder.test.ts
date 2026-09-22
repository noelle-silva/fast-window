import { describe, expect, it } from 'vitest'
import { placeholderNamesInText } from './placeholder'

describe('placeholderNamesInText', () => {
  it('按出现顺序提取占位符名并去空格', () => {
    expect(placeholderNamesInText('开头 {{ a }} 中间 {{b}} 结尾')).toEqual(['a', 'b'])
  })

  it('同名占位符只保留一次', () => {
    expect(placeholderNamesInText('{{a}} {{a}} {{b}} {{a}}')).toEqual(['a', 'b'])
  })

  it('空名与不成对的括号不产生占位符', () => {
    expect(placeholderNamesInText('{{}} {{   }} {{a} {b}} {{{c}}}')).toEqual(['c'])
  })

  it('非字符串输入返回空数组', () => {
    expect(placeholderNamesInText(null)).toEqual([])
    expect(placeholderNamesInText(undefined)).toEqual([])
    expect(placeholderNamesInText(123)).toEqual([])
  })
})
