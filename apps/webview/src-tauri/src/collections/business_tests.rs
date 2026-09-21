//! 业务规则单测：分组级联、收纳夹生命周期、拖拽落点与布局重排。

use std::path::PathBuf;

use crate::collections::model::{CollectionTarget, DEFAULT_GROUP_ID};
use crate::collections::{
    containers, desktop, groups, items,
};

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "fw-webview-business-{tag}-{}",
        crate::collections::model::now_ms()
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn item_input(name: &str, url: &str, group_id: &str) -> items::ItemInput {
    items::ItemInput {
        id: String::new(),
        name: name.to_string(),
        target: CollectionTarget {
            kind: "url".to_string(),
            url: url.to_string(),
        },
        group_id: group_id.to_string(),
        page_order: 0,
        container_id: String::new(),
        created_at: String::new(),
        updated_at: String::new(),
        created_at_ms: 0,
        updated_at_ms: 0,
        layout: None,
        container_layout: None,
        icon: None,
        browser_space_id: None,
        independent_browser_space: false,
    }
}

fn container_input(name: &str, group_id: &str) -> containers::ContainerInput {
    containers::ContainerInput {
        id: String::new(),
        name: name.to_string(),
        group_id: group_id.to_string(),
        page_order: 0,
        created_at: String::new(),
        updated_at: String::new(),
        created_at_ms: 0,
        updated_at_ms: 0,
        layout: None,
    }
}

fn seed_items(dir: &std::path::Path, count: usize) -> Vec<String> {
    let mut ids = Vec::new();
    for index in 0..count {
        let view = items::add(
            dir,
            item_input(
                &format!("站点 {index}"),
                &format!("https://site{index}.example"),
                DEFAULT_GROUP_ID,
            ),
        )
        .expect("add item");
        ids.push(view.items.last().expect("item").id.clone());
    }
    ids
}

#[test]
fn move_to_group_clears_layout_and_container() {
    let dir = temp_dir("move");
    let ids = seed_items(&dir, 2);

    desktop::save_layouts(
        dir.as_path(),
        desktop::DesktopLayoutSavePayload {
            group_id: DEFAULT_GROUP_ID.to_string(),
            items: vec![desktop::DesktopLayoutPatch {
                kind: "item".to_string(),
                id: ids[0].clone(),
                layout: crate::collections::model::GridLayout { x: 2, y: 3 },
            }],
        },
    )
    .expect("save layout");

    let container = containers::add(dir.as_path(), container_input("夹子", DEFAULT_GROUP_ID)).unwrap();
    let container_id = container.containers[0].id.clone();
    items::container_save(
        dir.as_path(),
        items::ContainerSavePayload {
            ids: vec![ids[1].clone()],
            container_id: container_id.clone(),
        },
    )
    .expect("save container");

    let target = groups::add(
        dir.as_path(),
        groups::GroupInput {
            id: String::new(),
            name: "目标分组".to_string(),
        },
    )
    .expect("add group")
    .groups
    .last()
    .expect("group")
    .id
    .clone();
    let mut moved = None;
    for id in &ids {
        moved = Some(
            items::move_to_group(
                dir.as_path(),
                items::TransferPayload {
                    id: id.clone(),
                    group_id: target.clone(),
                },
            )
            .expect("move"),
        );
    }
    let moved = moved.unwrap();
    let first = moved.items.iter().find(|item| item.id == ids[0]).unwrap();
    assert_eq!(first.group_id, target);
    assert!(first.layout.is_none());
    let second = moved.items.iter().find(|item| item.id == ids[1]).unwrap();
    assert!(second.container_id.is_empty());
    assert!(second.container_layout.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn copy_to_group_creates_distinct_item() {
    let dir = temp_dir("copy");
    let ids = seed_items(&dir, 1);
    let target = groups::add(
        dir.as_path(),
        groups::GroupInput {
            id: String::new(),
            name: "副本分组".to_string(),
        },
    )
    .unwrap()
    .groups
    .last()
    .unwrap()
    .id
    .clone();
    let view = items::copy_to_group(
        dir.as_path(),
        items::TransferPayload {
            id: ids[0].clone(),
            group_id: target.clone(),
        },
    )
    .expect("copy");
    assert_eq!(view.items.len(), 2);
    let copy = view.items.iter().find(|item| item.id != ids[0]).expect("copy");
    assert_eq!(copy.group_id, target);
    assert!(copy.layout.is_none());
    let same_group_error = items::copy_to_group(
        dir.as_path(),
        items::TransferPayload {
            id: ids[0].clone(),
            group_id: DEFAULT_GROUP_ID.to_string(),
        },
    );
    assert!(same_group_error.is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn group_remove_cascades_and_rejects_last_non_empty() {
    let dir = temp_dir("group-remove");
    let second = groups::add(
        dir.as_path(),
        groups::GroupInput {
            id: String::new(),
            name: "第二分组".to_string(),
        },
    )
    .unwrap()
    .groups
    .last()
    .unwrap()
    .id
    .clone();
    seed_items(&dir, 1);
    items::add(dir.as_path(), item_input("第二组条目", "https://second.example", &second)).unwrap();
    let before = crate::collections::store::workspace_view(dir.as_path()).unwrap();
    assert_eq!(before.groups.len(), 2);

    let after = groups::remove(dir.as_path(), &second).expect("remove group");
    assert_eq!(after.groups.len(), 1);
    assert!(after.items.iter().all(|item| item.group_id == DEFAULT_GROUP_ID));

    let empty_candidate = groups::remove(dir.as_path(), DEFAULT_GROUP_ID);
    assert!(empty_candidate.is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn container_remove_releases_items_and_place_updates_layout() {
    let dir = temp_dir("container");
    let ids = seed_items(&dir, 2);
    let container = containers::add(dir.as_path(), container_input("收纳夹", DEFAULT_GROUP_ID)).unwrap();
    let container_id = container.containers[0].id.clone();

    let placed = containers::place(
        dir.as_path(),
        containers::ContainerPlacePayload {
            container_id: container_id.clone(),
            moved_id: ids[0].clone(),
            items: vec![
                containers::ContainerLayoutPatch {
                    id: ids[0].clone(),
                    layout: crate::collections::model::GridLayout { x: 1, y: 0 },
                },
            ],
        },
    )
    .expect("place");
    let item = placed.items.iter().find(|item| item.id == ids[0]).unwrap();
    assert_eq!(item.container_id, container_id);
    assert_eq!(item.container_layout, Some(crate::collections::model::GridLayout { x: 1, y: 0 }));

    let wrong_membership = containers::place(
        dir.as_path(),
        containers::ContainerPlacePayload {
            container_id: container_id.clone(),
            moved_id: String::new(),
            items: vec![containers::ContainerLayoutPatch {
                id: ids[1].clone(),
                layout: crate::collections::model::GridLayout { x: 0, y: 0 },
            }],
        },
    );
    assert!(wrong_membership.is_err());

    let released = containers::remove(dir.as_path(), &container_id).expect("remove container");
    let item = released.items.iter().find(|item| item.id == ids[0]).unwrap();
    assert!(item.container_id.is_empty());
    assert!(item.container_layout.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn create_from_items_builds_container_and_extract_moves_back() {
    let dir = temp_dir("create-extract");
    let ids = seed_items(&dir, 2);
    let view = containers::create_from_items(
        dir.as_path(),
        containers::CreateFromItemsPayload {
            source_item_id: ids[0].clone(),
            target_item_id: ids[1].clone(),
            layout: crate::collections::model::GridLayout { x: 4, y: 1 },
        },
    )
    .expect("create from items");
    assert_eq!(view.containers.len(), 1);
    let container = view.containers[0].clone();
    assert_eq!(container.layout, Some(crate::collections::model::GridLayout { x: 4, y: 1 }));
    let source = view.items.iter().find(|item| item.id == ids[0]).unwrap();
    let target = view.items.iter().find(|item| item.id == ids[1]).unwrap();
    assert_eq!(source.container_layout, Some(crate::collections::model::GridLayout { x: 1, y: 0 }));
    assert_eq!(target.container_layout, Some(crate::collections::model::GridLayout { x: 0, y: 0 }));

    let extracted = containers::extract_to_desktop(
        dir.as_path(),
        containers::ExtractPayload {
            container_id: container.id.clone(),
            item_id: ids[0].clone(),
            items: vec![desktop::DesktopLayoutPatch {
                kind: "item".to_string(),
                id: ids[0].clone(),
                layout: crate::collections::model::GridLayout { x: 6, y: 2 },
            }],
        },
    )
    .expect("extract");
    let source = extracted.items.iter().find(|item| item.id == ids[0]).unwrap();
    assert!(source.container_id.is_empty());
    assert!(source.container_layout.is_none());
    assert_eq!(source.layout, Some(crate::collections::model::GridLayout { x: 6, y: 2 }));
    let target = extracted.items.iter().find(|item| item.id == ids[1]).unwrap();
    assert_eq!(target.container_id, container.id);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn desktop_layout_save_renumbers_and_rejects_unknown_entries() {
    let dir = temp_dir("layout");
    let ids = seed_items(&dir, 2);
    let ok = desktop::save_layouts(
        dir.as_path(),
        desktop::DesktopLayoutSavePayload {
            group_id: DEFAULT_GROUP_ID.to_string(),
            items: vec![
                desktop::DesktopLayoutPatch {
                    kind: "item".to_string(),
                    id: ids[1].clone(),
                    layout: crate::collections::model::GridLayout { x: 3, y: 0 },
                },
                desktop::DesktopLayoutPatch {
                    kind: "item".to_string(),
                    id: ids[0].clone(),
                    layout: crate::collections::model::GridLayout { x: -1, y: 3000 },
                },
            ],
        },
    )
    .expect("save layouts");
    let first = ok.items.iter().find(|item| item.id == ids[0]).unwrap();
    assert_eq!(first.layout, Some(crate::collections::model::GridLayout { x: 0, y: 2000 }));
    assert_eq!(first.page_order, 0);
    let second = ok.items.iter().find(|item| item.id == ids[1]).unwrap();
    assert_eq!(second.page_order, 1);

    let unknown = desktop::save_layouts(
        dir.as_path(),
        desktop::DesktopLayoutSavePayload {
            group_id: DEFAULT_GROUP_ID.to_string(),
            items: vec![desktop::DesktopLayoutPatch {
                kind: "item".to_string(),
                id: "missing".to_string(),
                layout: crate::collections::model::GridLayout { x: 0, y: 0 },
            }],
        },
    );
    assert!(unknown.is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ui_state_round_trip_and_validation() {
    let dir = temp_dir("ui-state");
    let stored = crate::collections::workspace::ui_state_save(
        dir.as_path(),
        crate::collections::workspace::UiStatePayload {
            ui_state: crate::collections::model::CollectionsUiState {
                group_id: DEFAULT_GROUP_ID.to_string(),
            },
        },
    )
    .expect("save ui state");
    assert_eq!(stored.group_id, DEFAULT_GROUP_ID);
    let invalid = crate::collections::workspace::ui_state_save(
        dir.as_path(),
        crate::collections::workspace::UiStatePayload {
            ui_state: crate::collections::model::CollectionsUiState {
                group_id: "missing-group".to_string(),
            },
        },
    );
    assert!(invalid.is_err());
    let loaded = crate::collections::workspace::ui_state_get(dir.as_path()).expect("get ui state");
    assert_eq!(loaded.group_id, DEFAULT_GROUP_ID);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn add_with_independent_browser_space_assigns_space_and_meta() {
    let dir = temp_dir("add-independent");
    let mut input = item_input("站点", "https://site.example", DEFAULT_GROUP_ID);
    input.independent_browser_space = true;
    let view = items::add(dir.as_path(), input).expect("add");
    let item = view.items.last().expect("item").clone();
    assert!(!item.browser_space_id.is_empty());
    assert!(crate::browser_data::is_safe_space_id(&item.browser_space_id));
    let meta = crate::browser_data::read_identity_meta(dir.as_path(), &item.browser_space_id)
        .expect("identity meta");
    assert_eq!(meta.name, "站点");
    assert_eq!(meta.url, "https://site.example");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn add_with_blank_space_id_and_flag_still_assigns_independent_space() {
    // 前端新建时会一律携带 browserSpaceId（可能为空串）：空串不得吞掉独立空间意图。
    let dir = temp_dir("add-independent-blank");
    let mut input = item_input("站点", "https://site.example", DEFAULT_GROUP_ID);
    input.browser_space_id = Some(String::new());
    input.independent_browser_space = true;
    let view = items::add(dir.as_path(), input).expect("add");
    let item = view.items.last().expect("item").clone();
    assert!(!item.browser_space_id.is_empty());
    assert!(crate::browser_data::read_identity_meta(dir.as_path(), &item.browser_space_id).is_some());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn add_without_flag_uses_shared_space() {
    let dir = temp_dir("add-shared");
    let view = items::add(
        dir.as_path(),
        item_input("站点", "https://site.example", DEFAULT_GROUP_ID),
    )
    .expect("add");
    assert_eq!(view.items.last().expect("item").browser_space_id, "");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn add_identity_creates_independent_browser_space_item() {
    let dir = temp_dir("identity");
    let ids = seed_items(&dir, 1);
    let source_id = ids[0].clone();

    let view = items::add_identity(
        dir.as_path(),
        items::AddIdentityPayload {
            id: source_id.clone(),
            name: String::new(),
        },
    )
    .expect("add identity");

    assert_eq!(view.items.len(), 2);
    let source = view.items.iter().find(|item| item.id == source_id).expect("source");
    let identity = view.items.iter().find(|item| item.id != source_id).expect("identity");
    assert_eq!(identity.target.url, source.target.url);
    assert_eq!(identity.group_id, source.group_id);
    assert!(!identity.browser_space_id.is_empty());
    assert_ne!(identity.browser_space_id, source.browser_space_id);
    assert!(identity.container_id.is_empty());
    assert!(identity.layout.is_none());
    assert!(identity.name.ends_with("新身份"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn add_identity_accepts_custom_name() {
    let dir = temp_dir("identity-name");
    let ids = seed_items(&dir, 1);

    let view = items::add_identity(
        dir.as_path(),
        items::AddIdentityPayload {
            id: ids[0].clone(),
            name: "小号".to_string(),
        },
    )
    .expect("add identity");

    let identity = view.items.iter().find(|item| item.id != ids[0]).expect("identity");
    assert_eq!(identity.name, "小号");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn remove_identity_keeps_space_while_another_item_shares_it() {
    let dir = temp_dir("identity-shared-space");
    let ids = seed_items(&dir, 1);
    let view = items::add_identity(
        dir.as_path(),
        items::AddIdentityPayload {
            id: ids[0].clone(),
            name: "小号".to_string(),
        },
    )
    .expect("add identity");
    let identity = view
        .items
        .iter()
        .find(|item| item.id != ids[0])
        .expect("identity")
        .clone();
    let space_dir = dir
        .join("browser-profiles")
        .join(&identity.browser_space_id);
    std::fs::create_dir_all(space_dir.join("EBWebView")).expect("create space dir");

    let groups_view = groups::add(
        dir.as_path(),
        groups::GroupInput {
            id: String::new(),
            name: "第二分组".to_string(),
        },
    )
    .expect("add group");
    let target_group = groups_view
        .groups
        .iter()
        .find(|group| group.id != DEFAULT_GROUP_ID)
        .expect("new group")
        .id
        .clone();
    let copied = items::copy_to_group(
        dir.as_path(),
        items::TransferPayload {
            id: identity.id.clone(),
            group_id: target_group,
        },
    )
    .expect("copy identity to group");
    let shared = copied
        .items
        .iter()
        .find(|item| item.id != ids[0] && item.id != identity.id)
        .expect("copied identity")
        .clone();
    assert_eq!(shared.browser_space_id, identity.browser_space_id);

    items::remove(dir.as_path(), &identity.id, true).expect("remove first copy");
    assert!(space_dir.exists(), "空间目录应保留给仍在使用它的条目");

    items::remove(dir.as_path(), &shared.id, true).expect("remove last copy");
    assert!(!space_dir.exists(), "最后一个引用删除后应清理空间目录");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn identity_meta_enables_orphan_detection_and_reuse_candidates() {
    let dir = temp_dir("identity-orphan");
    let ids = seed_items(&dir, 1);
    let view = items::add_identity(
        dir.as_path(),
        items::AddIdentityPayload {
            id: ids[0].clone(),
            name: "小号".to_string(),
        },
    )
    .expect("add identity");
    let identity = view
        .items
        .iter()
        .find(|item| item.id != ids[0])
        .expect("identity")
        .clone();

    let meta = crate::browser_data::read_identity_meta(dir.as_path(), &identity.browser_space_id)
        .expect("identity meta");
    assert_eq!(meta.name, "小号");
    assert_eq!(meta.url, "https://site0.example");

    items::remove(dir.as_path(), &identity.id, false).expect("remove keeping space");
    let orphans = items::orphan_spaces(dir.as_path()).expect("orphans");
    assert_eq!(orphans.len(), 1);
    assert_eq!(orphans[0].space_id, identity.browser_space_id);
    assert_eq!(orphans[0].name, "小号");
    assert_eq!(orphans[0].url, "https://site0.example");

    let candidates = items::space_candidates(
        dir.as_path(),
        items::SpaceCandidatesPayload {
            url: "https://site0.example".to_string(),
        },
    )
    .expect("candidates");
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].space_id, "");
    let orphan_candidate = candidates
        .iter()
        .find(|candidate| candidate.space_id == identity.browser_space_id)
        .expect("orphan candidate");
    assert!(orphan_candidate.orphan);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn remove_identity_clears_browser_space_directory() {
    let dir = temp_dir("identity-remove");
    let ids = seed_items(&dir, 1);
    let view = items::add_identity(
        dir.as_path(),
        items::AddIdentityPayload {
            id: ids[0].clone(),
            name: "小号".to_string(),
        },
    )
    .expect("add identity");
    let identity = view
        .items
        .iter()
        .find(|item| item.id != ids[0])
        .expect("identity")
        .clone();
    let space_dir = dir
        .join("browser-profiles")
        .join(&identity.browser_space_id);
    std::fs::create_dir_all(space_dir.join("EBWebView")).expect("create space dir");
    std::fs::write(space_dir.join("EBWebView").join("Local State"), b"x").expect("write");

    items::remove(dir.as_path(), &identity.id, true).expect("remove identity");

    assert!(!space_dir.exists());
    let _ = std::fs::remove_dir_all(&dir);
}
