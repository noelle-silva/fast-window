use serde::Serialize;

const DEFAULT_MAX_LOG_BYTES: usize = 256 * 1024;

pub(crate) struct BackendLogBuf {
    bytes: Vec<u8>,
    truncated: bool,
}

impl BackendLogBuf {
    pub(crate) fn new() -> Self {
        Self {
            bytes: Vec::new(),
            truncated: false,
        }
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) {
        if self.truncated {
            return;
        }
        let remain = DEFAULT_MAX_LOG_BYTES.saturating_sub(self.bytes.len());
        if remain == 0 {
            self.truncated = true;
            return;
        }
        if chunk.len() <= remain {
            self.bytes.extend_from_slice(chunk);
            return;
        }
        self.bytes.extend_from_slice(&chunk[..remain]);
        self.truncated = true;
    }

    pub(crate) fn snapshot(&self) -> (String, bool) {
        (
            String::from_utf8_lossy(&self.bytes).to_string(),
            self.truncated,
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBackendStatusRes {
    pub(crate) running: bool,
    pub(crate) pid: Option<u32>,
    pub(crate) started_at_ms: Option<u64>,
    pub(crate) ready: bool,
    pub(crate) ready_at_ms: Option<u64>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) exit_reason: Option<String>,
    pub(crate) endpoint_url: Option<String>,
    pub(crate) endpoint_transport: Option<String>,
    pub(crate) endpoint_protocol_version: Option<u32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
}

impl PluginBackendStatusRes {
    pub(crate) fn stopped() -> Self {
        Self {
            running: false,
            pid: None,
            started_at_ms: None,
            ready: false,
            ready_at_ms: None,
            exit_code: None,
            exit_reason: None,
            endpoint_url: None,
            endpoint_transport: None,
            endpoint_protocol_version: None,
            stdout: String::new(),
            stderr: String::new(),
            stdout_truncated: false,
            stderr_truncated: false,
        }
    }
}
