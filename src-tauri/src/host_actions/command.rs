use super::{
    HostActionError, HostActionErrorCode, HostActionTarget, HostAppAction,
};

pub(crate) struct ParsedCommand {
    pub(crate) action: HostAppAction,
    pub(crate) target: HostActionTarget,
}

/// 解析一行短命令。
///
/// 语法只有一个形状：`<动作> <目标>`。动作词与目标都必填，
/// 不做「缺目标就停全部」这类隐式猜测——调度类操作宁可多问一次，也不替用户扩大影响面。
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
        _ => {
            return Err(HostActionError::new(
                HostActionErrorCode::UnknownAction,
                format!("不认识的动作「{head}」，可用：stop / kill"),
            ))
        }
    };

    if rest.is_empty() {
        return Err(HostActionError::new(
            HostActionErrorCode::MissingTarget,
            "缺少目标，例如 stop venera 或 stop --all",
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
    fn parses_all_target() {
        let parsed = parse_command("stop --all").expect("command should parse");
        assert_eq!(parsed.target, HostActionTarget::AllRunning);
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
        let error = match parse_command("start venera") {
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
