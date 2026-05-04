import * as React from 'react'

type Props = {
  html: string
  minHeightPx?: number
}

function createToken(): string {
  try {
    const a = new Uint32Array(4)
    crypto.getRandomValues(a)
    return Array.from(a).join('-')
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function injectAutoHeightProbe(src: string, token: string) {
  const raw = String(src || '')
  const doc = new DOMParser().parseFromString(raw, 'text/html')

  const head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement

  const oldStyle = doc.getElementById('hc-auto-height-style')
  if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle)
  const oldScript = doc.getElementById('hc-auto-height-probe')
  if (oldScript && oldScript.parentNode) oldScript.parentNode.removeChild(oldScript)

  const styleEl = doc.createElement('style')
  styleEl.id = 'hc-auto-height-style'
  styleEl.textContent = 'html,body{margin:0;overflow:hidden!important;}'

  const scriptEl = doc.createElement('script')
  scriptEl.id = 'hc-auto-height-probe'
  scriptEl.textContent = `(() => {
  const TOKEN = ${JSON.stringify(token)};
  let last = 0;
  let raf = 0;
  function height() {
    const de = document.documentElement;
    const b = document.body;
    const h = Math.max(
      de ? de.scrollHeight : 0,
      b ? b.scrollHeight : 0,
      de ? Math.ceil(de.getBoundingClientRect().height) : 0,
    );
    return h || 0;
  }
  function post(h) {
    try { parent.postMessage({ __hcAutoHeight: true, token: TOKEN, height: h }, '*'); } catch {}
  }
  function tick() {
    raf = 0;
    const h = height();
    if (Math.abs(h - last) > 1) { last = h; post(h); }
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }
  try {
    const ro = new ResizeObserver(() => schedule());
    if (document.documentElement) ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  } catch {}
  try {
    new MutationObserver(() => schedule()).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch {}
  window.addEventListener('load', () => schedule());
  document.addEventListener('DOMContentLoaded', () => schedule());
  schedule();
})();`

  head.appendChild(styleEl)
  head.appendChild(scriptEl)

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

export function AutoHeightHtmlIframe(props: Props) {
  const { html, minHeightPx = 240 } = props
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const tokenRef = React.useRef<string>('')
  if (!tokenRef.current) tokenRef.current = createToken()

  const [heightPx, setHeightPx] = React.useState<number>(minHeightPx)

  const srcDoc = React.useMemo(() => injectAutoHeightProbe(html, tokenRef.current), [html])

  React.useEffect(() => {
    setHeightPx(minHeightPx)
  }, [html, minHeightPx])

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const iframeWin = iframeRef.current?.contentWindow
      if (!iframeWin || event.source !== iframeWin) return
      const msg: any = event.data
      if (!msg || msg.__hcAutoHeight !== true) return
      if (String(msg.token || '') !== tokenRef.current) return
      const h = Number(msg.height || 0)
      if (!Number.isFinite(h) || h <= 0) return
      setHeightPx(Math.max(minHeightPx, Math.min(20000, Math.ceil(h))))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [minHeightPx])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      scrolling="no"
      style={{
        display: 'block',
        width: '100%',
        height: heightPx,
        border: 'none',
      }}
    />
  )
}
