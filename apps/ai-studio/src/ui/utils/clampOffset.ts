export function clampOffset(
  offset: { x: number; y: number },
  stage: { w: number; h: number },
  img: { w: number; h: number },
  fit: number,
  zoom: number,
) {
  // 允许内容被拖出屏幕：这里只做数值归一化，不再做边界裁剪。
  // 保留签名是为了复用现有调用点（Image/Mermaid 共用）。
  void stage
  void img
  void fit
  void zoom
  return {
    x: isFinite(Number(offset?.x)) ? Number(offset.x) : 0,
    y: isFinite(Number(offset?.y)) ? Number(offset.y) : 0,
  }
}

