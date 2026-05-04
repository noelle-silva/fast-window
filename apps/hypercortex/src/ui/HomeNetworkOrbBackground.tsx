import * as React from 'react'
import { keyframes } from '@emotion/react'
import { Box } from '@mui/material'

const orbSpin = keyframes`
  0% { transform: rotateX(62deg) rotateZ(0deg); }
  100% { transform: rotateX(62deg) rotateZ(360deg); }
`

const haloSpin = keyframes`
  0% { transform: rotateX(68deg) rotateY(18deg) rotateZ(0deg); }
  100% { transform: rotateX(68deg) rotateY(18deg) rotateZ(-360deg); }
`

const nodePulse = keyframes`
  0%, 100% { opacity: .56; transform: translate3d(var(--x), var(--y), var(--z)) scale(.78); }
  50% { opacity: 1; transform: translate3d(var(--x), var(--y), var(--z)) scale(1.16); }
`

const lineGlow = keyframes`
  0%, 100% { opacity: .22; }
  50% { opacity: .62; }
`

type OrbNode = {
  id: string
  x: number
  y: number
  z: number
  size: number
}

const nodes: OrbNode[] = [
  { id: 'n1', x: -78, y: -108, z: 42, size: 5 },
  { id: 'n2', x: -28, y: -132, z: 18, size: 4 },
  { id: 'n3', x: 42, y: -118, z: -8, size: 5 },
  { id: 'n4', x: 98, y: -78, z: 36, size: 4 },
  { id: 'n5', x: -122, y: -38, z: -14, size: 4 },
  { id: 'n6', x: -52, y: -52, z: 62, size: 5 },
  { id: 'n7', x: 20, y: -44, z: 28, size: 4 },
  { id: 'n8', x: 92, y: -20, z: -30, size: 5 },
  { id: 'n9', x: -104, y: 34, z: 28, size: 5 },
  { id: 'n10', x: -28, y: 18, z: -46, size: 4 },
  { id: 'n11', x: 42, y: 38, z: 54, size: 5 },
  { id: 'n12', x: 118, y: 48, z: 10, size: 4 },
  { id: 'n13', x: -72, y: 102, z: -22, size: 5 },
  { id: 'n14', x: 0, y: 126, z: 20, size: 4 },
  { id: 'n15', x: 78, y: 98, z: -6, size: 5 },
]

const links: [string, string][] = [
  ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'],
  ['n1', 'n5'], ['n2', 'n6'], ['n3', 'n7'], ['n4', 'n8'],
  ['n5', 'n6'], ['n6', 'n7'], ['n7', 'n8'],
  ['n5', 'n9'], ['n6', 'n10'], ['n7', 'n11'], ['n8', 'n12'],
  ['n9', 'n10'], ['n10', 'n11'], ['n11', 'n12'],
  ['n9', 'n13'], ['n10', 'n14'], ['n11', 'n15'], ['n12', 'n15'],
  ['n13', 'n14'], ['n14', 'n15'], ['n6', 'n11'], ['n7', 'n10'],
]

function byId(id: string): OrbNode {
  const node = nodes.find(item => item.id === id)
  if (!node) throw new Error(`Missing orb node: ${id}`)
  return node
}

function Link(props: { from: OrbNode; to: OrbNode; index: number }): React.ReactNode {
  const { from, to, index } = props
  const x = (from.x + to.x) / 2
  const y = (from.y + to.y) / 2
  const z = (from.z + to.z) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.sqrt(dx * dx + dy * dy)
  const angle = Math.atan2(dy, dx) * 180 / Math.PI

  return (
    <Box
      sx={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: `${length}px`,
        height: '1px',
        transformStyle: 'preserve-3d',
        transform: `translate3d(${x}px, ${y}px, ${z}px) translateX(-50%) rotateZ(${angle}deg)`,
        transformOrigin: '50% 50%',
        background: 'linear-gradient(90deg, rgba(68,176,255,0), rgba(119,218,255,.74), rgba(166,137,255,0))',
        boxShadow: '0 0 12px rgba(87,196,255,.42)',
        animation: `${lineGlow} ${5.6 + index * .08}s ease-in-out infinite`,
        animationDelay: `${-index * .24}s`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    />
  )
}

function NodeDot(props: { node: OrbNode; index: number }): React.ReactNode {
  const { node, index } = props
  return (
    <Box
      sx={{
        '--x': `${node.x}px`,
        '--y': `${node.y}px`,
        '--z': `${node.z}px`,
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: node.size,
        height: node.size,
        ml: `${-node.size / 2}px`,
        mt: `${-node.size / 2}px`,
        borderRadius: 999,
        bgcolor: 'rgba(224,246,255,.95)',
        boxShadow: '0 0 12px rgba(115,215,255,.86), 0 0 26px rgba(128,125,255,.42)',
        transform: `translate3d(${node.x}px, ${node.y}px, ${node.z}px)`,
        animation: `${nodePulse} ${4.8 + index * .12}s ease-in-out infinite`,
        animationDelay: `${-index * .22}s`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      } as any}
    />
  )
}

function OrbRings(): React.ReactNode {
  return (
    <>
      {[0, 1, 2].map(index => (
        <Box
          key={index}
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 278 - index * 36,
            height: 278 - index * 36,
            ml: `${-(278 - index * 36) / 2}px`,
            mt: `${-(278 - index * 36) / 2}px`,
            borderRadius: '50%',
            border: '1px solid rgba(126,213,255,.18)',
            transform: `translateZ(${-index * 28}px) rotateX(${index * 18}deg)`,
            boxShadow: 'inset 0 0 34px rgba(70,168,255,.12)',
          }}
        />
      ))}
    </>
  )
}

export function HomeNetworkOrbBackground(): React.ReactNode {
  return (
    <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: '#07111f' }} />
      <Box sx={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 24% 42%, rgba(80,174,255,.46), transparent 29%), radial-gradient(circle at 72% 22%, rgba(133,107,255,.34), transparent 30%), linear-gradient(135deg, #07111f 0%, #10233b 54%, #090c18 100%)' }} />
      <Box sx={{ position: 'absolute', left: { xs: '-18%', md: '1%' }, top: '50%', width: 430, height: 430, transform: 'translateY(-50%)', perspective: '900px', opacity: .96 }}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(71,176,255,.22), rgba(61,99,184,.08) 42%, transparent 68%)',
            filter: 'blur(2px)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            transformStyle: 'preserve-3d',
            animation: `${orbSpin} 46s linear infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <OrbRings />
          {links.map(([from, to], index) => <Link key={`${from}-${to}`} from={byId(from)} to={byId(to)} index={index} />)}
          {nodes.map((node, index) => <NodeDot key={node.id} node={node} index={index} />)}
        </Box>
        <Box
          sx={{
            position: 'absolute',
            inset: 54,
            borderRadius: '50%',
            border: '1px solid rgba(177,231,255,.16)',
            transformStyle: 'preserve-3d',
            animation: `${haloSpin} 62s linear infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      </Box>
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(7,17,31,.42) 0%, rgba(7,17,31,.28) 42%, rgba(7,17,31,.72) 100%)' }} />
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.10) 1px, transparent 1.2px)', backgroundSize: '34px 34px', opacity: .18 }} />
    </Box>
  )
}
