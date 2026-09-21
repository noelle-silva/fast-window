//! 收藏桌面数据层。
//!
//! 只保留网址一类收藏：单工作区（分组 / 条目 / 收纳夹 / 桌面状态）+ 界面状态，
//! 数据文件与资产目录由 webview 自己的数据目录承载。

pub mod assets;
pub mod containers;
pub mod desktop;
pub mod dispatch;
pub mod groups;
pub mod identities;
pub mod items;
pub mod migration;
pub mod model;
pub mod store;
pub mod web_icons;
pub mod workspace;

#[cfg(test)]
mod business_tests;

pub use dispatch::{collections_request, CollectionsIoLock};
