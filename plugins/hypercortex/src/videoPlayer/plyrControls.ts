type PlyrControlsProps = { id: string }

const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

function icon(name: 'play' | 'mute' | 'pip' | 'fullscreen' | 'speed') {
  return `<span aria-hidden="true" class="hc-plyr-icon hc-plyr-icon--${name}"></span>`
}

function srOnly(label: string) {
  return `<span class="plyr__sr-only">${label}</span>`
}

function button(plyrAction: string, label: string, iconName: 'play' | 'mute' | 'pip' | 'fullscreen', extraClass = '') {
  return `
    <button type="button" class="plyr__controls__item plyr__control hc-plyr-button ${extraClass}" data-plyr="${plyrAction}" aria-label="${label}" title="${label}">
      ${icon(iconName)}
      ${srOnly(label)}
    </button>
  `
}

function speedMenu() {
  const options = speedOptions
    .map(rate => `<option value="${rate}"${rate === 1 ? ' selected' : ''}>${rate === 1 ? '1x' : `${rate}x`}</option>`)
    .join('')

  return `
    <label class="plyr__controls__item hc-plyr-speed" title="播放速度">
      ${icon('speed')}
      ${srOnly('播放速度')}
      <select class="hc-plyr-speed__select" data-hc-plyr-speed aria-label="播放速度">
        ${options}
      </select>
    </label>
  `
}

export function buildSandboxSafePlyrControls({ id }: PlyrControlsProps) {
  return `
    <button type="button" class="plyr__control plyr__control--overlaid hc-plyr-button hc-plyr-button--play-large" data-plyr="play" aria-label="播放" title="播放">
      ${icon('play')}
      ${srOnly('播放')}
    </button>
    <div class="plyr__controls">
      ${button('play', '播放', 'play')}
      <div class="plyr__controls__item plyr__progress__container">
        <div class="plyr__progress">
          <input id="plyr-seek-${id}" class="plyr__progress__input" data-plyr="seek" type="range" min="0" max="100" step="0.01" value="0" autocomplete="off" aria-label="进度">
          <progress class="plyr__progress__buffer" min="0" max="100" value="0">0% buffered</progress>
          <span class="plyr__tooltip">00:00</span>
        </div>
      </div>
      <div class="plyr__controls__item plyr__time plyr__time--current" aria-label="当前时间">00:00</div>
      <div class="plyr__controls__item plyr__time plyr__time--duration" aria-label="总时长">00:00</div>
      <div class="plyr__controls__item plyr__volume">
        ${button('mute', '静音', 'mute')}
        <input class="plyr__volume__input" data-plyr="volume" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="音量">
      </div>
      ${speedMenu()}
      ${button('pip', '画中画', 'pip')}
      ${button('fullscreen', '全屏', 'fullscreen')}
    </div>
  `
}

export { speedOptions }
