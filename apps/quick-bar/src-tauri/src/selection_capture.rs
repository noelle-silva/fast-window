use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectionCapture {
    pub(crate) text: String,
    pub(crate) anchor_x: i32,
    pub(crate) anchor_y: i32,
}
