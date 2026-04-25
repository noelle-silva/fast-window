#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceScope {
    Data,
    Output,
    Library,
}

impl WorkspaceScope {
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "data" => Ok(Self::Data),
            "output" => Ok(Self::Output),
            "library" => Ok(Self::Library),
            _ => Err("scope 不支持（仅支持 data/output/library）".to_string()),
        }
    }
}

