import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 弹层地址契约：每个弹层只订阅自己的数据源，且不再回退到全局版本。
// 源文件断言与 App 的地址目录保持一致，防止后续新增弹层重新引入全局兜底。
const OVERLAY_DIR = new URL('./', import.meta.url)
const COMPOSER_DIR = new URL('../composer/', import.meta.url)

function source(base: URL, name: string) {
  return readFileSync(new URL(name, base), 'utf8')
}

const CASES = [
  {
    file: 'ComposerControlsPopovers.tsx',
    source: () => source(COMPOSER_DIR, 'ComposerControlsPopovers.tsx'),
    scopes: ["refreshScopes.composer()", "refreshScopes.entities('providers')", "refreshScopes.entities('modelGroups')"],
  },
  {
    file: 'ComposerImagePickerPopover.tsx',
    source: () => source(COMPOSER_DIR, 'ComposerImagePickerPopover.tsx'),
    scopes: ['refreshScopes.composer()'],
  },
  {
    file: 'ChatPickerPopover.tsx',
    source: () => source(OVERLAY_DIR, 'ChatPickerPopover.tsx'),
    scopes: [
      'refreshScopes.chatList(activeTargetKind, chatListTargetId)',
      'refreshScopes.entities(entityDomain)',
      "refreshScopes.entities('favorites')",
    ],
  },
  {
    file: 'ChatContextMenus.tsx',
    source: () => source(OVERLAY_DIR, 'ChatContextMenus.tsx'),
    scopes: ['refreshScopes.uiShell()'],
  },
  {
    file: 'ChatSessionDialogs.tsx',
    source: () => source(OVERLAY_DIR, 'ChatSessionDialogs.tsx'),
    scopes: [
      'refreshScopes.chatList(operationTarget.targetKind, operationTarget.targetId)',
      'refreshScopes.runCards()',
    ],
  },
  {
    file: 'MessageMenusDialogs.tsx',
    source: () => source(OVERLAY_DIR, 'MessageMenusDialogs.tsx'),
    scopes: ['messageRefreshScope(openMid)', 'refreshScopes.runCards()'],
  },
  {
    file: 'RolePickerPopover.tsx',
    source: () => source(OVERLAY_DIR, 'RolePickerPopover.tsx'),
    scopes: [
      "refreshScopes.entities('roles')",
      "refreshScopes.entities('workspaces')",
      "refreshScopes.entities('providers')",
      "refreshScopes.entities('modelGroups')",
    ],
  },
] as const

describe('弹层范围订阅契约', () => {
  for (const item of CASES) {
    it(`${item.file} 只订阅自己的数据地址`, () => {
      const text = item.source()
      expect(text).not.toContain('useUiDataVersion')
      expect(text).not.toContain('useAiChatState')
      for (const scope of item.scopes) {
        expect(text, `${item.file} 缺少 ${scope}`).toContain(scope)
      }
    })
  }
})
