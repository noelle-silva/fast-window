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
  const style = `<style id="hc-auto-height-style">html,body{margin:0;overflow:hidden!important;}</style>`
  const script = `<script id="hc-auto-height-probe">(()=>{const TOKEN=${JSON.stringify(
    token,
  )};let last=0;let raf=0;function height(){const de=document.documentElement;const b=document.body;const h=Math.max(de?de.scrollHeight:0,b?b.scrollHeight:0,de?Math.ceil(de.getBoundingClientRect().height):0);return h||0;}function post(h){try{parent.postMessage({__hcAutoHeight:true,token:TOKEN,height:h},'*');}catch{}}function tick(){raf=0;const h=height();if(Math.abs(h-last)>1){last=h;post(h);}}function schedule(){if(raf) return;raf=requestAnimationFrame(tick);}try{const ro=new ResizeObserver(()=>schedule());if(document.documentElement) ro.observe(document.documentElement);if(document.body) ro.observe(document.body);}catch{}try{new MutationObserver(()=>schedule()).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});}catch{}window.addEventListener('load',()=>schedule());document.addEventListener('DOMContentLoaded',()=>schedule());schedule();})();</script>`

  const raw = String(src || '')

  if (/<\/head\s*>/i.test(raw)) {
    return raw.replace(/<\/head\s*>/i, `${style}${script}</head>`)
  }
  if (/<head\b[^>]*>/i.test(raw)) {
    return raw.replace(/<head\b[^>]*>/i, (m) => `${m}${style}${script}`)
  }
  if (/<html\b[^>]*>/i.test(raw)) {
    return raw.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${style}${script}</head>`)
  }

  // Fragment HTML
  return `<!doctype html><html><head><meta charset="utf-8" />${style}${script}</head><body>${raw}</body></html>`
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

