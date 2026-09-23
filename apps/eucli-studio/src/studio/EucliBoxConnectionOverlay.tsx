import * as React from 'react'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { compatibilityRangeText, type StudioBootstrap } from '../domain/release'
import { StandaloneWindowControls, type WindowControlActions } from '../ui/components/StandaloneWindowControls'
import type { EucliBoxConfig, EucliBoxConfigInput } from './aiChatAppHost'

type EucliBoxConnectionOverlayProps = {
  bootstrap: StudioBootstrap
  issue: string
  standalone: boolean
  windowControlActions: WindowControlActions
  onStartDragging: () => void
  onLoadConfig: () => Promise<EucliBoxConfig>
  onSaveConfig: (config: EucliBoxConfigInput) => Promise<EucliBoxConfig>
  onApply: () => Promise<void> | void
}

// EucliBoxConnectionOverlay 是未连接业务端时叠加在会话界面之上的连接窗口：
// 透明遮罩负责挡住外壳交互，窗口只负责「填写连接信息 → 保存并连接」。
export function EucliBoxConnectionOverlay(props: EucliBoxConnectionOverlayProps) {
  const { bootstrap, issue, standalone, windowControlActions, onStartDragging, onLoadConfig, onSaveConfig, onApply } = props
  const [url, setUrl] = React.useState('')
  const [key, setKey] = React.useState('')
  const [keyVisible, setKeyVisible] = React.useState(false)
  const [configReady, setConfigReady] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')

  React.useEffect(() => {
    let disposed = false
    void onLoadConfig()
      .then((config) => {
        if (disposed) return
        setUrl(config.eucliBoxUrl || '')
        setKey(config.eucliBoxKey || '')
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) setConfigReady(true)
      })
    return () => {
      disposed = true
    }
  }, [onLoadConfig])

  const canSubmit = configReady && !saving && !!url.trim()
  const problem = saveError || issue

  const submit = React.useCallback(async () => {
    if (!canSubmit) return
    setSaving(true)
    setSaveError('')
    try {
      await onSaveConfig({ eucliBoxUrl: url.trim().replace(/\/+$/, ''), eucliBoxKey: key.trim(), eucliBoxDisconnected: false })
      await onApply()
    } catch (error: any) {
      setSaveError(String(error?.message || error || '保存连接配置失败'))
    } finally {
      setSaving(false)
    }
  }, [canSubmit, key, onApply, onSaveConfig, url])

  const onOverlayPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    onStartDragging()
  }, [onStartDragging])

  return (
    <div className="eucliConnectOverlay" role="dialog" aria-modal="true" aria-labelledby="eucliConnectTitle" onPointerDown={onOverlayPointerDown}>
      {standalone ? (
        <div className="eucliConnectWindowControls">
          <StandaloneWindowControls actions={windowControlActions} />
        </div>
      ) : null}
      <section className="eucliConnectDialog">
        <h1 id="eucliConnectTitle" className="eucliConnectTitle">连接 eucli-box</h1>
        <p className="eucliConnectHint">填写业务端地址与访问 Key，连接成功后进入会话。</p>
        <dl className="releaseFacts">
          <div><dt>客户端版本</dt><dd>{bootstrap.clientVersion || '版本资料无效'}</dd></div>
          <div><dt>所需本体范围</dt><dd>{compatibilityRangeText(bootstrap.clientEucliBoxCompatibility)}</dd></div>
          {bootstrap.eucliBoxVersion ? <div><dt>业务端版本</dt><dd>{bootstrap.eucliBoxVersion}</dd></div> : null}
        </dl>
        <form
          className="eucliConnectForm"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="eucliConnectField" htmlFor="eucliBoxUrl">业务端地址（网关）
            <input id="eucliBoxUrl" type="text" placeholder="http://127.0.0.1:8765" value={url} disabled={!configReady || saving} onChange={(event) => setUrl(event.target.value)} />
          </label>
          <label className="eucliConnectField" htmlFor="eucliBoxKey">访问 Key
            <span className="eucliConnectSecret">
              <input
                id="eucliBoxKey"
                type={keyVisible ? 'text' : 'password'}
                placeholder="业务端长期 Key"
                value={key}
                disabled={!configReady || saving}
                onChange={(event) => setKey(event.target.value)}
              />
              <button
                type="button"
                className="eucliConnectReveal"
                aria-label={keyVisible ? '隐藏访问 Key' : '显示访问 Key'}
                title={keyVisible ? '隐藏访问 Key' : '显示访问 Key'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setKeyVisible((visible) => !visible)}
              >
                {keyVisible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </button>
            </span>
          </label>
          <button type="submit" disabled={!canSubmit}>{saving ? '连接中…' : '保存并连接'}</button>
        </form>
        {problem ? <div className="eucliConnectIssue" role="alert">{problem}</div> : null}
      </section>
    </div>
  )
}
