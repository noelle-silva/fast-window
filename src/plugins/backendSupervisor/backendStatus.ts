export type PluginBackendStatus = {
  running: boolean
  pid?: number | null
  startedAtMs?: number | null
  ready?: boolean
  readyAtMs?: number | null
  exitCode?: number | null
  exitReason?: string | null
  endpointUrl?: string | null
  endpointTransport?: string | null
  endpointProtocolVersion?: number | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export function formatBackendStatus(status?: PluginBackendStatus | null): string {
  if (!status) return '未运行'
  const state = status.running ? (status.ready ? '运行中，已 ready' : '运行中，等待 ready') : '未运行'
  const endpoint = status.ready && status.endpointUrl ? '，endpoint 已就绪' : ''
  const pid = status.pid ? `，pid=${status.pid}` : ''
  const exit = !status.running && status.exitReason ? `，${status.exitReason}` : ''
  return `${state}${endpoint}${pid}${exit}`
}
