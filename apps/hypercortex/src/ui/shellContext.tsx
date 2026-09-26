import * as React from 'react'
import type { HyperCortexAppSettingsV1 } from '../core'
import type { DataDirStatus, HyperCortexGateway, HyperCortexRepo, LegacyDataImportResult } from '../gateway'

// 外壳能力：应用设置、仓库池、数据目录、顶部栏槽位。
// 全局只有一份；仓库现场通过该上下文消费全局能力，全局部分不复制进现场。

export type HyperCortexToolbarSlots = {
  left: HTMLElement | null
  right: HTMLElement | null
}

export type HyperCortexShellValue = {
  appSettings: HyperCortexAppSettingsV1
  patchAppSettings: (patch: Partial<HyperCortexAppSettingsV1>) => void
  // 外壳未绑定仓库的网关：全局概念页面（仓库回收站等）使用。
  reposGateway: HyperCortexGateway
  repos: HyperCortexRepo[]
  activeRepoId: string
  onRenameRepo: (repoId: string, title: string) => Promise<void>
  onDeleteRepo: (repoId: string) => Promise<void>
  refreshRepos: () => Promise<void>
  dataDirStatus: DataDirStatus | null
  refreshDataDirStatus: () => Promise<DataDirStatus | void>
  pickDataDir: () => Promise<DataDirStatus | null>
  importLegacyData: () => Promise<LegacyDataImportResult | null>
  toolbarSlots: HyperCortexToolbarSlots
  // 应用命令队列：外来源（启动参数、宿主唤起）与现场来源共用，由当前活动现场消费。
  appCommands: {
    queue: string[]
    enqueue: (command: string) => void
    consume: () => void
  }
}

const HyperCortexShellContext = React.createContext<HyperCortexShellValue | null>(null)

export function HyperCortexShellProvider(props: { value: HyperCortexShellValue; children: React.ReactNode }) {
  return <HyperCortexShellContext.Provider value={props.value}>{props.children}</HyperCortexShellContext.Provider>
}

export function useHyperCortexShell(): HyperCortexShellValue {
  const value = React.useContext(HyperCortexShellContext)
  if (!value) throw new Error('HyperCortex 外壳上下文不可用')
  return value
}
