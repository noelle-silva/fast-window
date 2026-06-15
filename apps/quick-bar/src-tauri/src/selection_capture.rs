#[derive(Clone, Debug)]
pub(crate) struct SelectionCapture {
    pub(crate) text: String,
    pub(crate) anchor_x: i32,
    pub(crate) anchor_y: i32,
}
