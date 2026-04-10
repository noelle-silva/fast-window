#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UiMode {
    MainVisible,
    BrowserVisible,
    Hidden,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WakeEvent {
    WakeKey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WakeAction {
    ShowMain,
    HideMain,
    ShowBrowser,
    HideBrowser,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub mode: UiMode,
    pub browser_active: bool,
    pub browser_exists: bool,
    pub browser_visible: bool,
    pub browser_focused: bool,
    pub main_visible: bool,
}

pub fn decide(snapshot: Snapshot, event: WakeEvent) -> (UiMode, WakeAction) {
    match event {
        WakeEvent::WakeKey => decide_wake_key(snapshot),
    }
}

fn decide_wake_key(snapshot: Snapshot) -> (UiMode, WakeAction) {
    let browser_should_own_wake =
        snapshot.browser_active && snapshot.browser_exists
            || (snapshot.browser_exists
                && (snapshot.browser_visible
                    || snapshot.browser_focused
                    || snapshot.mode == UiMode::BrowserVisible));

    if browser_should_own_wake {
        if snapshot.browser_visible {
            return (UiMode::Hidden, WakeAction::HideBrowser);
        }
        return (UiMode::BrowserVisible, WakeAction::ShowBrowser);
    }

    if snapshot.main_visible {
        return (UiMode::Hidden, WakeAction::HideMain);
    }
    (UiMode::MainVisible, WakeAction::ShowMain)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s() -> Snapshot {
        Snapshot {
            mode: UiMode::Hidden,
            browser_active: false,
            browser_exists: false,
            browser_visible: false,
            browser_focused: false,
            main_visible: false,
        }
    }

    #[test]
    fn browser_visible_hides_browser() {
        let mut snap = s();
        snap.browser_exists = true;
        snap.browser_active = true;
        snap.browser_visible = true;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::Hidden);
        assert_eq!(action, WakeAction::HideBrowser);
    }

    #[test]
    fn browser_exists_and_active_shows_browser_when_hidden() {
        let mut snap = s();
        snap.browser_exists = true;
        snap.browser_active = true;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::BrowserVisible);
        assert_eq!(action, WakeAction::ShowBrowser);
    }

    #[test]
    fn browser_focused_shows_browser_even_if_not_visible() {
        let mut snap = s();
        snap.browser_exists = true;
        snap.browser_focused = true;
        snap.browser_visible = false;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::BrowserVisible);
        assert_eq!(action, WakeAction::ShowBrowser);
    }

    #[test]
    fn browser_mode_drift_shows_browser_when_not_visible() {
        let mut snap = s();
        snap.mode = UiMode::BrowserVisible;
        snap.browser_exists = true;
        snap.browser_visible = false;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::BrowserVisible);
        assert_eq!(action, WakeAction::ShowBrowser);
    }

    #[test]
    fn browser_exists_but_not_active_and_not_in_browser_mode_toggles_main() {
        let mut snap = s();
        snap.browser_exists = true;
        snap.browser_active = false;
        snap.mode = UiMode::Hidden;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::MainVisible);
        assert_eq!(action, WakeAction::ShowMain);
    }

    #[test]
    fn main_visible_hides_main() {
        let mut snap = s();
        snap.main_visible = true;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::Hidden);
        assert_eq!(action, WakeAction::HideMain);
    }

    #[test]
    fn main_hidden_shows_main() {
        let snap = s();

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::MainVisible);
        assert_eq!(action, WakeAction::ShowMain);
    }

    #[test]
    fn browser_visible_wins_over_main_visible() {
        let mut snap = s();
        snap.browser_exists = true;
        snap.browser_visible = true;
        snap.main_visible = true;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::Hidden);
        assert_eq!(action, WakeAction::HideBrowser);
    }

    #[test]
    fn browser_active_wins_over_main_visible_even_if_browser_not_visible() {
        let mut snap = s();
        snap.browser_exists = true;
        snap.browser_active = true;
        snap.main_visible = true;
        snap.browser_visible = false;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::BrowserVisible);
        assert_eq!(action, WakeAction::ShowBrowser);
    }

    #[test]
    fn browser_mode_drift_hides_browser_when_visible() {
        let mut snap = s();
        snap.mode = UiMode::BrowserVisible;
        snap.browser_exists = true;
        snap.browser_visible = true;

        let (mode, action) = decide(snap, WakeEvent::WakeKey);
        assert_eq!(mode, UiMode::Hidden);
        assert_eq!(action, WakeAction::HideBrowser);
    }
}
