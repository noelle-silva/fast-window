import Plyr from 'plyr'
import { buildSandboxSafePlyrControls, speedOptions } from './plyrControls'
import { ensurePlyrVideoPlayerStyles } from './plyrStyles'

const playerOptions: Plyr.Options = {
  controls: buildSandboxSafePlyrControls,
  loadSprite: false,
  iconUrl: '',
  blankVideo: '',
  settings: [],
  clickToPlay: true,
  keyboard: { focused: true, global: false },
  seekTime: 10,
  tooltips: { controls: true, seek: true },
  ratio: '16:9',
  storage: { enabled: false },
  speed: { selected: 1, options: [...speedOptions] },
  i18n: {
    play: '播放',
    pause: '暂停',
    mute: '静音',
    unmute: '取消静音',
    enterFullscreen: '进入全屏',
    exitFullscreen: '退出全屏',
    pip: '画中画',
    speed: '速度',
    normal: '正常',
  },
}

type Cleanup = () => void

function bindSpeedSelect(root: HTMLElement, player: Plyr): Cleanup {
  const select = root.querySelector<HTMLSelectElement>('[data-hc-plyr-speed]')
  if (!select) return () => {}

  const sync = () => {
    select.value = String(player.speed || 1)
  }
  const update = () => {
    player.speed = Number(select.value) || 1
  }

  select.addEventListener('change', update)
  player.on('ratechange', sync)
  sync()

  return () => {
    select.removeEventListener('change', update)
    player.off('ratechange', sync)
  }
}

export function createVideoElement(src: string, title?: string) {
  const video = document.createElement('video')
  video.src = src
  video.controls = true
  video.preload = 'metadata'
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  if (title) video.setAttribute('aria-label', title)
  return video
}

export function enhanceVideoElement(video: HTMLVideoElement): Cleanup {
  ensurePlyrVideoPlayerStyles()

  const player = new Plyr(video, playerOptions)
  const container = player.elements.container instanceof HTMLElement ? player.elements.container : video.parentElement
  const cleanupSpeedSelect = container ? bindSpeedSelect(container, player) : () => {}

  video.dataset.hcPlyrEnhanced = '1'

  return () => {
    cleanupSpeedSelect()
    try {
      player.destroy()
    } catch {
      // Plyr may already be detached when tabs or rendered notes are disposed.
    }
  }
}

export function buildVideoPlayer(src: string, title: string, width?: number) {
  const wrap = document.createElement('div')
  wrap.className = 'hc-video-player'
  if (width && width > 0) wrap.style.width = `${width}px`

  const video = createVideoElement(src, title)
  wrap.appendChild(video)

  requestAnimationFrame(() => {
    if (!video.isConnected || video.dataset.hcPlyrEnhanced === '1') return
    enhanceVideoElement(video)
  })

  return wrap
}
