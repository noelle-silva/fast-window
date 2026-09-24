import type { HyperCortexMetadataV1 } from '../core'
import { normalizeHtmlFaceDisplayMode, normalizeHtmlFaceFixedScale } from '../htmlFaceDisplay'

/**
 * 一次性兼容迁移：把旧版 HTML 面全局字段（htmlFaceDisplayMode / htmlFaceFixedScaleDefault）
 * 搬入面插件全局设置统一容器（facePluginSettings.html）。
 *
 * 为什么存在：这两个字段是「面插件设置容器」落地之前的独立全局字段；
 * 旧版数据升级时若不搬运，老用户已保存的显示方式与默认缩放会丢失。
 *
 * 何时可删除：待确认所有在用数据的旧字段都已随启动搬运完成，
 * 且不再需要读取旧版 metadata 后（一次性兼容使命结束即可整体移除本模块）。
 *
 * 幂等：容器已有值优先，仅在容器缺值时用旧字段补齐；旧字段保持只读，宿主不再回写。
 */
export function migrateLegacyHtmlFaceSettings(
  container: Record<string, Record<string, unknown>>,
  legacy: Pick<HyperCortexMetadataV1, 'htmlFaceDisplayMode' | 'htmlFaceFixedScaleDefault'>,
): Record<string, Record<string, unknown>> {
  const html = { ...(container.html || {}) }
  if (html.displayMode === undefined) html.displayMode = normalizeHtmlFaceDisplayMode(legacy.htmlFaceDisplayMode)
  if (html.fixedScale === undefined) html.fixedScale = normalizeHtmlFaceFixedScale(legacy.htmlFaceFixedScaleDefault)
  return { ...container, html }
}
