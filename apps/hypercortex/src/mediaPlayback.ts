export type MediaPlaybackCleanup = () => void

export function bindMediaPlaybackReporter(media: HTMLMediaElement, onPlayingChange: (playing: boolean) => void): MediaPlaybackCleanup {
  const report = () => onPlayingChange(!media.paused && !media.ended)
  media.addEventListener('play', report)
  media.addEventListener('playing', report)
  media.addEventListener('pause', report)
  media.addEventListener('ended', report)
  media.addEventListener('emptied', report)
  report()

  return () => {
    media.removeEventListener('play', report)
    media.removeEventListener('playing', report)
    media.removeEventListener('pause', report)
    media.removeEventListener('ended', report)
    media.removeEventListener('emptied', report)
    onPlayingChange(false)
  }
}

export function bindMediaPlaybackReporterInElement(root: HTMLElement, onPlayingChange: (playing: boolean) => void): MediaPlaybackCleanup {
  const playingMedia = new Set<HTMLMediaElement>()
  const report = () => onPlayingChange(playingMedia.size > 0)
  const cleanups = Array.from(root.querySelectorAll<HTMLMediaElement>('audio, video')).map(media => {
    return bindMediaPlaybackReporter(media, playing => {
      if (playing) playingMedia.add(media)
      else playingMedia.delete(media)
      report()
    })
  })

  return () => {
    cleanups.forEach(cleanup => cleanup())
    playingMedia.clear()
    onPlayingChange(false)
  }
}
