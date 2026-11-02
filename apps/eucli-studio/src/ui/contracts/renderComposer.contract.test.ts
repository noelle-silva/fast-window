import { describe, expect, it } from 'vitest'
import {
  collectFunctionDefinitions,
  formatLocations,
  loadContractSourceFiles,
} from '../../testing/sourceContractScan'

// `renderComposer` 不得复活。
//
// 110 的内核契约已经删除了 `renderComposer()` 这个“全局广播别名”。
// 迁移期它仍然可能作为依赖注入键出现（例如 `deps.renderComposer`、
// `renderComposer: renderAll`），那是历史调用方还没摘掉的键名，不是新的全局广播实现。
// 本测试只禁止“函数定义”复活（function 声明 / 箭头函数 / 方法），
// 不禁止属性名或依赖键，避免把迁移期的正常引用误判成违规。
//
// 终态（110-08）应把注入键也一并清掉，届时可以再收紧本契约。
const FORBIDDEN_FUNCTIONS = new Set(['renderComposer'])

describe('契约·renderComposer 不得复活', () => {
  const files = loadContractSourceFiles()
  const definitions = collectFunctionDefinitions(files, FORBIDDEN_FUNCTIONS)

  it('源码中不存在 renderComposer 函数定义', () => {
    const detail = definitions.length
      ? `\n违规定义：\n${formatLocations(definitions)}`
      : ''

    expect(
      definitions.length,
      'renderComposer 作为全局广播别名已被删除，禁止重新定义。\n' +
        '纯输入区变化请用 emitScope(refreshScopes.composer())；' +
        '混合变化请用 emitScopes([...])。' +
        detail,
    ).toBe(0)
  })
})
