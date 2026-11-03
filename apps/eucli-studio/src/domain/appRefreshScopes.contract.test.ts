import { readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  APP_ROOT_ENTITY_DOMAINS,
  APP_ROOT_EXCLUDED_ENTITY_DOMAINS,
  APP_ROOT_REFRESH_SCOPES,
} from './appRefreshScopes'
import { refreshScopes } from './uiRefreshScope'
import { loadContractSourceFiles } from '../testing/sourceContractScan'

// 契约·App 根刷新地址注册表。
//
// 背景：App 根曾手写 uiShell + 14 个 entities:* 的订阅数组。
// 新增实体域时只要漏一行，控制器照常发射、界面却静默不刷新。
// 这里把「根表面订阅什么」固定成注册表，并用控制器源码扫描做双向校验：
// - 发射了但未登记/未排除 → 失败（防漏订阅）；
// - 登记了但控制器从不发射 → 失败（防注册表腐化）。
//
// App.tsx 的 domainVersion 必须直接引用注册表常量，任何手写数组都会失败。

const APP_SOURCE = readFileSync(new URL('../ui/App.tsx', import.meta.url), 'utf8')
const APP_REFRESH_SCOPES_MODULE = '../domain/appRefreshScopes'
const APP_ROOT_SCOPES_NAME = 'APP_ROOT_REFRESH_SCOPES'
const ENTITY_SCOPE_PREFIX = 'entities:'

function appSourceFile(): ts.SourceFile {
  return ts.createSourceFile('App.tsx', APP_SOURCE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

// 控制器 / 动作里的实体域发射点：只扫描 src/controller，避免把 UI 消费点当成发射点。
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

function findDomainVersionArgument(sourceFile: ts.SourceFile): ts.Expression | null {
  let found: ts.Expression | null = null

  const visit = (node: ts.Node) => {
    if (found) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'domainVersion' &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'useScopedUiVersions'
    ) {
      found = node.initializer.arguments[1] ?? null
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function importsAppRootScopes(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)) return false
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== APP_REFRESH_SCOPES_MODULE) {
      return false
    }
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) return false
    return bindings.elements.some((element) => element.name.text === APP_ROOT_SCOPES_NAME)
  })
}

function scopeAddressOf(element: ts.Expression): string | null {
  if (!ts.isCallExpression(element)) return null
  const callee = element.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'refreshScopes') return null

  const method = callee.name.text
  if (method === 'uiShell' && element.arguments.length === 0) return refreshScopes.uiShell()
  if (method === 'entities') {
    const domain = element.arguments[0]
    if (domain && ts.isStringLiteral(domain)) return refreshScopes.entities(domain.text)
  }
  return null
}

// 从 App 根的实际订阅参数还原地址集合：
// - 引用注册表时，实际集合就是注册表本身；
// - 历史手写数组仍可解析，用来给出「数组与注册表不一致」的明确失败信息。
function actualRootScopeAddresses(argument: ts.Expression): readonly string[] | null {
  if (ts.isIdentifier(argument)) {
    return argument.text === APP_ROOT_SCOPES_NAME ? APP_ROOT_REFRESH_SCOPES : null
  }
  if (!ts.isArrayLiteralExpression(argument)) return null

  const addresses: string[] = []
  for (const element of argument.elements) {
    const address = scopeAddressOf(element)
    if (!address) return null
    addresses.push(address)
  }
  return addresses
}

describe('契约·App 根刷新地址注册表', () => {
  it('注册表地址 = uiShell + 登记的实体域，且不含 global', () => {
    const expected = [
      refreshScopes.uiShell(),
      ...APP_ROOT_ENTITY_DOMAINS.map((domain) => refreshScopes.entities(domain)),
    ]

    expect(APP_ROOT_REFRESH_SCOPES).toEqual(expected)
    expect(new Set(APP_ROOT_REFRESH_SCOPES).size, '注册表存在重复地址').toBe(APP_ROOT_REFRESH_SCOPES.length)
    expect(new Set(APP_ROOT_ENTITY_DOMAINS).size, '注册表存在重复实体域').toBe(APP_ROOT_ENTITY_DOMAINS.length)
    expect(APP_ROOT_REFRESH_SCOPES).not.toContain(refreshScopes.global())

    for (const scope of APP_ROOT_REFRESH_SCOPES) {
      expect(scope.trim(), '注册表含空地址').not.toBe('')
      expect(scope, '注册表含未归一的 global 地址').not.toBe(refreshScopes.global())
    }
  })

  it('排除清单必须写明实际消费者，且不能与登记者重叠', () => {
    for (const [domain, reason] of Object.entries(APP_ROOT_EXCLUDED_ENTITY_DOMAINS)) {
      expect(domain.startsWith(ENTITY_SCOPE_PREFIX), `排除项不能带地址前缀：${domain}`).toBe(false)
      expect(reason.trim(), `排除项 ${domain} 缺少理由`).not.toBe('')
    }

    const registered = new Set<string>(APP_ROOT_ENTITY_DOMAINS)
    const overlapped = Object.keys(APP_ROOT_EXCLUDED_ENTITY_DOMAINS)
      .filter((domain) => registered.has(domain))
      .sort()
    expect(overlapped, '同一实体域不能既登记又排除').toEqual([])
  })

  it('控制器发射的实体域必须登记为根域或被显式排除', () => {
    const emitted = emittedEntityDomains()
    const registered = new Set<string>(APP_ROOT_ENTITY_DOMAINS)
    const excluded = new Set(Object.keys(APP_ROOT_EXCLUDED_ENTITY_DOMAINS))
    const unclassified = [...emitted]
      .filter((domain) => !registered.has(domain) && !excluded.has(domain))
      .sort()

    expect(
      unclassified,
      `发现未登记根订阅的实体刷新域：${unclassified.join(', ') || '(无)'}。\n` +
        '新增实体域时，请把它加入 APP_ROOT_ENTITY_DOMAINS；' +
        '如果它由更窄的 hook / 面板自订阅，请加入 APP_ROOT_EXCLUDED_ENTITY_DOMAINS 并写明消费者。',
    ).toEqual([])
  })

  it('注册表登记的实体域都必须有控制器发射点，排除项也不得过期', () => {
    const emitted = emittedEntityDomains()
    const unemitted = [...APP_ROOT_ENTITY_DOMAINS].filter((domain) => !emitted.has(domain)).sort()
    const staleExclusions = Object.keys(APP_ROOT_EXCLUDED_ENTITY_DOMAINS)
      .filter((domain) => !emitted.has(domain))
      .sort()

    expect(unemitted, '注册表登记了控制器不会发射的实体域，请删除或修正').toEqual([])
    expect(staleExclusions, '排除清单里的实体域已无发射点，请删除过期条目').toEqual([])
  })

  it('App 根 domainVersion 只引用注册表，不再手写实体订阅数组', () => {
    const sourceFile = appSourceFile()
    expect(importsAppRootScopes(sourceFile), `App.tsx 必须从 ${APP_REFRESH_SCOPES_MODULE} 导入 ${APP_ROOT_SCOPES_NAME}`).toBe(
      true,
    )

    const argument = findDomainVersionArgument(sourceFile)
    expect(argument, 'App.tsx 找不到 domainVersion 的 useScopedUiVersions 订阅参数').not.toBeNull()
    expect(
      argument !== null && ts.isIdentifier(argument) && argument.text === APP_ROOT_SCOPES_NAME,
      'App 根 domainVersion 必须直接使用注册表常量；手写数组会再次造成漏订阅',
    ).toBe(true)
    expect(APP_SOURCE, 'App.tsx 不应再出现手写的实体域订阅').not.toContain('refreshScopes.entities(')
  })

  it('注册表与当前 App 根实际订阅集合一致', () => {
    const argument = findDomainVersionArgument(appSourceFile())
    expect(argument, 'App.tsx 找不到 domainVersion 的 useScopedUiVersions 订阅参数').not.toBeNull()

    const actual = argument ? actualRootScopeAddresses(argument) : null
    expect(
      actual,
      'App 根 domainVersion 的订阅参数无法识别；只能引用 APP_ROOT_REFRESH_SCOPES 或由 refreshScopes 构造的地址数组',
    ).not.toBeNull()

    expect([...(actual || [])].sort(), 'App 根实际订阅集合与注册表不一致').toEqual(
      [...APP_ROOT_REFRESH_SCOPES].sort(),
    )
  })
})
