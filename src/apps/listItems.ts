import type { ComponentType } from 'react'
import type { Plugin, PluginIconBadge } from '../constants'
import { appDevCommandIsRunning, type AppDevCommandRuns } from './appDevCommandState'
import type { AppStatus, RegisteredApp, RegisteredAppCapabilitySelection } from './types'

const REGISTERED_APP_ITEM_PREFIX = 'app:'
const REGISTERED_APP_SHORTCUT_ITEM_PREFIX = 'app-shortcut:'
const REGISTERED_APP_CAPABILITY_ITEM_PREFIX = 'app-capability:'
const REGISTERED_APP_SHORTCUT_ICON_BADGE: PluginIconBadge = {
  kind: 'shortcut-command',
  label: '快捷入口',
}
const REGISTERED_APP_CAPABILITY_ICON_BADGE: PluginIconBadge = {
  kind: 'app-capability',
  label: '能力',
}

export type RegisteredAppListSelection =
  | { type: 'app'; appId: string }
  | { type: 'appShortcut'; appId: string; shortcutId: string }
  | { type: 'appCapability'; appId: string; capabilityId: string }
  | { type: 'plugin' }

const NullRegisteredAppView: ComponentType<{ onBack: () => void }> = () => null

export function registeredAppListItemId(appId: string) {
  return `${REGISTERED_APP_ITEM_PREFIX}${appId}`
}

export function registeredAppShortcutListItemId(appId: string, shortcutId: string) {
  return `${REGISTERED_APP_SHORTCUT_ITEM_PREFIX}${appId}:${shortcutId}`
}

export function registeredAppCapabilityListItemId(appId: string, capabilityId: string) {
  return `${REGISTERED_APP_CAPABILITY_ITEM_PREFIX}${appId}:${capabilityId}`
}

export function parseRegisteredAppListItemId(itemId: string): RegisteredAppListSelection {
  if (itemId.startsWith(REGISTERED_APP_SHORTCUT_ITEM_PREFIX)) {
    const rest = itemId.slice(REGISTERED_APP_SHORTCUT_ITEM_PREFIX.length)
    const separator = rest.indexOf(':')
    if (separator > 0 && separator < rest.length - 1) {
      return {
        type: 'appShortcut',
        appId: rest.slice(0, separator),
        shortcutId: rest.slice(separator + 1),
      }
    }
  }

  if (itemId.startsWith(REGISTERED_APP_CAPABILITY_ITEM_PREFIX)) {
    const rest = itemId.slice(REGISTERED_APP_CAPABILITY_ITEM_PREFIX.length)
    const separator = rest.indexOf(':')
    if (separator > 0 && separator < rest.length - 1) {
      return {
        type: 'appCapability',
        appId: rest.slice(0, separator),
        capabilityId: rest.slice(separator + 1),
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
  devCommandRuns: AppDevCommandRuns = {},
  capabilitySelections: RegisteredAppCapabilitySelection[] = [],
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
        devCommandRunning: appDevCommandIsRunning(devCommandRuns, app.id),
      },
    }

    const shortcutItems: Plugin[] = (app.commands || []).map(shortcut => ({
      id: registeredAppShortcutListItemId(app.id, shortcut.id),
      name: shortcut.title,
      description: `${app.name} · 快捷入口`,
      icon: shortcut.icon || icon,
      keyword: `${app.id} ${shortcut.id} ${shortcut.title}`,
      disabled: false,
      component: NullRegisteredAppView,
      iconBadge: REGISTERED_APP_SHORTCUT_ICON_BADGE,
      appStatus: {
        type: 'registered-app',
        running: statuses[app.id]?.running === true,
        devCommandRunning: appDevCommandIsRunning(devCommandRuns, app.id),
      },
    }))

    const capabilityItems: Plugin[] = capabilitySelections
      .filter(capability => capability.appId === app.id)
      .map(capability => ({
        id: registeredAppCapabilityListItemId(app.id, capability.capabilityId),
        name: capability.title,
        description: `${app.name} · 能力`,
        icon: capability.icon || icon,
        keyword: `${app.id} ${capability.capabilityId} ${capability.title}`,
        disabled: false,
        component: NullRegisteredAppView,
        iconBadge: REGISTERED_APP_CAPABILITY_ICON_BADGE,
        appStatus: {
          type: 'registered-app',
          running: statuses[app.id]?.running === true,
          devCommandRunning: appDevCommandIsRunning(devCommandRuns, app.id),
        },
      }))

    return [appItem, ...shortcutItems, ...capabilityItems]
  })
}
