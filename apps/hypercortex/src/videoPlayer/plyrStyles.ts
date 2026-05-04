import plyrCss from 'plyr/dist/plyr.css'

const STYLE_ID = 'hc-plyr-video-player-css'

export function ensurePlyrVideoPlayerStyles() {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `${String(plyrCss || '')}\n${customPlyrCss}`
  document.head.appendChild(style)
}

const customPlyrCss = `
.hc-video-player,
.hc-video-player .plyr {
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  border-radius: 14px;
  overflow: hidden;
  background: #050507;
  box-shadow: 0 18px 44px rgba(15, 23, 42, .24);
}

.hc-video-player .plyr--video {
  --plyr-color-main: #7c3aed;
  --plyr-video-background: #050507;
  --plyr-control-radius: 12px;
  --plyr-menu-radius: 14px;
  --plyr-tooltip-radius: 10px;
  --plyr-font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.hc-video-player .plyr__controls {
  align-items: center;
  gap: 8px;
  padding: 20px 18px 14px;
  background: linear-gradient(to top, rgba(0, 0, 0, .78), rgba(0, 0, 0, .28), transparent);
}

.hc-video-player .plyr__control,
.hc-video-player .hc-plyr-speed {
  border-radius: 12px;
}

.hc-video-player .plyr__control--overlaid {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(124, 58, 237, .92);
  box-shadow: 0 18px 38px rgba(124, 58, 237, .34);
}

.hc-video-player .plyr__control--overlaid:hover,
.hc-video-player .plyr__control--overlaid:focus-visible {
  background: #6d28d9;
}

.hc-video-player .hc-plyr-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.hc-video-player .hc-plyr-icon {
  position: relative;
  display: inline-block;
  width: 18px;
  height: 18px;
}

.hc-video-player .hc-plyr-icon::before,
.hc-video-player .hc-plyr-icon::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  display: block;
}

.hc-video-player .hc-plyr-icon--play::before {
  left: 3px;
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-left: 10px solid currentColor;
}

.hc-video-player .hc-plyr-icon--mute::before {
  left: 1px;
  width: 6px;
  height: 8px;
  border-radius: 2px 0 0 2px;
  background: currentColor;
  clip-path: polygon(0 25%, 50% 25%, 100% 0, 100% 100%, 50% 75%, 0 75%);
}

.hc-video-player .hc-plyr-icon--mute::after {
  left: 9px;
  width: 6px;
  height: 10px;
  border: 2px solid currentColor;
  border-left: 0;
  border-top-color: transparent;
  border-bottom-color: transparent;
  border-radius: 50%;
}

.hc-video-player .hc-plyr-icon--pip::before {
  width: 15px;
  height: 11px;
  border: 2px solid currentColor;
  border-radius: 2px;
}

.hc-video-player .hc-plyr-icon--pip::after {
  right: 1px;
  bottom: 2px;
  left: auto;
  top: auto;
  width: 6px;
  height: 4px;
  border-radius: 1px;
  background: currentColor;
}

.hc-video-player .hc-plyr-icon--fullscreen::before {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-radius: 2px;
  clip-path: polygon(0 0, 42% 0, 42% 20%, 20% 20%, 20% 42%, 0 42%, 0 0, 58% 0, 100% 0, 100% 42%, 80% 42%, 80% 20%, 58% 20%, 58% 0, 100% 58%, 100% 100%, 58% 100%, 58% 80%, 80% 80%, 80% 58%, 100% 58%, 42% 100%, 0 100%, 0 58%, 20% 58%, 20% 80%, 42% 80%, 42% 100%);
}

.hc-video-player .hc-plyr-icon--speed::before {
  width: 15px;
  height: 15px;
  border: 2px solid currentColor;
  border-radius: 50%;
  border-bottom-color: transparent;
}

.hc-video-player .hc-plyr-icon--speed::after {
  top: 4px;
  left: 8px;
  width: 2px;
  height: 7px;
  background: currentColor;
  border-radius: 999px;
  transform: rotate(42deg);
  transform-origin: bottom center;
}

.hc-video-player .hc-plyr-speed {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 9px;
  color: #fff;
  background: transparent;
}

.hc-video-player .hc-plyr-speed:hover,
.hc-video-player .hc-plyr-speed:focus-within {
  background: rgba(255, 255, 255, .12);
}

.hc-video-player .hc-plyr-speed__select {
  min-width: 54px;
  border: 0;
  outline: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.hc-video-player .hc-plyr-speed__select option {
  color: #111827;
}

.hc-video-player video {
  display: block;
  width: 100%;
  max-width: 100%;
  background: #050507;
}
`
