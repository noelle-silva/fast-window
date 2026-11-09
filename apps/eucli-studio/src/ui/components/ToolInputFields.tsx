import * as React from 'react'
import { Box } from '@mui/material'

// 字段值的折叠阈值：超过字符数或行数就默认收起，可单独展开。
const COLLAPSE_CHARS = 120
const COLLAPSE_LINES = 3

function formatFieldValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch (_) {
    return String(value)
  }
}

function shouldCollapse(text: string) {
  return text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES
}

function ToolInputField(props: { name: string; value: unknown }) {
  const text = formatFieldValue(props.value)
  const collapsible = shouldCollapse(text)
  const [expanded, setExpanded] = React.useState(false)
  const clamped = collapsible && !expanded

  return (
    <Box
      data-tool-field={props.name}
      sx={{
        display: 'grid',
        gridTemplateColumns: '132px minmax(0, 1fr)',
        gap: 1.5,
        py: 0.65,
        borderBottom: '1px solid var(--studio-divider)',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Box component="span" sx={{ fontSize: 12, color: 'var(--studio-tool-field-label)', overflowWrap: 'anywhere' }}>
        {props.name}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box
          component="pre"
          sx={{
            m: 0,
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: 'var(--studio-text-primary)',
            ...(clamped
              ? {
                  display: '-webkit-box',
                  WebkitLineClamp: COLLAPSE_LINES,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }
              : {}),
          }}
        >
          {text}
        </Box>
        {collapsible ? (
          <Box
            component="button"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? `收起字段 ${props.name}` : `展开字段 ${props.name}`}
            onClick={() => setExpanded((value) => !value)}
            sx={{
              mt: 0.25,
              p: 0,
              border: 0,
              background: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--studio-primary)',
            }}
          >
            {expanded ? '收起' : '展开'}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

// 工具输入参数的字段表：字段全部展开列出，只有超长的值各自折叠。
export function ToolInputFields(props: { value: any }) {
  const entries = React.useMemo(() => {
    const value = props.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return Object.entries(value)
  }, [props.value])

  if (!entries.length) return null

  return (
    <Box sx={{ mb: 1 }}>
      {entries.map(([name, value]) => (
        <ToolInputField key={name} name={name} value={value} />
      ))}
    </Box>
  )
}
