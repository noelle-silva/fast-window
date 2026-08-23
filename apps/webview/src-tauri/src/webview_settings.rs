use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::app_config;

const MAX_VIDEO_RATE: f64 = 16.0;
const MAX_PRESETS: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct WebviewVideoSpeedPreset {
    pub(crate) label: String,
    pub(crate) rate: f64,
    pub(crate) shortcut: Option<String>,
}

impl Default for WebviewVideoSpeedPreset {
    fn default() -> Self {
        Self {
            label: String::new(),
            rate: 1.0,
            shortcut: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct WebviewVideoSettings {
    pub(crate) default_rate: f64,
    pub(crate) max_rate: f64,
    pub(crate) presets: Vec<WebviewVideoSpeedPreset>,
}

impl Default for WebviewVideoSettings {
    fn default() -> Self {
        Self {
            default_rate: 1.0,
            max_rate: MAX_VIDEO_RATE,
            presets: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct WebviewSettings {
    pub(crate) video: WebviewVideoSettings,
}

impl Default for WebviewSettings {
    fn default() -> Self {
        Self {
            video: WebviewVideoSettings::default(),
        }
    }
}

pub(crate) fn clamp_video_rate(rate: f64, max_rate: f64) -> f64 {
    let max = MAX_VIDEO_RATE.min(max_rate.max(0.25));
    let v = if rate.is_finite() { rate } else { 1.0 };
    v.max(0.25).min(max)
}

fn normalize_shortcut(raw: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for p in raw.split('+') {
        let p = p.trim();
        if p.is_empty() {
            return None;
        }
        parts.push(p);
    }
    Some(parts.join("+"))
}

fn sanitize_webview_settings_for_load(mut settings: WebviewSettings) -> WebviewSettings {
    settings.video.max_rate = clamp_video_rate(settings.video.max_rate, MAX_VIDEO_RATE);
    settings.video.default_rate = clamp_video_rate(settings.video.default_rate, settings.video.max_rate);

    let mut seen_shortcuts: HashMap<String, ()> = HashMap::new();
    let mut presets: Vec<WebviewVideoSpeedPreset> = Vec::new();
    for mut p in settings.video.presets.into_iter().take(MAX_PRESETS) {
        p.rate = clamp_video_rate(p.rate, settings.video.max_rate);
        p.label = p.label.trim().to_string();
        if p.label.is_empty() {
            p.label = format!("{}x", p.rate);
        }

        p.shortcut = match p.shortcut.take().and_then(|s| normalize_shortcut(&s)) {
            Some(normalized) => {
                if seen_shortcuts.contains_key(&normalized) {
                    None
                } else {
                    seen_shortcuts.insert(normalized.clone(), ());
                    Some(normalized)
                }
            }
            None => None,
        };

        presets.push(p);
    }

    settings.video.presets = presets;
    settings
}

fn validate_webview_settings_for_save(
    mut settings: WebviewSettings,
) -> Result<WebviewSettings, String> {
    settings.video.max_rate = clamp_video_rate(settings.video.max_rate, MAX_VIDEO_RATE);
    settings.video.default_rate = clamp_video_rate(settings.video.default_rate, settings.video.max_rate);

    let mut seen_shortcuts: HashMap<String, ()> = HashMap::new();
    let mut presets: Vec<WebviewVideoSpeedPreset> = Vec::new();
    for p in settings.video.presets.into_iter().take(MAX_PRESETS) {
        let mut p = p;
        p.rate = clamp_video_rate(p.rate, settings.video.max_rate);
        p.label = p.label.trim().to_string();
        if p.label.is_empty() {
            p.label = format!("{}x", p.rate);
        }

        if let Some(raw) = p.shortcut.take() {
            let raw = raw.trim().to_string();
            if raw.is_empty() {
                p.shortcut = None;
            } else {
                let Some(normalized) = normalize_shortcut(&raw) else {
                    return Err("预设快捷键格式不合法".to_string());
                };
                if seen_shortcuts.contains_key(&normalized) {
                    return Err(format!("快捷键重复: {}", normalized));
                }
                seen_shortcuts.insert(normalized.clone(), ());
                p.shortcut = Some(normalized);
            }
        }
        presets.push(p);
    }
    settings.video.presets = presets;
    Ok(settings)
}

pub(crate) fn load(app: &tauri::AppHandle) -> WebviewSettings {
    let map = app_config::read_app_config_map(app);
    let v = map
        .get(app_config::WEBVIEW_SETTINGS_KEY)
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let parsed = serde_json::from_value::<WebviewSettings>(v).unwrap_or_default();
    sanitize_webview_settings_for_load(parsed)
}

pub(crate) fn save(app: &tauri::AppHandle, settings: WebviewSettings) -> Result<WebviewSettings, String> {
    let normalized = validate_webview_settings_for_save(settings)?;
    app_config::update_app_config_map(app, |map| {
        map.insert(
            app_config::WEBVIEW_SETTINGS_KEY.to_string(),
            serde_json::to_value(normalized.clone()).map_err(|e| format!("序列化配置失败: {e}"))?,
        );
        Ok(())
    })?;
    Ok(normalized)
}

/// 注入网页的"视频倍速"运行时脚本（与宿主行为一致）。
pub(crate) fn browser_video_injection_script(video: &WebviewVideoSettings) -> Result<String, String> {
    let json = serde_json::to_string(video).map_err(|e| format!("序列化配置失败: {e}"))?;
    let quoted = serde_json::to_string(&json).map_err(|e| format!("序列化配置失败: {e}"))?;

    Ok(format!(
        r#"(function () {{
  const cfg = JSON.parse({quoted});
  const clamp = (r) => {{
    const max = (Number.isFinite(cfg.maxRate) ? cfg.maxRate : 16);
    const max2 = Math.min(16, Math.max(0.25, max));
    const v = (Number.isFinite(r) ? r : 1);
    return Math.min(max2, Math.max(0.25, v));
  }};

  const normalizeEvent = (e) => {{
    const parts = [];
    if (e.ctrlKey) parts.push('control');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('super');
    const code = typeof e.code === 'string' ? e.code : '';
    if (!code || code === 'Unidentified') return null;
    parts.push(code);
    return parts.join('+');
  }};

  const isEditable = (t) => {{
    try {{
      const el = t && t.nodeType === 1 ? t : null;
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      if (typeof el.closest === 'function' && el.closest('[contenteditable="true"],[role="textbox"]')) return true;
      return false;
    }} catch (_) {{
      return false;
    }}
  }};

  const applyRate = (rate) => {{
    const r = clamp(rate);
    const list = document.querySelectorAll('video');
    for (const v of list) {{
      try {{
        v.playbackRate = r;
        v.defaultPlaybackRate = r;
      }} catch (_) {{}}
    }}
    return r;
  }};

  const ensure = () => {{
    const r = applyRate(cfg.defaultRate);
    window.__fastwindowVideoSpeedCurrentRate = r;
    window.__fastwindowVideoSpeedToggleState = {{ activeKey: null, prevRate: null }};
  }};

  if (!window.__fastwindowVideoSpeedInstalled) {{
    window.__fastwindowVideoSpeedInstalled = true;

    window.__fastwindowVideoSpeedApplyRate = (rate) => {{
      const r = applyRate(rate);
      window.__fastwindowVideoSpeedCurrentRate = r;
      return r;
    }};

    window.__fastwindowVideoSpeedTogglePreset = (key, rate) => {{
      try {{
        const st = window.__fastwindowVideoSpeedToggleState || {{ activeKey: null, prevRate: null }};
        if (st.activeKey === key) {{
          const back = (typeof st.prevRate === 'number') ? st.prevRate : cfg.defaultRate;
          st.activeKey = null;
          st.prevRate = null;
          window.__fastwindowVideoSpeedToggleState = st;
          return window.__fastwindowVideoSpeedApplyRate(back);
        }}
        const cur = (typeof window.__fastwindowVideoSpeedCurrentRate === 'number')
          ? window.__fastwindowVideoSpeedCurrentRate
          : cfg.defaultRate;
        st.activeKey = key;
        st.prevRate = cur;
        window.__fastwindowVideoSpeedToggleState = st;
        return window.__fastwindowVideoSpeedApplyRate(rate);
      }} catch (_) {{
        return window.__fastwindowVideoSpeedApplyRate(rate);
      }}
    }};

    window.addEventListener('keydown', (e) => {{
      try {{
        if (e.repeat) return;
        if (isEditable(e.target)) return;
        const key = normalizeEvent(e);
        if (!key) return;
        const presets = Array.isArray(window.__fastwindowVideoSpeedConfig?.presets)
          ? window.__fastwindowVideoSpeedConfig.presets
          : [];
        for (const p of presets) {{
          if (!p || typeof p.shortcut !== 'string') continue;
          if (p.shortcut === key && typeof p.rate === 'number') {{
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            window.__fastwindowVideoSpeedTogglePreset(key, p.rate);
            return;
          }}
        }}
      }} catch (_) {{}}
    }}, true);

    let scheduled = false;
    const scheduleApply = () => {{
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {{
        scheduled = false;
        try {{
          if (typeof window.__fastwindowVideoSpeedCurrentRate !== 'number') return;
          applyRate(window.__fastwindowVideoSpeedCurrentRate);
        }} catch (_) {{}}
      }}, 200);
    }};
    const obs = new MutationObserver(scheduleApply);
    obs.observe(document.documentElement || document, {{ childList: true, subtree: true }});
  }}

  window.__fastwindowVideoSpeedConfig = cfg;
  ensure();
}})();"#,
    ))
}
