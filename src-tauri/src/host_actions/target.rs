use serde::Serialize;

/// 宿主调度视角下的应用条目：只保留定位与展示必需的两项事实。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AppCatalogEntry {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppCandidate {
    pub(crate) app_id: String,
    pub(crate) name: String,
}

impl From<&AppCatalogEntry> for AppCandidate {
    fn from(entry: &AppCatalogEntry) -> Self {
        Self {
            app_id: entry.id.clone(),
            name: entry.name.clone(),
        }
    }
}

pub(crate) enum TargetResolution {
    Unique(AppCatalogEntry),
    Ambiguous(Vec<AppCandidate>),
    NotFound,
}

const MAX_CANDIDATES: usize = 8;

/// 把用户写下的应用名解析成唯一的应用条目。
///
/// 匹配按确定性阶梯推进：id 精确 → 名称精确 → 前缀 → 子串。
/// 每一级只在该级命中内结算，命中多个即判定歧义，绝不替用户挑一个「看起来最像」的。
pub(crate) fn resolve_app_target(query: &str, apps: &[AppCatalogEntry]) -> TargetResolution {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return TargetResolution::NotFound;
    }

    for stage in 0..MATCH_STAGES {
        let hits: Vec<&AppCatalogEntry> = apps
            .iter()
            .filter(|entry| matches_stage(entry, &needle, stage))
            .collect();

        match hits.len() {
            0 => continue,
            1 => return TargetResolution::Unique(hits[0].clone()),
            _ => {
                let candidates = hits
                    .iter()
                    .take(MAX_CANDIDATES)
                    .map(|entry| AppCandidate::from(*entry))
                    .collect();
                return TargetResolution::Ambiguous(candidates);
            }
        }
    }

    TargetResolution::NotFound
}

const MATCH_STAGES: usize = 4;

fn matches_stage(entry: &AppCatalogEntry, needle: &str, stage: usize) -> bool {
    let id = entry.id.to_lowercase();
    let name = entry.name.to_lowercase();
    match stage {
        0 => id == needle,
        1 => name == needle,
        2 => id.starts_with(needle) || name.starts_with(needle),
        3 => id.contains(needle) || name.contains(needle),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> Vec<AppCatalogEntry> {
        vec![
            AppCatalogEntry {
                id: "venera".to_string(),
                name: "Venera".to_string(),
            },
            AppCatalogEntry {
                id: "picacomic".to_string(),
                name: "PicaComic".to_string(),
            },
            AppCatalogEntry {
                id: "venera-dev".to_string(),
                name: "Venera Dev".to_string(),
            },
        ]
    }

    fn unique_id(resolution: TargetResolution) -> String {
        match resolution {
            TargetResolution::Unique(entry) => entry.id,
            _ => panic!("expected unique match"),
        }
    }

    #[test]
    fn matches_exact_id_case_insensitively() {
        let target = resolve_app_target("VENERA-DEV", &catalog());
        assert_eq!(unique_id(target), "venera-dev");
    }

    #[test]
    fn matches_exact_name_before_prefix() {
        let target = resolve_app_target("PicaComic", &catalog());
        assert_eq!(unique_id(target), "picacomic");
    }

    #[test]
    fn falls_back_to_prefix_when_exact_misses() {
        let target = resolve_app_target("picac", &catalog());
        assert_eq!(unique_id(target), "picacomic");
    }

    #[test]
    fn falls_back_to_substring() {
        let target = resolve_app_target("comic", &catalog());
        assert_eq!(unique_id(target), "picacomic");
    }

    #[test]
    fn reports_ambiguity_with_candidates() {
        match resolve_app_target("vener", &catalog()) {
            TargetResolution::Ambiguous(candidates) => {
                assert_eq!(candidates.len(), 2);
                assert_eq!(candidates[0].app_id, "venera");
            }
            _ => panic!("expected ambiguity"),
        }
    }

    #[test]
    fn exact_id_wins_over_longer_sibling() {
        let target = resolve_app_target("venera", &catalog());
        assert_eq!(unique_id(target), "venera");
    }

    #[test]
    fn reports_not_found_for_unknown_name() {
        assert!(matches!(
            resolve_app_target("nothing-here", &catalog()),
            TargetResolution::NotFound
        ));
    }

    #[test]
    fn reports_not_found_for_blank_query() {
        assert!(matches!(
            resolve_app_target("   ", &catalog()),
            TargetResolution::NotFound
        ));
    }
}
