//! 网页图标发现：抓取页面、收集图标来源、按内容去重、逐个产出候选。
//!
//! 来源与优先级：manifest / 内联 SVG / 品牌 Logo / 作者头像 / Apple Touch /
//! Mask / Fluid / Favicon / Windows 磁贴 / 站点 Logo 路径 / 约定路径。

use std::collections::HashMap;
use std::time::Duration;

use base64::engine::general_purpose;
use base64::Engine as _;
use serde::Serialize;
use sha1::{Digest, Sha1};

use crate::collections::assets;

const MAX_HTML_BYTES: usize = 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 512 * 1024;
const MAX_INLINE_SVG_BYTES: usize = 160 * 1024;
const MAX_CANDIDATES: usize = 24;
const MAX_FETCH_REFS: usize = 48;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const USER_AGENT: &str = "FastWindowWebview/1.0 WebIconDiscovery";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebIconCandidate {
    pub id: String,
    pub label: String,
    pub source: String,
    pub url: String,
    pub media_type: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub sizes: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebIconDiscoveryResult {
    pub url: String,
    pub candidates: Vec<WebIconCandidate>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct WebIconRef {
    url: String,
    label: String,
    source: String,
    media_type: String,
    sizes: String,
    priority: i64,
    order: usize,
}

#[derive(Debug)]
struct HtmlTag {
    name: String,
    attrs: HashMap<String, String>,
}

/// 发现网页图标。每个成功抓取并保存的候选会经 `on_candidate` 处理（导入资产、上报进度），
/// 处理结果作为最终候选返回。
pub async fn discover<F>(
    raw_url: &str,
    mut on_candidate: F,
) -> Result<WebIconDiscoveryResult, String>
where
    F: FnMut(WebIconCandidate) -> Result<WebIconCandidate, String> + Send,
{
    let target_url = raw_url.trim().to_string();
    let mut target = crate::collections::model::CollectionTarget {
        kind: "url".to_string(),
        url: target_url,
    };
    crate::collections::model::normalize_target(&mut target);
    crate::collections::model::validate_target(&target)?;

    let client = build_client()?;
    let (html_bytes, page_url) = fetch_resource(
        &client,
        &target.url,
        MAX_HTML_BYTES,
        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.6",
    )
    .await
    .map_err(|e| format!("fetch web page failed: {e}"))?;
    let html = String::from_utf8_lossy(&html_bytes).to_string();

    let (mut refs, mut warnings) = discover_refs(&client, &page_url, &html).await?;
    let conventional = conventional_web_icon_refs(&page_url, refs.len());
    let logo_paths = common_logo_path_refs(&page_url, refs.len() + conventional.len());
    refs.extend(logo_paths);
    refs.extend(conventional);
    let refs = normalize_web_icon_refs(refs);

    let mut candidates = Vec::new();
    let mut seen_payloads = std::collections::HashSet::new();
    for reference in refs {
        if candidates.len() >= MAX_CANDIDATES {
            break;
        }
        let fetched = match fetch_web_icon_candidate(&client, &reference).await {
            Ok(fetched) => fetched,
            Err(err) => {
                warnings.push(format!("{}: {err}", reference.url));
                continue;
            }
        };
        if !seen_payloads.insert(fetched.payload_hash.clone()) {
            continue;
        }
        let candidate = on_candidate(fetched.candidate)?;
        candidates.push(candidate);
    }

    if candidates.is_empty() {
        if warnings.is_empty() {
            return Err("no usable web icons found".to_string());
        }
        return Err(format!(
            "no usable web icons found: {}",
            limit_strings(&warnings, 4).join("; ")
        ));
    }
    Ok(WebIconDiscoveryResult {
        url: page_url.to_string(),
        candidates,
        warnings: limit_strings(&warnings, 8),
    })
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "too many redirects",
                ))
            } else if attempt.url().scheme() != "http" && attempt.url().scheme() != "https" {
                attempt.error(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "redirect target must be http or https",
                ))
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| format!("create web icon client failed: {e}"))
}

async fn fetch_resource(
    client: &reqwest::Client,
    raw_url: &str,
    max_bytes: usize,
    accept: &str,
) -> Result<(Vec<u8>, url::Url), String> {
    let parsed = url::Url::parse(raw_url.trim())
        .map_err(|_| "valid http or https url is required".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("valid http or https url is required".to_string());
    }
    let response = client
        .get(parsed)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, accept)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "unexpected HTTP status {}",
            response.status().as_u16()
        ));
    }
    if let Some(length) = response.content_length() {
        if length > max_bytes as u64 {
            return Err(format!("response is too large: max {max_bytes} bytes"));
        }
    }
    let final_url = response.url().clone();
    let payload = response.bytes().await.map_err(|e| e.to_string())?;
    if payload.len() > max_bytes {
        return Err(format!("response is too large: max {max_bytes} bytes"));
    }
    Ok((payload.to_vec(), final_url))
}

async fn discover_refs(
    client: &reqwest::Client,
    page_url: &url::Url,
    html: &str,
) -> Result<(Vec<WebIconRef>, Vec<String>), String> {
    let mut refs: Vec<WebIconRef> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut base_url = page_url.clone();
    let mut base_seen = false;
    let mut order = 0usize;

    for tag in scan_html_tags(html) {
        match tag.name.as_str() {
            "base" => {
                if base_seen {
                    continue;
                }
                if let Some(href) = attr(&tag, "href") {
                    if let Some(resolved) = resolve_web_icon_url(&base_url, &href) {
                        if !resolved.to_ascii_lowercase().starts_with("data:")
                            && (resolved.starts_with("http://") || resolved.starts_with("https://"))
                        {
                            if let Ok(next_base) = url::Url::parse(&resolved) {
                                base_url = next_base;
                                base_seen = true;
                            }
                        }
                    }
                }
            }
            "link" => {
                let (link_refs, manifest_url) = web_icon_refs_from_link_tag(&base_url, &tag, order);
                order += link_refs.len();
                refs.extend(link_refs);
                if let Some(manifest_url) = manifest_url {
                    let (manifest_refs, manifest_warnings) =
                        discover_manifest_icon_refs(client, &manifest_url, order).await;
                    order += manifest_refs.len();
                    refs.extend(manifest_refs);
                    warnings.extend(manifest_warnings);
                }
            }
            "meta" => {
                let meta_refs = web_icon_refs_from_meta_tag(&base_url, &tag, order);
                order += meta_refs.len();
                refs.extend(meta_refs);
            }
            "img" | "source" => {
                let image_refs = web_icon_refs_from_image_tag(&base_url, &tag, order);
                order += image_refs.len();
                refs.extend(image_refs);
            }
            _ => {}
        }
    }

    let inline_svg_refs = web_icon_refs_from_inline_svg(html, order);
    refs.extend(inline_svg_refs);
    Ok((refs, warnings))
}

fn web_icon_refs_from_link_tag(
    base_url: &url::Url,
    tag: &HtmlTag,
    order: usize,
) -> (Vec<WebIconRef>, Option<String>) {
    let rel = attr(tag, "rel").unwrap_or_default();
    let Some(href) = attr(tag, "href") else {
        return (Vec::new(), None);
    };
    if rel.is_empty() || href.is_empty() {
        return (Vec::new(), None);
    }
    let Some(resolved) = resolve_web_icon_url(base_url, &href) else {
        return (Vec::new(), None);
    };
    let tokens = rel_tokens(&rel);
    if has_rel_token(&tokens, "manifest") {
        return (Vec::new(), Some(resolved));
    }
    let Some((label, source, priority)) = classify_link_icon_rel(&tokens) else {
        return (Vec::new(), None);
    };
    (
        vec![WebIconRef {
            url: resolved,
            label: label.to_string(),
            source: source.to_string(),
            media_type: attr(tag, "type").unwrap_or_default(),
            sizes: attr(tag, "sizes").unwrap_or_default(),
            priority,
            order,
        }],
        None,
    )
}

fn web_icon_refs_from_meta_tag(base_url: &url::Url, tag: &HtmlTag, order: usize) -> Vec<WebIconRef> {
    let name = attr(tag, "name")
        .or_else(|| attr(tag, "property"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let Some(content) = attr(tag, "content") else {
        return Vec::new();
    };
    if name.is_empty() || content.is_empty() {
        return Vec::new();
    }
    let Some(resolved) = resolve_web_icon_url(base_url, &content) else {
        return Vec::new();
    };
    if name.starts_with("msapplication-")
        && (name.contains("image") || name.contains("logo") || name.contains("tileimage"))
    {
        return vec![WebIconRef {
            url: resolved,
            label: "Windows 磁贴图标".to_string(),
            source: "meta".to_string(),
            media_type: String::new(),
            sizes: String::new(),
            priority: 42,
            order,
        }];
    }
    let avatar_names = [
        "avatar",
        "author:image",
        "profile:image",
        "profile:avatar",
        "twitter:creator:image",
        "twitter:site:image",
    ];
    if avatar_names.contains(&name.as_str()) {
        return vec![WebIconRef {
            url: resolved,
            label: "作者头像".to_string(),
            source: "avatar".to_string(),
            media_type: String::new(),
            sizes: String::new(),
            priority: 13,
            order,
        }];
    }
    Vec::new()
}

fn web_icon_refs_from_image_tag(
    base_url: &url::Url,
    tag: &HtmlTag,
    order: usize,
) -> Vec<WebIconRef> {
    let semantic = html_tag_semantic_text(tag);
    let (label, source, priority) = if has_logo_semantic(&semantic) {
        ("网站 Logo", "brand-logo", 12)
    } else if has_avatar_semantic(&semantic) {
        ("作者头像", "avatar", 13)
    } else {
        return Vec::new();
    };
    let Some(image_url) = image_url_from_tag(tag) else {
        return Vec::new();
    };
    let Some(resolved) = resolve_web_icon_url(base_url, &image_url) else {
        return Vec::new();
    };
    vec![WebIconRef {
        url: resolved,
        label: label.to_string(),
        source: source.to_string(),
        media_type: attr(tag, "type").unwrap_or_default(),
        sizes: image_tag_sizes(tag),
        priority,
        order,
    }]
}

fn image_tag_sizes(tag: &HtmlTag) -> String {
    let sizes = attr(tag, "sizes").unwrap_or_default();
    if !sizes.is_empty() {
        return sizes;
    }
    let width = attr(tag, "width").unwrap_or_default();
    let height = attr(tag, "height").unwrap_or_default();
    if width.is_empty() || height.is_empty() {
        return String::new();
    }
    format!("{width}x{height}")
}

fn web_icon_refs_from_inline_svg(html: &str, order: usize) -> Vec<WebIconRef> {
    let mut refs = Vec::new();
    let mut search_from = 0usize;
    let lower = html.to_ascii_lowercase();
    while search_from < html.len() {
        let Some(start_offset) = lower[search_from..].find("<svg") else {
            break;
        };
        let start = search_from + start_offset;
        let Some(start_end) = html_tag_end(html, start + 1) else {
            break;
        };
        let (name, attrs) = parse_html_tag_content(&html[start + 1..start_end]);
        if name != "svg" {
            search_from = start_end + 1;
            continue;
        }
        let Some(close_offset) = lower[start_end + 1..].find("</svg>") else {
            search_from = start_end + 1;
            continue;
        };
        let end = start_end + 1 + close_offset + "</svg>".len();
        let markup = &html[start..end];
        search_from = end;
        let tag = HtmlTag {
            name: "svg".to_string(),
            attrs,
        };
        if markup.len() > MAX_INLINE_SVG_BYTES || !has_logo_semantic(&html_tag_semantic_text(&tag)) {
            continue;
        }
        let data_url = format!(
            "data:image/svg+xml;base64,{}",
            general_purpose::STANDARD.encode(markup.as_bytes())
        );
        refs.push(WebIconRef {
            url: data_url,
            label: "内联 SVG Logo".to_string(),
            source: "inline-svg".to_string(),
            media_type: "image/svg+xml".to_string(),
            sizes: String::new(),
            priority: 11,
            order: order + refs.len(),
        });
    }
    refs
}

fn common_logo_path_refs(page_url: &url::Url, order: usize) -> Vec<WebIconRef> {
    let paths = [
        "/logo.svg",
        "/logo.png",
        "/brand.svg",
        "/brand.png",
        "/assets/logo.svg",
        "/assets/logo.png",
        "/static/logo.svg",
        "/static/logo.png",
    ];
    paths
        .iter()
        .enumerate()
        .filter_map(|(index, path)| {
            let mut base = page_url.clone();
            base.set_path(path);
            base.set_query(None);
            base.set_fragment(None);
            Some(WebIconRef {
                url: base.to_string(),
                label: "站点 Logo".to_string(),
                source: "site-logo".to_string(),
                media_type: String::new(),
                sizes: String::new(),
                priority: 64 + index as i64,
                order: order + index,
            })
        })
        .collect()
}

fn conventional_web_icon_refs(page_url: &url::Url, order: usize) -> Vec<WebIconRef> {
    let paths = [
        ("/favicon.ico", "约定 Favicon", 70),
        ("/favicon.png", "约定 PNG 图标", 72),
        ("/apple-touch-icon.png", "约定 Apple 图标", 74),
        ("/apple-touch-icon-precomposed.png", "约定 Apple 图标", 76),
    ];
    paths
        .iter()
        .enumerate()
        .map(|(index, (path, label, priority))| {
            let mut base = page_url.clone();
            base.set_path(path);
            base.set_query(None);
            base.set_fragment(None);
            WebIconRef {
                url: base.to_string(),
                label: label.to_string(),
                source: "conventional".to_string(),
                media_type: String::new(),
                sizes: String::new(),
                priority: *priority,
                order: order + index,
            }
        })
        .collect()
}

async fn discover_manifest_icon_refs(
    client: &reqwest::Client,
    manifest_url: &str,
    order: usize,
) -> (Vec<WebIconRef>, Vec<String>) {
    let fetched = fetch_resource(
        client,
        manifest_url,
        MAX_MANIFEST_BYTES,
        "application/manifest+json,application/json,*/*;q=0.6",
    )
    .await;
    let (payload, final_url) = match fetched {
        Ok(result) => result,
        Err(err) => return (Vec::new(), vec![format!("manifest {manifest_url}: {err}")]),
    };
    #[derive(serde::Deserialize)]
    struct Manifest {
        #[serde(default)]
        icons: Vec<ManifestIcon>,
    }
    #[derive(serde::Deserialize)]
    struct ManifestIcon {
        #[serde(default)]
        src: String,
        #[serde(default)]
        sizes: String,
        #[serde(default)]
        r#type: String,
    }
    let manifest: Manifest = match serde_json::from_slice(&payload) {
        Ok(manifest) => manifest,
        Err(err) => {
            return (
                Vec::new(),
                vec![format!("manifest {manifest_url}: parse failed: {err}")],
            )
        }
    };
    let mut refs = Vec::new();
    for (index, icon) in manifest.icons.iter().enumerate() {
        let Some(resolved) = resolve_web_icon_url(&final_url, &icon.src) else {
            continue;
        };
        refs.push(WebIconRef {
            url: resolved,
            label: "Manifest 图标".to_string(),
            source: "manifest".to_string(),
            media_type: icon.r#type.trim().to_string(),
            sizes: icon.sizes.trim().to_string(),
            priority: manifest_icon_priority(&icon.sizes),
            order: order + index,
        });
    }
    (refs, Vec::new())
}

fn manifest_icon_priority(sizes: &str) -> i64 {
    let max_size = max_declared_icon_size(sizes);
    if max_size >= 512 {
        8
    } else if max_size >= 192 {
        10
    } else if max_size >= 128 {
        18
    } else if max_size >= 64 {
        26
    } else {
        36
    }
}

fn normalize_web_icon_refs(refs: Vec<WebIconRef>) -> Vec<WebIconRef> {
    let mut by_url: HashMap<String, WebIconRef> = HashMap::new();
    for mut reference in refs {
        let url = reference.url.trim().to_string();
        if url.is_empty() {
            continue;
        }
        let Some(key) = normalized_web_icon_ref_key(&url) else {
            continue;
        };
        let replace = by_url
            .get(&key)
            .map(|current| reference.priority < current.priority)
            .unwrap_or(true);
        if replace {
            reference.url = url;
            by_url.insert(key, reference);
        }
    }
    let mut next: Vec<WebIconRef> = by_url.into_values().collect();
    next.sort_by_key(|reference| (reference.priority, reference.order));
    next.truncate(MAX_FETCH_REFS);
    next
}

fn normalized_web_icon_ref_key(raw_url: &str) -> Option<String> {
    if raw_url.to_ascii_lowercase().starts_with("data:image/") {
        return Some(raw_url.to_string());
    }
    let parsed = url::Url::parse(raw_url).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    if parsed.host_str().map(|h| h.is_empty()).unwrap_or(true) {
        return None;
    }
    let mut parsed = parsed;
    parsed.set_fragment(None);
    Some(parsed.to_string())
}

// ── 候选抓取 ────────────────────────────────────────────────────────────────

struct FetchedCandidate {
    candidate: WebIconCandidate,
    payload_hash: String,
}

async fn fetch_web_icon_candidate(
    client: &reqwest::Client,
    reference: &WebIconRef,
) -> Result<FetchedCandidate, String> {
    let (payload, content_type, final_url) = fetch_web_icon_payload(client, &reference.url).await?;
    let (ext, media_type) = resolve_web_icon_image_type(reference, &content_type, &final_url, &payload)?;
    if payload.len() > 12 * 1024 * 1024 {
        return Err(format!(
            "web icon is too large: max {} bytes",
            12 * 1024 * 1024
        ));
    }
    assets::validate_image_content(&payload, &ext)?;

    let dimensions = assets::image_dimensions(&payload, &ext);
    let payload_hash = hex_lower(&Sha1::digest(&payload));
    let id_hash = hex_lower(&Sha1::digest(
        format!("{final_url}:{payload_hash}").as_bytes(),
    ));
    let data_url = format!(
        "data:{media_type};base64,{}",
        general_purpose::STANDARD.encode(&payload)
    );
    let (width, height) = match dimensions {
        Some((width, height)) => (Some(width), Some(height)),
        None => (None, None),
    };
    Ok(FetchedCandidate {
        candidate: WebIconCandidate {
            id: format!("web-icon:{}", &id_hash[..16]),
            label: web_icon_candidate_label(reference, width, height),
            source: reference.source.clone(),
            url: public_web_icon_url(&final_url),
            media_type,
            sizes: reference.sizes.trim().to_string(),
            width,
            height,
            asset_id: None,
            data_url: Some(data_url),
        },
        payload_hash,
    })
}

async fn fetch_web_icon_payload(
    client: &reqwest::Client,
    raw_url: &str,
) -> Result<(Vec<u8>, String, String), String> {
    let trimmed = raw_url.trim();
    if trimmed.to_ascii_lowercase().starts_with("data:image/") {
        let source = data_url_payload(trimmed)?;
        return Ok((source.bytes, source.media_type, "inline:data-url".to_string()));
    }
    let parsed = url::Url::parse(trimmed).map_err(|_| "valid icon url is required".to_string())?;
    let response = client
        .get(parsed)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.6",
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "unexpected HTTP status {}",
            response.status().as_u16()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let final_url = response.url().to_string();
    let payload = response.bytes().await.map_err(|e| e.to_string())?;
    if payload.len() > 12 * 1024 * 1024 {
        return Err(format!(
            "web icon is too large: max {} bytes",
            12 * 1024 * 1024
        ));
    }
    Ok((payload.to_vec(), content_type, final_url))
}

struct DataUrlPayload {
    bytes: Vec<u8>,
    media_type: String,
}

fn data_url_payload(data_url: &str) -> Result<DataUrlPayload, String> {
    let Some(comma) = data_url.find(',') else {
        return Err("asset data URL must be a base64 image".to_string());
    };
    let meta = data_url[..comma].to_ascii_lowercase();
    if !meta.starts_with("data:image/") || !meta.ends_with(";base64") {
        return Err("asset data URL must be a base64 image".to_string());
    }
    let media_type = meta
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("")
        .to_string();
    let bytes = general_purpose::STANDARD
        .decode(&data_url[comma + 1..])
        .map_err(|e| format!("decode asset data URL failed: {e}"))?;
    Ok(DataUrlPayload { bytes, media_type })
}

fn resolve_web_icon_image_type(
    reference: &WebIconRef,
    content_type: &str,
    final_url: &str,
    payload: &[u8],
) -> Result<(String, String), String> {
    if let Some(result) = media_type_to_ext(&reference.media_type) {
        return Ok(result);
    }
    if let Some(result) = media_type_to_ext(content_type) {
        return Ok(result);
    }
    if let Ok(parsed) = url::Url::parse(final_url) {
        let ext = std::path::Path::new(parsed.path())
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default();
        if let Some(result) = ext_to_media_type(&ext) {
            return Ok(result);
        }
    }
    if let Some(result) = sniff_image_type(payload) {
        return Ok(result);
    }
    Err("web icon content type is not supported".to_string())
}

/// media type → (规范扩展名, media type)
fn media_type_to_ext(value: &str) -> Option<(String, String)> {
    let media_type = value
        .trim()
        .to_ascii_lowercase()
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    match media_type.as_str() {
        "image/png" => Some(("png".to_string(), "image/png".to_string())),
        "image/jpeg" | "image/jpg" => Some(("jpg".to_string(), "image/jpeg".to_string())),
        "image/webp" => Some(("webp".to_string(), "image/webp".to_string())),
        "image/gif" => Some(("gif".to_string(), "image/gif".to_string())),
        "image/x-icon" | "image/vnd.microsoft.icon" | "image/ico" => {
            Some(("ico".to_string(), "image/x-icon".to_string()))
        }
        "image/svg+xml" => Some(("svg".to_string(), "image/svg+xml".to_string())),
        _ => None,
    }
}

fn ext_to_media_type(ext: &str) -> Option<(String, String)> {
    match ext.trim().trim_start_matches('.').to_ascii_lowercase().as_str() {
        "png" => Some(("png".to_string(), "image/png".to_string())),
        "jpg" | "jpeg" => Some(("jpg".to_string(), "image/jpeg".to_string())),
        "webp" => Some(("webp".to_string(), "image/webp".to_string())),
        "gif" => Some(("gif".to_string(), "image/gif".to_string())),
        "ico" => Some(("ico".to_string(), "image/x-icon".to_string())),
        "svg" => Some(("svg".to_string(), "image/svg+xml".to_string())),
        _ => None,
    }
}

fn sniff_image_type(payload: &[u8]) -> Option<(String, String)> {
    if payload.starts_with(b"\x89PNG\r\n\x1a\n") {
        return ext_to_media_type("png");
    }
    if payload.starts_with(b"\xFF\xD8\xFF") {
        return ext_to_media_type("jpg");
    }
    if payload.starts_with(b"GIF87a") || payload.starts_with(b"GIF89a") {
        return ext_to_media_type("gif");
    }
    if payload.len() >= 12 && &payload[0..4] == b"RIFF" && &payload[8..12] == b"WEBP" {
        return ext_to_media_type("webp");
    }
    if payload.len() >= 4 && payload[0] == 0 && payload[1] == 0 && payload[2] == 1 && payload[3] == 0
    {
        return ext_to_media_type("ico");
    }
    let head = &payload[..payload.len().min(256)];
    let lower = String::from_utf8_lossy(head).to_ascii_lowercase();
    if lower.contains("<svg") {
        return ext_to_media_type("svg");
    }
    None
}

fn web_icon_candidate_label(
    reference: &WebIconRef,
    width: Option<u32>,
    height: Option<u32>,
) -> String {
    let mut size_text = reference.sizes.trim().to_string();
    if size_text.is_empty() {
        if let (Some(width), Some(height)) = (width, height) {
            size_text = format!("{width}x{height}");
        }
    }
    if size_text.is_empty() {
        reference.label.clone()
    } else {
        format!("{} {}", reference.label, size_text)
    }
}

fn public_web_icon_url(raw_url: &str) -> String {
    if raw_url.to_ascii_lowercase().starts_with("data:") {
        return "inline:data-url".to_string();
    }
    raw_url.to_string()
}

fn resolve_web_icon_url(base_url: &url::Url, value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if value.to_ascii_lowercase().starts_with("data:image/") {
        return Some(value.to_string());
    }
    let resolved = base_url.join(value).ok()?;
    if resolved.scheme() != "http" && resolved.scheme() != "https" {
        return None;
    }
    if resolved.host_str().map(|h| h.is_empty()).unwrap_or(true) {
        return None;
    }
    Some(resolved.to_string())
}

// ── 语义与来源判定 ──────────────────────────────────────────────────────────

fn rel_tokens(rel: &str) -> std::collections::HashSet<String> {
    rel.to_ascii_lowercase()
        .split_whitespace()
        .map(|token| token.to_string())
        .collect()
}

fn has_rel_token(tokens: &std::collections::HashSet<String>, token: &str) -> bool {
    tokens.contains(token)
}

fn classify_link_icon_rel(tokens: &std::collections::HashSet<String>) -> Option<(&'static str, &'static str, i64)> {
    if has_rel_token(tokens, "apple-touch-icon") || has_rel_token(tokens, "apple-touch-icon-precomposed") {
        Some(("Apple Touch 图标", "html", 14))
    } else if has_rel_token(tokens, "mask-icon") {
        Some(("Mask SVG 图标", "html", 24))
    } else if has_rel_token(tokens, "fluid-icon") {
        Some(("Fluid 图标", "html", 34))
    } else if has_rel_token(tokens, "icon") {
        Some(("Favicon", "html", 30))
    } else {
        None
    }
}

fn html_tag_semantic_text(tag: &HtmlTag) -> String {
    let keys = [
        "id", "class", "alt", "title", "aria-label", "itemprop", "property", "name", "role",
        "src", "srcset", "href", "data-src", "data-lazy-src", "data-original",
    ];
    let parts: Vec<String> = keys
        .iter()
        .filter_map(|key| tag.attrs.get(*key))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    parts.join(" ").to_ascii_lowercase()
}

fn has_logo_semantic(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    [
        "logo",
        "brand",
        "site-logo",
        "site_logo",
        "navbar-brand",
        "header-logo",
        "masthead",
        "wordmark",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

fn has_avatar_semantic(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    [
        "avatar",
        "author",
        "creator",
        "channel",
        "profile",
        "userpic",
        "user-pic",
        "headshot",
        "face",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

fn image_url_from_tag(tag: &HtmlTag) -> Option<String> {
    for key in ["src", "data-src", "data-lazy-src", "data-original", "data-url"] {
        if let Some(value) = tag.attrs.get(key).map(|value| value.trim()).filter(|v| !v.is_empty()) {
            return Some(value.to_string());
        }
    }
    best_srcset_url(
        tag.attrs
            .get("srcset")
            .or_else(|| tag.attrs.get("data-srcset"))
            .map(|value| value.as_str())
            .unwrap_or(""),
    )
}

fn best_srcset_url(srcset: &str) -> Option<String> {
    let mut best_url = String::new();
    let mut best_score = 0.0f64;
    for raw_part in srcset.split(',') {
        let part = raw_part.trim();
        if part.is_empty() {
            continue;
        }
        let fields: Vec<&str> = part.split_whitespace().collect();
        if fields.is_empty() {
            continue;
        }
        let mut score = 1.0f64;
        if fields.len() > 1 {
            let descriptor = fields[1].trim();
            if let Some(value) = descriptor.strip_suffix('w') {
                if let Ok(width) = value.parse::<f64>() {
                    score = width;
                }
            } else if let Some(value) = descriptor.strip_suffix('x') {
                if let Ok(density) = value.parse::<f64>() {
                    score = density * 1000.0;
                }
            }
        }
        if !fields[0].is_empty() && score >= best_score {
            best_url = fields[0].to_string();
            best_score = score;
        }
    }
    if best_url.is_empty() {
        None
    } else {
        Some(best_url)
    }
}

fn max_declared_icon_size(sizes: &str) -> u32 {
    let mut max_size = 0u32;
    for field in sizes.to_ascii_lowercase().split_whitespace() {
        let Some((left, right)) = field.split_once('x') else {
            continue;
        };
        let (Ok(width), Ok(height)) = (left.parse::<u32>(), right.parse::<u32>()) else {
            continue;
        };
        if width == 0 || height == 0 {
            continue;
        }
        max_size = max_size.max(width).max(height);
    }
    max_size
}

// ── HTML 扫描 ───────────────────────────────────────────────────────────────

fn scan_html_tags(html: &str) -> Vec<HtmlTag> {
    let bytes = html.as_bytes();
    let mut tags = Vec::new();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] != b'<' {
            index += 1;
            continue;
        }
        if bytes[index..].starts_with(b"<!--") {
            if let Some(end) = find_bytes(&bytes[index + 4..], b"-->") {
                index += 4 + end + 3;
                continue;
            }
            index += 1;
            continue;
        }
        let Some(end) = html_tag_end(html, index + 1) else {
            break;
        };
        let content = html[index + 1..end].trim();
        index = end + 1;
        if content.is_empty()
            || content.starts_with('/')
            || content.starts_with('!')
            || content.starts_with('?')
        {
            continue;
        }
        let (name, attrs) = parse_html_tag_content(content);
        if name.is_empty() {
            continue;
        }
        tags.push(HtmlTag { name, attrs });
    }
    tags
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn html_tag_end(html: &str, start: usize) -> Option<usize> {
    let bytes = html.as_bytes();
    let mut quote = 0u8;
    let mut index = start;
    while index < bytes.len() {
        let ch = bytes[index];
        if quote != 0 {
            if ch == quote {
                quote = 0;
            }
            index += 1;
            continue;
        }
        if ch == b'\'' || ch == b'"' {
            quote = ch;
            index += 1;
            continue;
        }
        if ch == b'>' {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn parse_html_tag_content(content: &str) -> (String, HashMap<String, String>) {
    let content = content.trim();
    let content = content.strip_suffix('/').unwrap_or(content);
    let name_end = content
        .find(|c: char| is_html_space(c as u8))
        .unwrap_or(content.len());
    let name = content[..name_end].trim().to_ascii_lowercase();
    let attrs = parse_html_attrs(&content[name_end..]);
    (name, attrs)
}

fn parse_html_attrs(input: &str) -> HashMap<String, String> {
    let bytes = input.as_bytes();
    let mut attrs = HashMap::new();
    let mut index = 0usize;
    while index < bytes.len() {
        while index < bytes.len() && is_html_space(bytes[index]) {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let name_start = index;
        while index < bytes.len() && !is_html_space(bytes[index]) && bytes[index] != b'=' {
            index += 1;
        }
        let name = input[name_start..index].trim().to_ascii_lowercase();
        while index < bytes.len() && is_html_space(bytes[index]) {
            index += 1;
        }
        let mut value = String::new();
        if index < bytes.len() && bytes[index] == b'=' {
            index += 1;
            while index < bytes.len() && is_html_space(bytes[index]) {
                index += 1;
            }
            if index < bytes.len() && (bytes[index] == b'\'' || bytes[index] == b'"') {
                let quote = bytes[index];
                index += 1;
                let value_start = index;
                while index < bytes.len() && bytes[index] != quote {
                    index += 1;
                }
                value = input[value_start..index].to_string();
                if index < bytes.len() {
                    index += 1;
                }
            } else {
                let value_start = index;
                while index < bytes.len() && !is_html_space(bytes[index]) {
                    index += 1;
                }
                value = input[value_start..index].to_string();
            }
        }
        if !name.is_empty() {
            attrs.insert(name, html_unescape(value.trim()));
        }
    }
    attrs
}

fn is_html_space(ch: u8) -> bool {
    matches!(ch, b' ' | b'\n' | b'\r' | b'\t' | 0x0c)
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn attr(tag: &HtmlTag, name: &str) -> Option<String> {
    tag.attrs
        .get(name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn limit_strings(values: &[String], max: usize) -> Vec<String> {
    values.iter().take(max).cloned().collect()
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_html_tags_with_quotes() {
        let html = r#"<html><head><link rel="shortcut icon" href='/favicon.png'><meta name='msapplication-TileImage' content="https://x/tile.png"></head><!-- <link rel="icon" href="/ignored.png"> --></html>"#;
        let tags = scan_html_tags(html);
        let names: Vec<&str> = tags.iter().map(|tag| tag.name.as_str()).collect();
        assert!(names.contains(&"link"));
        assert!(names.contains(&"meta"));
        assert_eq!(tags.len(), 4);
        let link = tags.iter().find(|tag| tag.name == "link").expect("link");
        assert_eq!(attr(link, "href").as_deref(), Some("/favicon.png"));
    }

    #[test]
    fn resolves_relative_urls() {
        let base = url::Url::parse("https://example.com/path/page").expect("base");
        assert_eq!(
            resolve_web_icon_url(&base, "/icon.png").as_deref(),
            Some("https://example.com/icon.png")
        );
        assert_eq!(
            resolve_web_icon_url(&base, "icon.png").as_deref(),
            Some("https://example.com/path/icon.png")
        );
        assert!(resolve_web_icon_url(&base, "ftp://example.com/icon.png").is_none());
    }

    #[test]
    fn dedupes_refs_by_url_and_priority() {
        let refs = vec![
            WebIconRef {
                url: "https://example.com/a.png".to_string(),
                label: "low".to_string(),
                source: "html".to_string(),
                media_type: String::new(),
                sizes: String::new(),
                priority: 30,
                order: 1,
            },
            WebIconRef {
                url: "https://example.com/a.png".to_string(),
                label: "high".to_string(),
                source: "html".to_string(),
                media_type: String::new(),
                sizes: String::new(),
                priority: 10,
                order: 2,
            },
        ];
        let normalized = normalize_web_icon_refs(refs);
        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].label, "high");
    }

    #[test]
    fn sniffs_svg_content() {
        let payload = b"  <svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert_eq!(
            sniff_image_type(payload),
            Some(("svg".to_string(), "image/svg+xml".to_string()))
        );
    }
}
