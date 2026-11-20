// @vitest-environment happy-dom
//
// 注册模型的默认思考下拉回归：
// 下拉必须渲染业务端清单里的全部档位，不能只剩已保存的那一个。
// 一旦面板拿不到 providerCapabilities，清单为空，下拉会退化成单个已保存值——
// 现象就是"选过一次之后其他档位全都不见了"。
//
// MUI 的 Select 在 happy-dom 下不落到原生 <select>，因此这里分两层断言：
//   1. 纯函数层：给定清单时选项完整，给空清单时只剩已保存值（这正是缺参时的现象）；
//   2. 源码层：编辑器与弹窗都把清单接到了下拉渲染处，没有中途断链。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCapabilitySelection } from '../../domain/providerCapabilities'

const SOURCE_ROOT = path.resolve(__dirname, '..')

function readSource(relative: string) {
  return fs.readFileSync(path.join(SOURCE_ROOT, relative), 'utf-8')
}

const REASONING_OPTIONS = [
  { value: 'auto', label: 'Auto', description: '' },
  { value: 'low', label: 'Low', description: '' },
  { value: 'medium', label: 'Medium', description: '' },
  { value: 'high', label: 'High', description: '' },
  { value: 'xhigh', label: 'X High', description: '' },
  { value: 'max', label: 'Max', description: '' },
]

describe('下拉选中项解析', () => {
  it('清单存在时保留全部档位', () => {
    const selection = resolveCapabilitySelection(REASONING_OPTIONS, 'high')
    expect(selection.value).toBe('high')
    expect(selection.options.map((option) => option.value)).toEqual([
      'auto',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('清单为空时只剩已保存值，这正是缺清单时的现象', () => {
    const selection = resolveCapabilitySelection([], 'high')
    expect(selection.value).toBe('high')
    expect(selection.options.map((option) => option.value)).toEqual(['high'])
  })

  it('已保存的档位不在清单里时原样保留，其余档位仍在', () => {
    const selection = resolveCapabilitySelection(REASONING_OPTIONS, 'brand_new_level')
    expect(selection.value).toBe('brand_new_level')
    expect(selection.options.map((option) => option.value)).toEqual([
      'auto',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'brand_new_level',
    ])
  })
})

describe('清单透传链路', () => {
  it('编辑器把清单接到默认思考下拉上', () => {
    const source = readSource('components/ProviderConfigEditor.tsx')
    expect(source, '编辑器未声明 providerCapabilities').toContain('providerCapabilities')
    expect(source, '下拉未遍历业务端清单').toContain('resolveCapabilitySelection(reasoningEffortOptions')
  })

  it('供应商面板把清单透传给编辑器', () => {
    const source = readSource('settings/ProvidersSettingsPanel.tsx')
    expect(source).toContain('providerCapabilities')
    expect(source, '面板未把清单传给编辑器').toMatch(/ProviderConfigEditor[^>]*providerCapabilities/)
  })

  it('设置页把清单传给供应商面板', () => {
    const source = readSource('settings/PluginSettingsPage.tsx')
    expect(source, '设置页未把清单传给面板').toMatch(/ProvidersSettingsPanel[^>]*providerCapabilities/)
  })

  it('供应商弹窗也必须拿到清单，否则弹窗里的下拉会只剩已保存值', () => {
    const dialog = readSource('dialogs/ProvidersDialog.tsx')
    expect(dialog, '弹窗未声明 providerCapabilities').toContain('providerCapabilities')
    expect(dialog, '弹窗未把清单传给面板').toMatch(/ProvidersSettingsPanel[^>]*providerCapabilities/)

    const app = readSource('App.tsx')
    expect(app, 'App 打开弹窗时未传入清单').toMatch(/ProvidersDialog[^>]*providerCapabilities/)
  })
})
