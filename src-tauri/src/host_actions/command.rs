use super::{
    HostActionError, HostActionErrorCode, HostActionTarget, HostAppAction,
};

pub(crate) struct ParsedCommand {
    pub(crate) action: HostAppAction,
    pub(crate) target: HostActionTarget,
}

const ACTION_LIST: &str =
    "stop / kill / start / restart / status / list / folder / info / capability / env";

/// 解析一行短命令。
///
/// 语法只有一个形状：`<动作> [目标]`。目标在绝大多数动作下必填；
/// 只有查询类动作与宿主级动作允许省略，省略即看全部或看宿主自己。
/// 调度类操作宁可多问一次，也不替用户扩大影响面。
pub(crate) fn parse_command(input: &str) -> Result<ParsedCommand, HostActionError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(HostActionError::new(
            HostActionErrorCode::EmptyCommand,
            "请输入命令，例如 stop venera",
        ));
    }

    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let head = parts.next().unwrap_or_default().to_lowercase();
    let rest = parts.next().unwrap_or_default().trim();

    let action = match head.as_str() {
        "stop" => HostAppAction::Stop,
        "kill" | "force-stop" | "force_stop" => HostAppAction::ForceStop,
        "start" => HostAppAction::Start,
        "restart" => HostAppAction::Restart,
        "status" => HostAppAction::Status,
        "list" => HostAppAction::List,
        "folder" => HostAppAction::Folder,
        "info" => HostAppAction::Info,
        "capability" => HostAppAction::Capability,
        "env" => HostAppAction::Env,
        _ => {
            return Err(HostActionError::new(
                HostActionErrorCode::UnknownAction,
                format!("不认识的动作「{head}」，可用：{ACTION_LIST}"),
            ))
        }
    };

    if action == HostAppAction::List && !rest.is_empty() {
        return Err(HostActionError::new(
            HostActionErrorCode::InvalidCommand,
            "list 不需要目标，直接输入 list 即可",
        ));
    }

    // env 的目标会被 dispatcher 忽略，因此写不写都合法。
    let target_optional = matches!(
        action,
        HostAppAction::Status | HostAppAction::List | HostAppAction::Env
    );

    if rest.is_empty() {
        if target_optional {
            return Ok(ParsedCommand {
                action,
                target: HostActionTarget::All,
            });
        }
        return Err(HostActionError::new(
            HostActionErrorCode::MissingTarget,
            format!("缺少目标，例如 {} venera", action.label()),
        ));
    }

    Ok(ParsedCommand {
        action,
        target: HostActionTarget::from_raw(rest),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_graceful_stop() {
        let parsed = parse_command("stop venera").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::Stop);
        assert_eq!(
            parsed.target,
            HostActionTarget::App("venera".to_string())
        );
    }

    #[test]
    fn parses_force_stop_aliases() {
        for text in ["kill venera", "force-stop venera", "force_stop venera"] {
            let parsed = parse_command(text).expect("command should parse");
            assert_eq!(parsed.action, HostAppAction::ForceStop);
            assert_eq!(
                parsed.target,
                HostActionTarget::App("venera".to_string())
            );
        }
    }

    #[test]
    fn parses_new_actions() {
        for (text, expected) in [
            ("start venera", HostAppAction::Start),
            ("restart venera", HostAppAction::Restart),
            ("status venera", HostAppAction::Status),
            ("folder venera", HostAppAction::Folder),
            ("info venera", HostAppAction::Info),
        ] {
            let parsed = parse_command(text).expect("command should parse");
            assert_eq!(parsed.action, expected);
            assert_eq!(
                parsed.target,
                HostActionTarget::App("venera".to_string())
            );
        }
    }

    #[test]
    fn parses_capability_with_target() {
        let parsed = parse_command("capability venera").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::Capability);
        assert_eq!(
            parsed.target,
            HostActionTarget::App("venera".to_string())
        );
    }

    #[test]
    fn capability_all_target_is_left_to_dispatcher() {
        // 解析层不替 dispatcher 做判断：--all 照样解成 All，由 dispatcher 统一拒绝，
        // 这样窗口与 HTTP 两条入口拿到的是同一句错误文案。
        let parsed = parse_command("capability --all").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::Capability);
        assert_eq!(parsed.target, HostActionTarget::All);
    }

    #[test]
    fn env_needs_no_target() {
        let parsed = parse_command("env").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::Env);
        assert_eq!(parsed.target, HostActionTarget::All);
    }

    #[test]
    fn env_tolerates_a_target() {
        // 目标对 env 没有语义，dispatcher 会忽略它；解析层因此不制造额外错误。
        let parsed = parse_command("env venera").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::Env);
        assert_eq!(
            parsed.target,
            HostActionTarget::App("venera".to_string())
        );
    }

    #[test]
    fn parses_all_target() {
        let parsed = parse_command("stop --all").expect("command should parse");
        assert_eq!(parsed.target, HostActionTarget::All);
    }

    #[test]
    fn list_needs_no_target() {
        let parsed = parse_command("list").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::List);
        assert_eq!(parsed.target, HostActionTarget::All);
    }

    #[test]
    fn list_rejects_target() {
        let error = match parse_command("list venera") {
            Ok(_) => panic!("list with target must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code, HostActionErrorCode::InvalidCommand);
    }

    #[test]
    fn status_defaults_to_all() {
        let parsed = parse_command("status").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::Status);
        assert_eq!(parsed.target, HostActionTarget::All);
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let parsed = parse_command("  STOP   venera  ").expect("command should parse");
        assert_eq!(parsed.action, HostAppAction::Stop);
        assert_eq!(
            parsed.target,
            HostActionTarget::App("venera".to_string())
        );
    }

    #[test]
    fn rejects_empty_command() {
        let error = match parse_command("   ") {
            Ok(_) => panic!("blank command must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code, HostActionErrorCode::EmptyCommand);
    }

    #[test]
    fn rejects_unknown_action() {
        let error = match parse_command("launch venera") {
            Ok(_) => panic!("unknown action must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code, HostActionErrorCode::UnknownAction);
    }

    #[test]
    fn rejects_missing_target() {
        let error = match parse_command("stop") {
            Ok(_) => panic!("missing target must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code, HostActionErrorCode::MissingTarget);
    }
}
