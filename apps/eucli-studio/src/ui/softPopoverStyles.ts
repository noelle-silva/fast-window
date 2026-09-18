export const SOFT_POPOVER_PAPER_SX = {
  borderRadius: 3,
  bgcolor: 'rgba(255,255,255,.94)',
  backgroundImage: 'none',
  boxShadow: '0 24px 70px rgba(15,23,42,.18)',
  overflow: 'hidden',
  '& .MuiOutlinedInput-root': {
    borderRadius: 2.25,
    bgcolor: 'rgba(255,255,255,.72)',
    boxShadow: '0 8px 22px rgba(15,23,42,.045)',
    '& .MuiOutlinedInput-notchedOutline': { border: 0 },
    '&:hover': { bgcolor: 'rgba(255,255,255,.94)', boxShadow: '0 10px 26px rgba(15,23,42,.065)' },
    '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
    '&.Mui-focused': { bgcolor: 'rgba(239,246,255,.96)', boxShadow: '0 12px 30px rgba(37,99,235,.10)' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
  },
  '& .MuiInputLabel-root': { fontWeight: 700, color: 'text.secondary' },
  '& .MuiTabs-indicator': { display: 'none' },
  '& .MuiPaper-outlined': {
    border: 0,
    borderRadius: 2.5,
    bgcolor: 'rgba(255,255,255,.72)',
    boxShadow: '0 10px 28px rgba(15,23,42,.07)',
  },
  '& .MuiButton-outlined': {
    border: 0,
    bgcolor: 'rgba(255,255,255,.62)',
    boxShadow: '0 8px 22px rgba(15,23,42,.045)',
  },
  '& .MuiButton-outlined:hover': {
    border: 0,
    bgcolor: 'rgba(255,255,255,.9)',
    boxShadow: '0 10px 26px rgba(15,23,42,.065)',
  },
}

export const SOFT_POPOVER_HEADER_SX = {
  p: 1.25,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
}

export const SOFT_POPOVER_LIST_SX = {
  px: 0.75,
  py: 0.75,
}

export const SOFT_POPOVER_ITEM_SX = {
  my: 0.25,
  borderRadius: 2.25,
  alignItems: 'center',
  transition: 'background-color .16s ease, box-shadow .16s ease',
  '&.Mui-selected': {
    bgcolor: 'rgba(59,130,246,.10)',
    boxShadow: '0 10px 26px rgba(37,99,235,.09)',
  },
  '&.Mui-selected:hover': {
    bgcolor: 'rgba(59,130,246,.14)',
  },
}

export const SOFT_POPOVER_ITEM_TOP_SX = {
  ...SOFT_POPOVER_ITEM_SX,
  alignItems: 'flex-start',
}
