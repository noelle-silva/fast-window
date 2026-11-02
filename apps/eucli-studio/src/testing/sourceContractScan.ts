// 契约测试共用的源码扫描器。
//
// 目的：给「禁止某某写法继续扩散」这类 ratchet 测试提供稳定的 AST 级扫描，
// 而不是用正则去猜注释、字符串或相似标识符。扫描结果统一携带
// 相对路径 + 行号 + 列号 + 该行源码，失败信息可以直接定位到违规点。
//
// 注意：本文件只被测试引用，不参与运行时。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_SOURCE_ROOT = join(APP_ROOT, 'src')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

export type ContractSourceFile = {
  /** 相对 apps/eucli-studio 的路径，使用 / 分隔，便于跨平台断言。 */
  relPath: string
  text: string
}

export type ContractSourceLocation = {
  relPath: string
  /** 1 起始。 */
  line: number
  /** 1 起始。 */
  column: number
  /** 命中节点所在行的源码（已 trim）。 */
  snippet: string
}

export type CallMatch = {
  /** 标识符调用或属性访问调用的方法名。 */
  name: string
  /** 属性访问调用的接收者源码文本；标识符调用为 undefined。 */
  receiverText?: string
  argumentCount: number
  file: ContractSourceFile
}

export type SourceScanOptions = {
  /** 默认 apps/eucli-studio/src。 */
  root?: string
  /** 默认 false：测试文件与 src/testing 辅助区不进入生产契约扫描。 */
  includeTests?: boolean
}

function toPosix(path: string) {
  return path.split('\\').join('/')
}

function isTestFile(relPath: string) {
  return /\.test\.(ts|tsx)$/.test(relPath) || relPath.startsWith('src/testing/')
}

function walk(dir: string, files: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
      continue
    }
    if (!SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) continue
    files.push(fullPath)
  }
}

/** 读取契约扫描范围内的源码文件，按 relPath 排序保证测试输出稳定。 */
export function loadContractSourceFiles(options: SourceScanOptions = {}): ContractSourceFile[] {
  const root = options.root || DEFAULT_SOURCE_ROOT
  const files: string[] = []
  walk(root, files)

  return files
    .map((fullPath) => ({
      relPath: toPosix(relative(APP_ROOT, fullPath)),
      text: readFileSync(fullPath, 'utf8'),
    }))
    .filter((file) => options.includeTests || !isTestFile(file.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

function createSourceFile(file: ContractSourceFile) {
  const scriptKind = file.relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file.relPath, file.text, ts.ScriptTarget.Latest, true, scriptKind)
}

function locate(file: ContractSourceFile, source: ts.SourceFile, node: ts.Node): ContractSourceLocation {
  const start = node.getStart(source)
  const position = source.getLineAndCharacterOfPosition(start)
  const lineText = file.text.split(/\r?\n/)[position.line] || ''
  return {
    relPath: file.relPath,
    line: position.line + 1,
    column: position.character + 1,
    snippet: lineText.trim(),
  }
}

function calleeMatch(callee: ts.Expression): Pick<CallMatch, 'name' | 'receiverText'> | null {
  if (ts.isIdentifier(callee)) return { name: callee.text }
  if (ts.isPropertyAccessExpression(callee)) {
    return { name: callee.name.text, receiverText: callee.expression.getText() }
  }
  return null
}

/** 收集满足条件的调用表达式，按文件、行、列排序。 */
export function collectCalls(
  files: readonly ContractSourceFile[],
  predicate: (call: CallMatch) => boolean,
): ContractSourceLocation[] {
  const hits: ContractSourceLocation[] = []

  for (const file of files) {
    const source = createSourceFile(file)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const match = calleeMatch(node.expression)
        if (match && predicate({ ...match, argumentCount: node.arguments.length, file })) {
          hits.push(locate(file, source, node))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return hits.sort(byLocation)
}

/** 收集函数定义（函数声明或函数表达式赋值），用于「某函数不得复活」契约。 */
export function collectFunctionDefinitions(
  files: readonly ContractSourceFile[],
  names: ReadonlySet<string>,
): ContractSourceLocation[] {
  const hits: ContractSourceLocation[] = []

  for (const file of files) {
    const source = createSourceFile(file)
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) {
        hits.push(locate(file, source, node))
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
        const initializer = node.initializer
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          hits.push(locate(file, source, node))
        }
      }
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
        hits.push(locate(file, source, node))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return hits.sort(byLocation)
}

function byLocation(a: ContractSourceLocation, b: ContractSourceLocation) {
  return a.relPath.localeCompare(b.relPath) || a.line - b.line || a.column - b.column
}

/** 把命中位置格式化成可读报告：每个文件一行，后面跟行号列表。 */
export function formatLocations(locations: readonly ContractSourceLocation[]): string {
  const byFile = new Map<string, number[]>()
  for (const hit of locations) {
    const lines = byFile.get(hit.relPath) || []
    lines.push(hit.line)
    byFile.set(hit.relPath, lines)
  }
  return Array.from(byFile.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, lines]) => `  ${file}: ${lines.join(', ')}`)
    .join('\n')
}
