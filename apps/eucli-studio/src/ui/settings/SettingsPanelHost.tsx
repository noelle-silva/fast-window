import * as React from 'react'
import type { SettingsTabValue } from '../../domain/settingsNavigation'
import { settingsPanelRefreshScopes } from '../../domain/settingsRefreshScopes'
import { useScopedUiVersions } from '../hooks/useScopedUiVersion'
import { readSettingsPanelState, type SettingsPanelState } from './settingsPanelState'

// 设置面板宿主：只订阅该分类声明的刷新地址。
//
// 父级（PluginSettingsPage）不再因为实体变化而重建；地址命中时只有本宿主重渲染，
// 并且渲染期重新从 controller.getState() 派生数据，避免读到父级旧 props。
export function SettingsPanelHost(props: {
  controller: any
  tab: SettingsTabValue
  render: (state: SettingsPanelState) => React.ReactNode
}) {
  const { controller, tab, render } = props
  useScopedUiVersions(controller, settingsPanelRefreshScopes(tab))
  return <>{render(readSettingsPanelState(controller))}</>
}
