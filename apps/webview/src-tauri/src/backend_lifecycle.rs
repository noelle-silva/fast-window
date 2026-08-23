use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdout};
use tokio::sync::Mutex as AsyncMutex;

const ENDPOINT_WAIT_ATTEMPTS: usize = 100;
const ENDPOINT_WAIT_INTERVAL: Duration = Duration::from_millis(50);
const REAPER_POLL_INTERVAL: Duration = Duration::from_millis(500);

pub(crate) struct BackendProcessState<E: Clone + Send + 'static> {
    inner: Arc<BackendProcessInner<E>>,
}

struct BackendProcessInner<E: Clone + Send + 'static> {
    child: AsyncMutex<Option<Child>>,
    endpoint: Mutex<Option<E>>,
    last_error: Mutex<Option<String>>,
    lifecycle: AsyncMutex<()>,
}

impl<E: Clone + Send + 'static> Default for BackendProcessState<E> {
    fn default() -> Self {
        Self {
            inner: Arc::new(BackendProcessInner {
                child: AsyncMutex::new(None),
                endpoint: Mutex::new(None),
                last_error: Mutex::new(None),
                lifecycle: AsyncMutex::new(()),
            }),
        }
    }
}

impl<E: Clone + Send + 'static> Drop for BackendProcessState<E> {
    fn drop(&mut self) {
        self.stop_sync();
    }
}

impl<E: Clone + Send + 'static> BackendProcessState<E> {
    pub(crate) async fn start<F, P>(&self, spawn_child: F, parse_ready: P) -> Result<(), String>
    where
        F: FnOnce() -> Result<(Child, ChildStdout), String>,
        P: Fn(serde_json::Value) -> Option<E> + Send + 'static,
    {
        let _guard = self.inner.lifecycle.lock().await;
        if self.inner.refresh_child_status().await {
            return Ok(());
        }

        self.inner.clear_runtime_state();
        let (child, stdout) = spawn_child()?;
        {
            let mut guard = self.inner.child.lock().await;
            *guard = Some(child);
        }

        self.spawn_stdout_reader(stdout, parse_ready);
        self.spawn_reaper();
        Ok(())
    }

    pub(crate) async fn stop(&self) {
        let _guard = self.inner.lifecycle.lock().await;
        self.inner.stop_child().await;
        self.inner.clear_runtime_state();
    }

    pub(crate) fn stop_sync(&self) {
        if let Ok(mut child) = self.inner.child.try_lock() {
            if let Some(mut ch) = child.take() {
                let _ = ch.start_kill();
            }
        }
        self.inner.clear_runtime_state();
    }

    pub(crate) fn runtime_error(&self) -> Option<String> {
        self.inner.runtime_error()
    }

    pub(crate) fn clear_runtime_state(&self) {
        self.inner.clear_runtime_state();
    }

    pub(crate) fn set_runtime_error(&self, value: String) {
        self.inner.set_runtime_error(value);
    }

    pub(crate) async fn endpoint(&self, not_ready_message: &str) -> Result<E, String> {
        for _ in 0..ENDPOINT_WAIT_ATTEMPTS {
            self.inner.refresh_child_status().await;
            if let Some(error) = self.inner.runtime_error() {
                return Err(error);
            }
            if let Some(endpoint) = self.inner.endpoint() {
                return Ok(endpoint);
            }
            tokio::time::sleep(ENDPOINT_WAIT_INTERVAL).await;
        }
        Err(not_ready_message.to_string())
    }

    fn spawn_stdout_reader<P>(&self, stdout: ChildStdout, parse_ready: P)
    where
        P: Fn(serde_json::Value) -> Option<E> + Send + 'static,
    {
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                if let Some(endpoint) = parse_ready(value) {
                    inner.set_endpoint(endpoint);
                }
            }
        });
    }

    fn spawn_reaper(&self) {
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(REAPER_POLL_INTERVAL).await;
                if !inner.refresh_child_status().await {
                    return;
                }
            }
        });
    }
}

impl<E: Clone + Send + 'static> BackendProcessInner<E> {
    async fn stop_child(&self) {
        let child = {
            let mut guard = self.child.lock().await;
            guard.take()
        };
        if let Some(mut ch) = child {
            let _ = ch.start_kill();
            let _ = ch.wait().await;
        }
    }

    async fn refresh_child_status(&self) -> bool {
        let mut exit_message = None;
        let running = {
            let mut child = self.child.lock().await;
            let Some(ch) = child.as_mut() else {
                return false;
            };
            match ch.try_wait() {
                Ok(Some(status)) => {
                    let code = status
                        .code()
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "unknown".to_string());
                    exit_message = Some(format!("后台进程已退出，exitCode={code}"));
                    let _ = child.take();
                    false
                }
                Ok(None) => true,
                Err(error) => {
                    exit_message = Some(format!("后台进程状态读取失败: {error}"));
                    let _ = child.take();
                    false
                }
            }
        };

        if let Some(message) = exit_message {
            self.clear_endpoint();
            self.set_runtime_error(message);
        }

        running
    }

    fn endpoint(&self) -> Option<E> {
        self.endpoint.lock().ok().and_then(|value| value.clone())
    }

    fn runtime_error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|value| value.clone())
    }

    fn clear_runtime_state(&self) {
        self.clear_endpoint();
        if let Ok(mut error) = self.last_error.lock() {
            *error = None;
        }
    }

    fn clear_endpoint(&self) {
        if let Ok(mut endpoint) = self.endpoint.lock() {
            *endpoint = None;
        }
    }

    fn set_runtime_error(&self, value: String) {
        if let Ok(mut error) = self.last_error.lock() {
            *error = Some(value);
        }
    }

    fn set_endpoint(&self, value: E) {
        if let Ok(mut endpoint) = self.endpoint.lock() {
            *endpoint = Some(value);
        }
        if let Ok(mut error) = self.last_error.lock() {
            *error = None;
        }
    }
}
