import { describe, expect, it } from 'vitest'
import { SETTINGS_NAVIGATION_VALUES } from './settingsNavigation'
import {
  SETTINGS_PAGE_CHROME_REFRESH_SCOPES,
  SETTINGS_PAGE_REFRESH_SCOPES,
  SETTINGS_PANEL_REFRESH_SCOPES,
  settingsPanelRefreshScopes,
} from './settingsRefreshScopes'
import { loadContractSourceFiles } from '../testing/sourceContractScan'

// 控制器可以发射的实体域不一定都属于设置页（例如收藏夹）。
// 新增域必须先在这里显式分类：要么进 SETTINGS_PANEL_REFRESH_SCOPES，
// 要么明确声明它不是设置页数据。禁止靠“没人订阅”静默漏刷。
const NON_SETTINGS_ENTITY_DOMAINS = new Set(['favorites', 'desks'])

function registeredEntityDomains(): Set<string> {
  const domains = new Set<string>()
  for (const scopes of Object.values(SETTINGS_PANEL_REFRESH_SCOPES)) {
    for (const scope of scopes) {
      if (!scope.startsWith('entities:')) continue
      domains.add(scope.slice('entities:'.length))
    }
  }
  return domains
}

function emittedEntityDomains(): Set<string> {
  const domains = new Set<string>()
  const files = loadContractSourceFiles().filter((file) => file.relPath.startsWith('src/controller/'))

  for (const file of files) {
    for (const match of file.text.matchAll(/refreshScopes\.entities\(\s*'([^']+)'\s*\)/g)) {
      domains.add(match[1])
    }
    for (const match of file.text.matchAll(/emitEntity\(\s*'([^']+)'\s*\)/g)) {
      domains.add(match[1])
    }
  }

  return domains
}

describe('契约·设置页刷新地址注册表', () => {
  it('每个设置分类都必须登记刷新地址', () => {
    expect(Object.keys(SETTINGS_PANEL_REFRESH_SCOPES).sort()).toEqual([...SETTINGS_NAVIGATION_VALUES].sort())
  })

  it('分类内地址不重复，且都来自统一地址构造器', () => {
    for (const [tab, scopes] of Object.entries(SETTINGS_PANEL_REFRESH_SCOPES)) {
      expect(new Set(scopes).size, `${tab} 存在重复刷新地址`).toBe(scopes.length)
      for (const scope of scopes) {
        expect(scope.trim(), `${tab} 含空地址`).not.toBe('')
        expect(scope, `${tab} 含未归一的 global 地址`).not.toBe('global')
      }
    }
  })

  it('设置页并集覆盖全部面板地址与壳层地址，且无重复', () => {
    const union = new Set(SETTINGS_PAGE_REFRESH_SCOPES)
    expect(union.size).toBe(SETTINGS_PAGE_REFRESH_SCOPES.length)
    for (const scope of SETTINGS_PAGE_CHROME_REFRESH_SCOPES) expect(union.has(scope)).toBe(true)
    for (const scopes of Object.values(SETTINGS_PANEL_REFRESH_SCOPES)) {
      for (const scope of scopes) expect(union.has(scope)).toBe(true)
    }
  })

  it('settingsPanelRefreshScopes 返回与注册表一致的地址', () => {
    for (const tab of SETTINGS_NAVIGATION_VALUES) {
      expect(settingsPanelRefreshScopes(tab)).toBe(SETTINGS_PANEL_REFRESH_SCOPES[tab])
    }
  })

  it('控制器发射的实体域必须登记为设置域或被显式排除', () => {
    const registered = registeredEntityDomains()
    const unclassified = [...emittedEntityDomains()]
      .filter((domain) => !registered.has(domain))
      .filter((domain) => !NON_SETTINGS_ENTITY_DOMAINS.has(domain))
      .sort()

    expect(
      unclassified,
      `发现未归属设置页的实体刷新域：${unclassified.join(', ') || '(无)'}。\n` +
        '新增实体域时，请把它加入 settingsRefreshScopes 中读取它的面板；' +
        '如果它确实不属于设置页，请加入 NON_SETTINGS_ENTITY_DOMAINS 并说明原因。',
    ).toEqual([])
  })
})
