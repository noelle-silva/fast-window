export function settingsTabSx() {
  return {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 2.5,
    '&:hover': {
      bgcolor: 'var(--hc-surface-muted)',
      color: 'var(--hc-text)',
    },
    '&.Mui-selected': {
      bgcolor: 'var(--hc-surface)',
      color: 'var(--hc-text)',
      boxShadow: '0 8px 20px var(--hc-shadow)',
    },
    '&.Mui-selected::after': {
      content: '""',
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 5,
      height: 3,
      borderRadius: 999,
      bgcolor: 'var(--hc-primary)',
    },
  }
}

export function settingsSelectableSurfaceSx(active: boolean) {
  return {
    position: 'relative',
    overflow: 'hidden',
    bgcolor: active ? 'var(--hc-surface)' : 'var(--hc-surface-soft)',
    boxShadow: active ? '0 12px 26px var(--hc-shadow)' : 'none',
    '&:hover': {
      bgcolor: active ? 'var(--hc-surface-soft)' : 'var(--hc-surface-muted)',
    },
    '&::before': active ? settingsSelectionStripSx() : undefined,
  }
}

export function settingsChoiceMarkSx(active: boolean) {
  return {
    flex: '0 0 18px',
    width: 18,
    height: 18,
    mt: 0.15,
    borderRadius: '50%',
    bgcolor: active ? 'var(--hc-primary)' : 'var(--hc-surface-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: active ? '0 8px 18px var(--hc-shadow)' : 'none',
  }
}

export function settingsAccentTextSx() {
  return {
    color: 'var(--hc-primary)',
    fontWeight: 900,
  }
}

function settingsSelectionStripSx() {
  return {
    content: '""',
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 4,
    borderRadius: 999,
    bgcolor: 'var(--hc-primary)',
  }
}
