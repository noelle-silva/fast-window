use std::sync::atomic::{AtomicU32, Ordering};

static TASK_ID_SEQ: AtomicU32 = AtomicU32::new(0);

pub(crate) fn make_task_id() -> String {
    let stamp = crate::now_ms();
    let seq = TASK_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let rnd = format!("{:08x}", crate::rand_u32(stamp ^ (seq as u64)));
    format!("task-{stamp}-{seq:08x}-{rnd}")
}
