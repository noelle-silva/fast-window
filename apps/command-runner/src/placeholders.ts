import type { CommandItem, Placeholder, Repo } from './types'

// 占位符引用形式：{{名称}}；名称不含花括号（注册时已校验），
// 引用须与注册名精确一致（含空格、大小写），与后端替换规则保持一致。
const PLACEHOLDER_REFERENCE_PATTERN = /\{\{([^{}]+)\}\}/g

// placeholderReference 构造占位符在脚本中的引用文本。
export function placeholderReference(name: string): string {
  return `{{${name}}}`
}

// extractPlaceholderNames 按出现顺序提取脚本中的占位符引用名称（去重）。
export function extractPlaceholderNames(script: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of script.matchAll(PLACEHOLDER_REFERENCE_PATTERN)) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

// resolveCommandPlaceholders 解析一条命令本次运行需要选择的占位符：
// 取脚本中实际出现且已注册的引用（命令级定义优先于仓库级，同仓库内两层级不允许同名），
// 未注册的引用不参与选择，脚本里原样保留。
export function resolveCommandPlaceholders(command: CommandItem, repo: Repo | null): Placeholder[] {
  const commandLevel = new Map((command.placeholders ?? []).map(item => [item.name, item]))
  const repoLevel = new Map((repo?.placeholders ?? []).map(item => [item.name, item]))
  const resolved: Placeholder[] = []
  for (const name of extractPlaceholderNames(command.script)) {
    const definition = commandLevel.get(name) ?? repoLevel.get(name)
    if (definition) resolved.push(definition)
  }
  return resolved
}

// hasCommandPlaceholders 判断命令本次运行是否存在需要选择的占位符。
export function hasCommandPlaceholders(command: CommandItem, repo: Repo | null): boolean {
  return resolveCommandPlaceholders(command, repo).length > 0
}
