import * as React from 'react'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { CircularProgress } from '@mui/material'
import { compatibilityRangeText, type StudioBootstrap } from '../domain/release'
import { StandaloneWindowControls, type WindowControlActions } from '../ui/components/StandaloneWindowControls'
import type { EucliBoxConfig, EucliBoxConfigInput } from './aiChatAppHost'

export type EucliBoxConnectionPhase = 'loading' | 'error' | 'form'

type EucliBoxConnectionOverlayProps = {
  phase: EucliBoxConnectionPhase
  issue?: string
  standalone: boolean
  windowControlActions: WindowControlActions
  onStartDragging: () => void
  bootstrap?: StudioBootstrap
  onLoadConfig?: () => Promise<EucliBoxConfig>
  onSaveConfig?: (config: EucliBoxConfigInput) => Promise<EucliBoxConfig>
  onApply?: () => Promise<void> | void
  onPickDataDir?: () => Promise<void> | void
  dataDirBusy?: boolean
}

// EucliBoxConnectionOverlay 是客户端唯一的「连接窗口」外壳：透明遮罩 + 居中窗口。
// 三种内容态共享同一外壳：启动加载中 / 启动问题 / 连接表单。
export function EucliBoxConnectionOverlay(props: EucliBoxConnectionOverlayProps) {
  const { phase, issue, standalone, windowControlActions, onStartDragging, bootstrap, onLoadConfig, onSaveConfig, onApply, onPickDataDir, dataDirBusy } = props
  const [url, setUrl] = React.useState('')
  const [key, setKey] = React.useState('')
  const [keyVisible, setKeyVisible] = React.useState(false)
  const [configReady, setConfigReady] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')

  React.useEffect(() => {
    if (phase !== 'form') return
    let disposed = false
    const load = onLoadConfig
    if (typeof load !== 'function') {
      setConfigReady(true)
      return () => {
        disposed = true
      }
    }
    void load()
      .then((config) => {
        if (disposed) return
        setUrl(String(config?.eucliBoxUrl || ''))
        setKey(String(config?.eucliBoxKey || ''))
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) setConfigReady(true)
      })
    return () => {
      disposed = true
    }
  }, [phase, onLoadConfig])

  const canSubmit = configReady && !saving && !!url.trim()
  const problem = saveError || (phase === 'form' ? String(issue || '') : '')

  const submit = React.useCallback(async () => {
    if (!canSubmit || typeof onSaveConfig !== 'function' || typeof onApply !== 'function') return
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
        {phase === 'loading' ? (
          <div className="eucliConnectLoading" role="status" aria-live="polite">
            <CircularProgress size={22} thickness={4.5} sx={{ color: '#4763e4' }} />
            <span>正在连接本机后台，请稍候…</span>
          </div>
        ) : null}
        {phase === 'error' ? (
          <>
            {issue ? <div className="eucliConnectIssue" role="alert">{issue}</div> : null}
            {typeof onPickDataDir === 'function' ? (
              <div className="eucliConnectActions">
                <button type="button" disabled={!!dataDirBusy} onClick={() => { void onPickDataDir() }}>
                  {dataDirBusy ? '处理中…' : '选择可写数据目录'}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {phase === 'form' ? (
          <>
            <p className="eucliConnectHint">填写业务端地址与访问 Key，连接成功后进入会话。</p>
            {bootstrap ? (
              <dl className="releaseFacts">
                <div><dt>客户端版本</dt><dd>{bootstrap.clientVersion || '版本资料无效'}</dd></div>
                <div><dt>所需本体范围</dt><dd>{compatibilityRangeText(bootstrap.clientEucliBoxCompatibility)}</dd></div>
                {bootstrap.eucliBoxVersion ? <div><dt>业务端版本</dt><dd>{bootstrap.eucliBoxVersion}</dd></div> : null}
              </dl>
            ) : null}
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
                    type={key && !keyVisible ? 'password' : 'text'}
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
          </>
        ) : null}
      </section>
    </div>
  )
}
