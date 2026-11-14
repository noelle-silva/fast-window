export type CommandCandidate = {
  id: string
  name: string
}

const SUGGESTION_LIMIT = 8

/// 输入到「目标片段」时给出候选应用。
///
/// 只有动作词已经写完才提示：`stop` 本身不能被当成应用名筛选。
/// 目标片段为空表示「还没写」，此时给出全部候选供选择。
export function suggestAppCandidates(
  input: string,
  apps: CommandCandidate[],
): CommandCandidate[] {
  const { hasAction, fragment } = parseInput(input)
  if (!hasAction || fragment.startsWith('--')) return []

  const needle = fragment.toLowerCase()
  return apps
    .filter(app => (
      app.id.toLowerCase().includes(needle) || app.name.toLowerCase().includes(needle)
    ))
    .slice(0, SUGGESTION_LIMIT)
}

/// 把候选应用补进当前输入，保留已经写好的动作词。
export function applyCandidate(input: string, appId: string): string {
  const { action } = parseInput(input)
  return action ? `${action} ${appId}` : appId
}

function parseInput(input: string): { hasAction: boolean; action: string; fragment: string } {
  const trimmed = input.trimStart()
  const separator = trimmed.search(/\s/)
  if (separator < 0) {
    return { hasAction: false, action: trimmed, fragment: '' }
  }
  return {
    hasAction: true,
    action: trimmed.slice(0, separator),
    fragment: trimmed.slice(separator + 1).trim(),
  }
}
