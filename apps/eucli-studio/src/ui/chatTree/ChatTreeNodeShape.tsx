import type { ChatTreeNodeRole } from './chatTreeLayout'

export function ChatTreeNodeShape(props: { role: ChatTreeNodeRole; text: string; isSelected: boolean; w: number; h: number; clipId: string }) {
  const { role, text, isSelected, w, h, clipId } = props
  if (role === 'assistant') {
    return (
      <>
        <circle cx={w / 2} cy={h / 2} r={(isSelected ? 10 : 8) + 6} fill="transparent" pointerEvents="all" />
        {isSelected ? (
          <>
            <circle cx={w / 2} cy={h / 2} r={26} fill="rgba(34,197,94,.14)" style={{ filter: 'drop-shadow(0 0 20px rgba(34,197,94,.85))' }} />
            <circle cx={w / 2} cy={h / 2} r={18} fill="rgba(34,197,94,.26)" style={{ filter: 'drop-shadow(0 0 10px rgba(34,197,94,.75))' }} />
          </>
        ) : null}
        <circle cx={w / 2} cy={h / 2} r={isSelected ? 10 : 8} fill="#22c55e" />
        <title>{text || 'AI'}</title>
      </>
    )
  }

  const isSystem = role === 'system'
  const fill = isSystem ? 'rgba(124,58,237,.08)' : '#ffffff'
  const border = isSystem ? 'rgba(124,58,237,.42)' : 'transparent'
  const textFill = isSystem ? 'rgba(88,28,135,.92)' : 'rgba(0,0,0,.82)'

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={10} y={6} width={Math.max(0, w - 20)} height={Math.max(0, h - 12)} rx={8} />
        </clipPath>
      </defs>
      {isSelected ? (
        <>
          <rect x={-10} y={-10} width={w + 20} height={h + 20} rx={18} fill="rgba(34,197,94,.10)" style={{ filter: 'drop-shadow(0 0 22px rgba(34,197,94,.85))' }} />
          <rect x={-4} y={-4} width={w + 8} height={h + 8} rx={14} fill="rgba(34,197,94,.20)" style={{ filter: 'drop-shadow(0 0 12px rgba(34,197,94,.75))' }} />
        </>
      ) : null}
      <rect x={0} y={0} width={w} height={h} rx={12} fill={fill} stroke={border} strokeWidth={isSystem ? 1 : 0} />
      <text x={12} y={h / 2} fill={textFill} fontSize={12} fontWeight={isSystem ? 800 : 400} dominantBaseline="middle" clipPath={`url(#${clipId})`} style={{ pointerEvents: 'none' }}>
        {text}
      </text>
    </>
  )
}
