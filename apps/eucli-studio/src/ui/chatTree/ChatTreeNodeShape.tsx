import type { ChatTreeNodeRole } from './chatTreeLayout'
import { useThemeColors } from '../hooks/useThemeColors'

export function ChatTreeNodeShape(props: {
  role: ChatTreeNodeRole
  text: string
  isSelected: boolean
  w: number
  h: number
  clipId: string
}) {
  const { role, text, isSelected, w, h, clipId } = props
  const theme = useThemeColors()
  const colors = {
    successBg: theme.successBg,
    successBgStrong: theme.successBgStrong,
    successCore: theme.success,
    systemBg: theme.systemBg,
    systemBorder: theme.systemBorder,
    systemText: theme.systemText,
    userBg: theme.paper,
    userText: theme.textPrimary,
  }
  if (role === 'assistant') {
    return (
      <>
        <circle cx={w / 2} cy={h / 2} r={(isSelected ? 10 : 8) + 6} fill="transparent" pointerEvents="all" />
        {isSelected ? (
          <>
            <circle cx={w / 2} cy={h / 2} r={26} fill={colors.successBg} style={{ filter: `drop-shadow(0 0 20px ${colors.successCore})` }} />
            <circle cx={w / 2} cy={h / 2} r={18} fill={colors.successBgStrong} style={{ filter: `drop-shadow(0 0 10px ${colors.successCore})` }} />
          </>
        ) : null}
        <circle cx={w / 2} cy={h / 2} r={isSelected ? 10 : 8} fill={colors.successCore} />
        <title>{text || 'AI'}</title>
      </>
    )
  }

  const isSystem = role === 'system'
  const fill = isSystem ? colors.systemBg : colors.userBg
  const border = isSystem ? colors.systemBorder : 'transparent'
  const textFill = isSystem ? colors.systemText : colors.userText

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={10} y={6} width={Math.max(0, w - 20)} height={Math.max(0, h - 12)} rx={8} />
        </clipPath>
      </defs>
      {isSelected ? (
        <>
          <rect x={-10} y={-10} width={w + 20} height={h + 20} rx={18} fill={colors.successBg} style={{ filter: `drop-shadow(0 0 22px ${colors.successCore})` }} />
          <rect x={-4} y={-4} width={w + 8} height={h + 8} rx={14} fill={colors.successBgStrong} style={{ filter: `drop-shadow(0 0 12px ${colors.successCore})` }} />
        </>
      ) : null}
      <rect x={0} y={0} width={w} height={h} rx={12} fill={fill} stroke={border} strokeWidth={isSystem ? 1 : 0} />
      <text x={12} y={h / 2} fill={textFill} fontSize={12} fontWeight={isSystem ? 800 : 400} dominantBaseline="middle" clipPath={`url(#${clipId})`} style={{ pointerEvents: 'none' }}>
        {text}
      </text>
    </>
  )
}
