import { DEFAULT_APP_STORE_CATALOG_URL } from '../constants'
import { fetchStoreCatalog } from '../appStore/catalogClient'
import { cmpSemver, parseSemverStrict } from '../appStore/semver'
import type { HostUpdateEntry } from '../appStore/catalogTypes'

export type HostUpdateCheckResult =
  | { status: 'available'; currentVersion: string; update: HostUpdateEntry }
  | { status: 'current'; currentVersion: string; remoteVersion: string }
  | { status: 'missing'; currentVersion: string }

export async function checkHostUpdate(currentVersion: string, signal?: AbortSignal): Promise<HostUpdateCheckResult> {
  const current = parseSemverStrict(currentVersion)
  if (!current) throw new Error('当前宿主版本号不是 x.y.z 格式')

  const catalog = await fetchStoreCatalog(DEFAULT_APP_STORE_CATALOG_URL, 25_000, signal)
  const host = catalog.host
  if (!host) return { status: 'missing', currentVersion }

  const remote = parseSemverStrict(host.version)
  if (!remote) throw new Error('远端宿主版本号不是 x.y.z 格式')
  if (cmpSemver(remote, current) <= 0) {
    return { status: 'current', currentVersion, remoteVersion: host.version }
  }

  return { status: 'available', currentVersion, update: host }
}
