export type AppDevCommandRuns = Record<string, number>

export function appDevCommandIsRunning(runs: AppDevCommandRuns, appId: string): boolean {
  return (runs[appId] ?? 0) > 0
}

export function beginAppDevCommandRun(runs: AppDevCommandRuns, appId: string): AppDevCommandRuns {
  return {
    ...runs,
    [appId]: (runs[appId] ?? 0) + 1,
  }
}

export function finishAppDevCommandRun(runs: AppDevCommandRuns, appId: string): AppDevCommandRuns {
  const nextCount = (runs[appId] ?? 0) - 1
  if (nextCount > 0) {
    return {
      ...runs,
      [appId]: nextCount,
    }
  }

  const { [appId]: _finished, ...nextRuns } = runs
  return nextRuns
}
