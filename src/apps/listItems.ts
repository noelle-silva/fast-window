import type { ComponentType } from 'react'
import type { Plugin } from '../constants'
import type { AppStatus, RegisteredApp } from './types'

const REGISTERED_APP_ITEM_PREFIX = 'app:'
const REGISTERED_APP_COMMAND_ITEM_PREFIX = 'app-command:'

export type RegisteredAppListSelection =
  | { type: 'app'; appId: string }
  | { type: 'appCommand'; appId: string; commandId: string }
  | { type: 'plugin' }

const NullRegisteredAppView: ComponentType<{ onBack: () => void }> = () => null

export function registeredAppListItemId(appId: string) {
  return `${REGISTERED_APP_ITEM_PREFIX}${appId}`
}

export function registeredAppCommandListItemId(appId: string, commandId: string) {
  return `${REGISTERED_APP_COMMAND_ITEM_PREFIX}${appId}:${commandId}`
}

export function parseRegisteredAppListItemId(itemId: string): RegisteredAppListSelection {
  if (itemId.startsWith(REGISTERED_APP_COMMAND_ITEM_PREFIX)) {
    const rest = itemId.slice(REGISTERED_APP_COMMAND_ITEM_PREFIX.length)
    const separator = rest.indexOf(':')
    if (separator > 0 && separator < rest.length - 1) {
      return {
        type: 'appCommand',
        appId: rest.slice(0, separator),
        commandId: rest.slice(separator + 1),
      }
    }
  }

  if (itemId.startsWith(REGISTERED_APP_ITEM_PREFIX)) {
    return { type: 'app', appId: itemId.slice(REGISTERED_APP_ITEM_PREFIX.length) }
  }

  return { type: 'plugin' }
}

export function registeredAppFromListItem(apps: RegisteredApp[], itemId: string): RegisteredApp | null {
  const selection = parseRegisteredAppListItemId(itemId)
  if (selection.type === 'plugin') return null
  return apps.find(app => app.id === selection.appId) ?? null
}

export function buildRegisteredAppListItems(
  apps: RegisteredApp[],
  statuses: Record<string, AppStatus>,
): Plugin[] {
  return apps.flatMap(app => {
    const icon = app.icon || app.name[0] || 'A'
    const appItem: Plugin = {
      id: registeredAppListItemId(app.id),
      name: app.name,
      description: app.path,
      icon,
      keyword: app.id,
      disabled: false,
      component: NullRegisteredAppView,
      appStatus: {
        type: 'registered-app',
        running: statuses[app.id]?.running === true,
      },
    }

    const commandItems: Plugin[] = (app.commands || []).map(command => ({
      id: registeredAppCommandListItemId(app.id, command.id),
      name: command.title,
      description: `${app.name} · 命令`,
      icon,
      keyword: `${app.id} ${command.id} ${command.title}`,
      disabled: false,
      component: NullRegisteredAppView,
    }))

    return [appItem, ...commandItems]
  })
}
