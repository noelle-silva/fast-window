//! 收藏桌面数据模型：数据结构、校验与归一化。
//!
//! 只保留网址一类收藏：单工作区（分组 / 条目 / 收纳夹 / 桌面状态）+ 界面状态。

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const DATA_VERSION: u32 = 1;

pub const MAX_LAYOUT_COORD: i64 = 2000;
pub const DEFAULT_GROUP_ID: &str = "default";
pub const DEFAULT_GROUP_NAME: &str = "默认";
pub const MAX_GROUP_NAME_CHARS: usize = 40;
pub const MAX_ITEM_NAME_CHARS: usize = 80;
pub const MAX_CONTAINER_NAME_CHARS: usize = 80;
pub const MAX_WALLPAPER_NAME_CHARS: usize = 80;

pub const ICON_SCALE_MIN: f64 = 0.75;
pub const ICON_SCALE_MAX: f64 = 1.35;
pub const ICON_GAP_MIN: i64 = 0;
pub const ICON_GAP_MAX: i64 = 64;

pub const WALLPAPER_POSITION_MIN: f64 = 0.0;
pub const WALLPAPER_POSITION_MAX: f64 = 100.0;
pub const WALLPAPER_SCALE_MIN: f64 = 1.0;
pub const WALLPAPER_SCALE_MAX: f64 = 4.0;

pub const DEFAULT_ICON_COLOR: &str = "#8FA99B";
pub const ICON_COLORS: [&str; 8] = [
    "#8FA99B", "#8FA6B8", "#A79AB4", "#B7A38C", "#A9A18E", "#9AA38F", "#A08F8F", "#8F9FA3",
];

pub const ICON_ASSET_PREFIX: &str = "icons/";
pub const WALLPAPER_ASSET_PREFIX: &str = "wallpapers/";

// ── 数据结构 ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridLayout {
    pub x: i64,
    pub y: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionGroup {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionTarget {
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIcon {
    #[serde(default = "default_icon_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub asset_id: String,
}

fn default_icon_kind() -> String {
    "color".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItem {
    pub id: String,
    pub name: String,
    pub target: CollectionTarget,
    pub group_id: String,
    #[serde(default)]
    pub page_order: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub container_id: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<GridLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_layout: Option<GridLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<DesktopIcon>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopContainer {
    pub id: String,
    pub name: String,
    pub group_id: String,
    #[serde(default)]
    pub page_order: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<GridLayout>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWallpaperView {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWallpaperPreset {
    pub id: String,
    pub name: String,
    pub asset_id: String,
    pub view: DesktopWallpaperView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWallpaper {
    pub active_id: String,
    pub presets: Vec<DesktopWallpaperPreset>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIconLayout {
    pub row_gap: i64,
    pub column_gap: i64,
    pub icon_scale: f64,
}

impl Default for DesktopIconLayout {
    fn default() -> Self {
        Self {
            row_gap: ICON_GAP_MIN,
            column_gap: ICON_GAP_MIN,
            icon_scale: ICON_SCALE_MIN,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wallpaper: Option<DesktopWallpaper>,
    pub icon_layout: DesktopIconLayout,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            wallpaper: None,
            icon_layout: DesktopIconLayout::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub groups: Vec<CollectionGroup>,
    pub items: Vec<CollectionItem>,
    pub containers: Vec<DesktopContainer>,
    pub desktop: DesktopState,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            groups: vec![CollectionGroup {
                id: DEFAULT_GROUP_ID.to_string(),
                name: DEFAULT_GROUP_NAME.to_string(),
            }],
            items: Vec::new(),
            containers: Vec::new(),
            desktop: DesktopState::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionsUiState {
    /// 上次选择的分组 ID；无分组时为空串。
    #[serde(default)]
    pub group_id: String,
}

impl Default for CollectionsUiState {
    fn default() -> Self {
        Self {
            group_id: DEFAULT_GROUP_ID.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionsDoc {
    pub schema_version: u32,
    pub data_version: u32,
    pub workspace: Workspace,
    pub ui_state: CollectionsUiState,
    #[serde(default)]
    pub updated_at: String,
}

impl Default for CollectionsDoc {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            data_version: DATA_VERSION,
            workspace: Workspace::default(),
            ui_state: CollectionsUiState::default(),
            updated_at: String::new(),
        }
    }
}

/// RPC 返回给前端的工作区视图。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub schema_version: u32,
    pub data_version: u32,
    pub groups: Vec<CollectionGroup>,
    pub items: Vec<CollectionItem>,
    pub containers: Vec<DesktopContainer>,
    pub desktop: DesktopState,
    pub ui_state: CollectionsUiState,
}

impl WorkspaceView {
    pub fn from_doc(doc: &CollectionsDoc) -> Self {
        Self {
            schema_version: doc.schema_version,
            data_version: doc.data_version,
            groups: doc.workspace.groups.clone(),
            items: doc.workspace.items.clone(),
            containers: doc.workspace.containers.clone(),
            desktop: doc.workspace.desktop.clone(),
            ui_state: doc.ui_state.clone(),
        }
    }
}

// ── 时间与文本工具 ──────────────────────────────────────────────────────────

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Unix 毫秒 → RFC3339 UTC 文本（例如 2026-09-17T08:30:00Z）。
pub fn rfc3339_from_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    if millis == 0 {
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
    } else {
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
    }
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn now_text() -> String {
    rfc3339_from_ms(now_ms())
}

/// 截断到指定字符数（按 Unicode 标量值计数），并去除首尾空白。
pub fn trim_max(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    trimmed.chars().take(max_chars).collect()
}

/// 归一化标识：小写、仅保留 a-z 0-9 _ -，截断到指定字符数。
pub fn safe_id(value: &str, max_chars: usize) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(max_chars)
        .collect()
}

// ── 网格坐标 ────────────────────────────────────────────────────────────────

pub fn validate_grid_layout(layout: &GridLayout) -> Result<(), String> {
    if layout.x < 0 || layout.x > MAX_LAYOUT_COORD {
        return Err(format!("layout x must be between 0 and {MAX_LAYOUT_COORD}"));
    }
    if layout.y < 0 || layout.y > MAX_LAYOUT_COORD {
        return Err(format!("layout y must be between 0 and {MAX_LAYOUT_COORD}"));
    }
    Ok(())
}

pub fn clamp_grid_layout(layout: &GridLayout) -> GridLayout {
    GridLayout {
        x: layout.x.clamp(0, MAX_LAYOUT_COORD),
        y: layout.y.clamp(0, MAX_LAYOUT_COORD),
    }
}

// ── 目标与图标 ──────────────────────────────────────────────────────────────

pub fn validate_target(target: &CollectionTarget) -> Result<(), String> {
    if target.kind != "url" {
        return Err("target kind must be url".to_string());
    }
    let value = target.url.trim();
    if value.is_empty() {
        return Err("valid http or https url is required".to_string());
    }
    let parsed = url::Url::parse(value).map_err(|_| "valid http or https url is required".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("valid http or https url is required".to_string());
    }
    if parsed.host_str().map(|h| h.is_empty()).unwrap_or(true) {
        return Err("valid http or https url is required".to_string());
    }
    Ok(())
}

/// 目标归一化：trim 网址。
pub fn normalize_target(target: &mut CollectionTarget) {
    target.kind = target.kind.trim().to_lowercase();
    target.url = target.url.trim().to_string();
}

pub fn default_item_name(target: &CollectionTarget) -> String {
    if target.kind == "url" {
        if let Ok(parsed) = url::Url::parse(target.url.trim()) {
            if let Some(host) = parsed.host_str() {
                if !host.is_empty() {
                    return host.to_string();
                }
            }
        }
        return target.url.trim().to_string();
    }
    String::new()
}

pub fn validate_icon(icon: &DesktopIcon) -> Result<(), String> {
    let kind = icon.kind.trim().to_lowercase();
    match kind.as_str() {
        "color" => {
            if !ICON_COLORS.contains(&icon.color.as_str()) {
                return Err(format!("unsupported icon color: {}", icon.color));
            }
            Ok(())
        }
        "image" => {
            let asset_id = icon.asset_id.trim();
            if !crate::collections::assets::is_safe_asset_id(asset_id) {
                return Err("invalid icon asset id".to_string());
            }
            if !asset_id.starts_with(ICON_ASSET_PREFIX) {
                return Err("icon asset id must use icons/ prefix".to_string());
            }
            Ok(())
        }
        other => Err(format!("unsupported icon kind: {other}")),
    }
}

pub fn normalize_icon(icon: &mut DesktopIcon) -> Result<(), String> {
    icon.kind = if icon.kind.trim().is_empty() {
        "color".to_string()
    } else {
        icon.kind.trim().to_lowercase()
    };
    icon.color = icon.color.trim().to_uppercase();
    icon.asset_id = icon.asset_id.trim().to_string();
    match icon.kind.as_str() {
        "color" => {
            if icon.color.is_empty() {
                icon.color = DEFAULT_ICON_COLOR.to_string();
            }
            icon.asset_id.clear();
        }
        "image" => {
            icon.color.clear();
        }
        _ => {}
    }
    validate_icon(icon)
}

// ── 壁纸 ────────────────────────────────────────────────────────────────────

pub fn validate_wallpaper(wallpaper: &DesktopWallpaper) -> Result<(), String> {
    if wallpaper.active_id.trim().is_empty() {
        return Err("wallpaper activeId is required".to_string());
    }
    if wallpaper.presets.is_empty() {
        return Err("wallpaper presets are required".to_string());
    }
    let mut seen_ids = std::collections::HashSet::new();
    for preset in &wallpaper.presets {
        let id = preset.id.trim();
        if id.is_empty() {
            return Err("wallpaper preset id is required".to_string());
        }
        if !seen_ids.insert(id.to_string()) {
            return Err(format!("duplicate wallpaper preset id: {id}"));
        }
        if !crate::collections::assets::is_safe_asset_id(preset.asset_id.trim()) {
            return Err(format!("invalid wallpaper asset id: {}", preset.asset_id));
        }
        if !preset.asset_id.trim().starts_with(WALLPAPER_ASSET_PREFIX) {
            return Err("wallpaper asset id must use wallpapers/ prefix".to_string());
        }
        validate_wallpaper_view(&preset.view)?;
    }
    if !wallpaper
        .presets
        .iter()
        .any(|preset| preset.id.trim() == wallpaper.active_id.trim())
    {
        return Err(format!("wallpaper activeId not found: {}", wallpaper.active_id));
    }
    Ok(())
}

pub fn validate_wallpaper_view(view: &DesktopWallpaperView) -> Result<(), String> {
    if view.x < WALLPAPER_POSITION_MIN || view.x > WALLPAPER_POSITION_MAX {
        return Err("wallpaper view x must be between 0 and 100".to_string());
    }
    if view.y < WALLPAPER_POSITION_MIN || view.y > WALLPAPER_POSITION_MAX {
        return Err("wallpaper view y must be between 0 and 100".to_string());
    }
    if view.scale < WALLPAPER_SCALE_MIN || view.scale > WALLPAPER_SCALE_MAX {
        return Err("wallpaper view scale must be between 1 and 4".to_string());
    }
    Ok(())
}

pub fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub fn normalize_wallpaper(wallpaper: &mut DesktopWallpaper) -> Result<(), String> {
    wallpaper.active_id = wallpaper.active_id.trim().to_string();
    for preset in wallpaper.presets.iter_mut() {
        preset.id = preset.id.trim().to_string();
        preset.name = trim_max(&preset.name, MAX_WALLPAPER_NAME_CHARS);
        preset.asset_id = preset.asset_id.trim().to_string();
        preset.view.x = round2(preset.view.x.clamp(WALLPAPER_POSITION_MIN, WALLPAPER_POSITION_MAX));
        preset.view.y = round2(preset.view.y.clamp(WALLPAPER_POSITION_MIN, WALLPAPER_POSITION_MAX));
        preset.view.scale = round2(preset.view.scale.clamp(WALLPAPER_SCALE_MIN, WALLPAPER_SCALE_MAX));
    }
    validate_wallpaper(wallpaper)
}

// ── 图标布局 ────────────────────────────────────────────────────────────────

pub fn validate_icon_layout(layout: &DesktopIconLayout) -> Result<(), String> {
    if layout.row_gap < ICON_GAP_MIN || layout.row_gap > ICON_GAP_MAX {
        return Err(format!("rowGap must be between {ICON_GAP_MIN} and {ICON_GAP_MAX}"));
    }
    if layout.column_gap < ICON_GAP_MIN || layout.column_gap > ICON_GAP_MAX {
        return Err(format!("columnGap must be between {ICON_GAP_MIN} and {ICON_GAP_MAX}"));
    }
    if layout.icon_scale < ICON_SCALE_MIN || layout.icon_scale > ICON_SCALE_MAX {
        return Err(format!(
            "iconScale must be between {ICON_SCALE_MIN} and {ICON_SCALE_MAX}"
        ));
    }
    Ok(())
}

pub fn normalize_icon_layout(layout: &mut DesktopIconLayout) -> Result<(), String> {
    layout.row_gap = layout.row_gap.clamp(ICON_GAP_MIN, ICON_GAP_MAX);
    layout.column_gap = layout.column_gap.clamp(ICON_GAP_MIN, ICON_GAP_MAX);
    layout.icon_scale = round2(layout.icon_scale.clamp(ICON_SCALE_MIN, ICON_SCALE_MAX));
    validate_icon_layout(layout)
}

// ── 排序 ────────────────────────────────────────────────────────────────────

/// 该分组内下一个排序号：统计全部条目（含收纳夹内）与容器。
pub fn next_page_order(workspace: &Workspace, group_id: &str) -> i64 {
    let mut max_order: i64 = -1;
    for item in &workspace.items {
        if item.group_id == group_id && item.page_order > max_order {
            max_order = item.page_order;
        }
    }
    for container in &workspace.containers {
        if container.group_id == group_id && container.page_order > max_order {
            max_order = container.page_order;
        }
    }
    max_order + 1
}

/// 重排该分组的排序号：只统计桌面可见条目（不在收纳夹内）与容器，稳定排序后压缩为 0..n-1。
pub fn renumber_page_order(workspace: &mut Workspace, group_id: &str) {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Kind {
        Item(usize),
        Container(usize),
    }

    let mut entries: Vec<(i64, usize, Kind)> = Vec::new();
    for (index, item) in workspace.items.iter().enumerate() {
        if item.group_id == group_id && item.container_id.is_empty() {
            entries.push((item.page_order, index, Kind::Item(index)));
        }
    }
    for (index, container) in workspace.containers.iter().enumerate() {
        if container.group_id == group_id {
            entries.push((container.page_order, index, Kind::Container(index)));
        }
    }
    entries.sort_by_key(|(page_order, index, _)| (*page_order, *index));
    for (order, (_, _, kind)) in entries.iter().enumerate() {
        let order = order as i64;
        match kind {
            Kind::Item(index) => workspace.items[*index].page_order = order,
            Kind::Container(index) => workspace.containers[*index].page_order = order,
        }
    }
}

/// 复制条目时生成不冲突的新 ID：`<毫秒>-copy-<n>`。
pub fn next_copy_item_id(workspace: &Workspace, base_ms: i64) -> String {
    let mut n = 0;
    loop {
        let candidate = format!("{base_ms}-copy-{n}");
        if !workspace.items.iter().any(|item| item.id == candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// 新建收纳夹时的默认名称：`新建收纳夹（N）`，N 从 1 起找未占用的。
pub fn next_container_name(workspace: &Workspace) -> String {
    let mut n: i64 = 1;
    loop {
        let candidate = format!("新建收纳夹（{n}）");
        if !workspace
            .containers
            .iter()
            .any(|container| container.name == candidate)
        {
            return candidate;
        }
        n += 1;
    }
}

/// 新建收纳夹 ID：`container-<毫秒>`，冲突则递增毫秒。
pub fn next_container_id(workspace: &Workspace, base_ms: i64) -> String {
    let mut ms = base_ms;
    loop {
        let candidate = format!("container-{ms}");
        if !workspace
            .containers
            .iter()
            .any(|container| container.id == candidate)
        {
            return candidate;
        }
        ms += 1;
    }
}

// ── 查找工具 ────────────────────────────────────────────────────────────────

/// 分组归属校验：必须是已存在分组的归一化 ID。
pub fn normalize_group_id(raw: &str, groups: &[CollectionGroup]) -> Result<String, String> {
    let id = safe_id(raw, 32);
    if id.is_empty() || !groups.iter().any(|group| group.id == id) {
        return Err("valid group id is required".to_string());
    }
    Ok(id)
}

/// 桌面条目类型归一化：item / container。
pub fn normalize_desktop_entry_kind(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "item" => "item".to_string(),
        "container" => "container".to_string(),
        _ => String::new(),
    }
}

pub fn normalize_icon_option(icon: Option<DesktopIcon>) -> Result<Option<DesktopIcon>, String> {
    match icon {
        None => Ok(None),
        Some(mut icon) => {
            normalize_icon(&mut icon)?;
            Ok(Some(icon))
        }
    }
}

pub fn find_container<'a>(
    workspace: &'a Workspace,
    container_id: &str,
) -> Option<&'a DesktopContainer> {
    workspace
        .containers
        .iter()
        .find(|container| container.id == container_id)
}

// ── 整文档归一化 ────────────────────────────────────────────────────────────

/// 写回前的整文档归一化：校验全部不变量，返回带上下文的错误。
pub fn normalize_doc(doc: &mut CollectionsDoc) -> Result<(), String> {
    if doc.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported collections schema version: {}",
            doc.schema_version
        ));
    }
    if doc.data_version != DATA_VERSION {
        return Err(format!(
            "unsupported collections data version: {}",
            doc.data_version
        ));
    }

    // 分组：ID 唯一、名称归一化。
    let mut group_ids = std::collections::HashSet::new();
    for (index, group) in doc.workspace.groups.iter_mut().enumerate() {
        group.id = safe_id(&group.id, 32);
        group.name = trim_max(&group.name, MAX_GROUP_NAME_CHARS);
        if group.id.is_empty() {
            return Err(format!("groups[{index}]: group id is required"));
        }
        if group.name.is_empty() {
            return Err(format!("groups[{index}]: group name is required"));
        }
        if !group_ids.insert(group.id.clone()) {
            return Err(format!("groups[{index}]: duplicate group id: {}", group.id));
        }
    }

    // 条目：ID 唯一、目标与图标校验、分组与收纳夹归属校验。
    let mut item_ids = std::collections::HashSet::new();
    let mut container_by_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for (index, container) in doc.workspace.containers.iter_mut().enumerate() {
        container.id = container.id.trim().to_string();
        container.name = trim_max(&container.name, MAX_CONTAINER_NAME_CHARS);
        container.group_id = container.group_id.trim().to_string();
        if container.id.is_empty() {
            return Err(format!("containers[{index}]: container id is required"));
        }
        if container.name.is_empty() {
            return Err(format!("containers[{index}]: container name is required"));
        }
        if !group_ids.contains(&container.group_id) {
            return Err(format!(
                "containers[{index}]: valid group id is required: {}",
                container.group_id
            ));
        }
        if container.page_order < 0 {
            return Err(format!(
                "containers[{index}]: container pageOrder must be non-negative"
            ));
        }
        if let Some(layout) = &container.layout {
            validate_grid_layout(layout)
                .map_err(|e| format!("containers[{index}]: {e}"))?;
        }
        if container_by_id
            .insert(container.id.clone(), container.group_id.clone())
            .is_some()
        {
            return Err(format!(
                "containers[{index}]: duplicate container id: {}",
                container.id
            ));
        }
    }

    for (index, item) in doc.workspace.items.iter_mut().enumerate() {
        normalize_target(&mut item.target);
        item.id = item.id.trim().to_string();
        item.name = trim_max(&item.name, MAX_ITEM_NAME_CHARS);
        if item.name.is_empty() {
            item.name = default_item_name(&item.target);
        }
        if item.name.is_empty() || item.name == "." {
            return Err(format!("items[{index}]: item name is required"));
        }
        if item.id.is_empty() {
            return Err(format!("items[{index}]: item id is required"));
        }
        if !item_ids.insert(item.id.clone()) {
            return Err(format!("items[{index}]: duplicate item id: {}", item.id));
        }
        validate_target(&item.target).map_err(|e| format!("items[{index}]: {e}"))?;
        item.group_id = item.group_id.trim().to_string();
        if !group_ids.contains(&item.group_id) {
            return Err(format!(
                "items[{index}]: valid group id is required: {}",
                item.group_id
            ));
        }
        if item.page_order < 0 {
            return Err(format!("items[{index}]: item pageOrder must be non-negative"));
        }
        item.container_id = item.container_id.trim().to_string();
        if !item.container_id.is_empty() {
            match container_by_id.get(&item.container_id) {
                None => {
                    return Err(format!(
                        "items[{index}]: container not found: {}",
                        item.container_id
                    ))
                }
                Some(container_group) => {
                    if *container_group != item.group_id {
                        return Err(format!(
                            "items[{index}]: container group mismatch: {}",
                            item.container_id
                        ));
                    }
                }
            }
        } else if item.container_layout.is_some() {
            return Err(format!(
                "items[{index}]: containerLayout requires containerId"
            ));
        }
        if let Some(layout) = &item.layout {
            validate_grid_layout(layout).map_err(|e| format!("items[{index}]: {e}"))?;
        }
        if let Some(layout) = &item.container_layout {
            validate_grid_layout(layout).map_err(|e| format!("items[{index}]: {e}"))?;
        }
        if let Some(icon) = item.icon.as_mut() {
            normalize_icon(icon).map_err(|e| format!("items[{index}]: {e}"))?;
        }
    }

    // 桌面状态。
    normalize_icon_layout(&mut doc.workspace.desktop.icon_layout)
        .map_err(|e| format!("desktop.iconLayout: {e}"))?;
    if let Some(wallpaper) = doc.workspace.desktop.wallpaper.as_mut() {
        normalize_wallpaper(wallpaper).map_err(|e| format!("desktop.wallpaper: {e}"))?;
    }

    // 界面状态：所选分组必须存在；无分组时允许空串。
    doc.ui_state.group_id = safe_id(&doc.ui_state.group_id, 32);
    if doc.ui_state.group_id.is_empty() {
        if !doc.workspace.groups.is_empty() {
            return Err("uiState groupId is required".to_string());
        }
    } else if !group_ids.contains(&doc.ui_state.group_id) {
        return Err(format!(
            "uiState groupId not found: {}",
            doc.ui_state.group_id
        ));
    }

    Ok(())
}

/// 工作区状态修正：界面所选分组被删除时，切到第一个分组（或空串）。
pub fn repair_ui_state_selection(doc: &mut CollectionsDoc) {
    let current = doc.ui_state.group_id.trim().to_string();
    let valid = !current.is_empty()
        && doc
            .workspace
            .groups
            .iter()
            .any(|group| group.id == current);
    if valid {
        return;
    }
    doc.ui_state.group_id = doc
        .workspace
        .groups
        .first()
        .map(|group| group.id.clone())
        .unwrap_or_default();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_matches_known_epochs() {
        assert_eq!(rfc3339_from_ms(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_from_ms(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
        assert_eq!(rfc3339_from_ms(1_752_000_000_000), "2025-07-08T18:40:00Z");
    }

    #[test]
    fn safe_id_filters_and_truncates() {
        assert_eq!(safe_id(" Group_A!", 32), "group_a");
        assert_eq!(safe_id("abcdefghijklmnopqrstuvwxyz0123456789", 5), "abcde");
    }

    #[test]
    fn clamp_and_validate_layout() {
        let clamped = clamp_grid_layout(&GridLayout { x: -5, y: 3000 });
        assert_eq!(clamped, GridLayout { x: 0, y: 2000 });
        assert!(validate_grid_layout(&GridLayout { x: 2001, y: 0 }).is_err());
    }

    #[test]
    fn icon_normalization_enforces_palette() {
        assert!(normalize_icon(&mut DesktopIcon {
            kind: String::new(),
            color: "#8fa99b".to_string(),
            asset_id: String::new(),
        })
        .is_ok());
        assert!(normalize_icon(&mut DesktopIcon {
            kind: "color".to_string(),
            color: "#123456".to_string(),
            asset_id: String::new(),
        })
        .is_err());
    }

    #[test]
    fn redirect_target_requires_http() {
        let mut target = CollectionTarget {
            kind: "url".to_string(),
            url: "example.com".to_string(),
        };
        assert!(validate_target(&target).is_err());
        target.url = "https://example.com".to_string();
        assert!(validate_target(&target).is_ok());
        assert_eq!(default_item_name(&target), "example.com");
    }

    #[test]
    fn page_order_helpers() {
        let mut workspace = Workspace::default();
        workspace.items.push(CollectionItem {
            id: "a".to_string(),
            name: "a".to_string(),
            target: CollectionTarget {
                kind: "url".to_string(),
                url: "https://a.example".to_string(),
            },
            group_id: DEFAULT_GROUP_ID.to_string(),
            page_order: 3,
            container_id: "box".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
            created_at_ms: 0,
            updated_at_ms: 0,
            layout: None,
            container_layout: None,
            icon: None,
        });
        assert_eq!(next_page_order(&workspace, DEFAULT_GROUP_ID), 4);
        workspace
            .containers
            .push(DesktopContainer {
                id: "box".to_string(),
                name: "box".to_string(),
                group_id: DEFAULT_GROUP_ID.to_string(),
                page_order: 7,
                created_at: String::new(),
                updated_at: String::new(),
                created_at_ms: 0,
                updated_at_ms: 0,
                layout: None,
            });
        assert_eq!(next_page_order(&workspace, DEFAULT_GROUP_ID), 8);
        renumber_page_order(&mut workspace, DEFAULT_GROUP_ID);
        assert_eq!(workspace.containers[0].page_order, 0);
        assert_eq!(workspace.items[0].page_order, 3);
    }
}
