export type CommandHelpEntry = {
  usage: string
  description: string
}

/// 命令清单的唯一来源。
///
/// 窗口里敲 help 看到的就是这份：它必须与 dispatcher 认的动作词一一对应，
/// 新增或改名一个动作时，这里是唯一需要同步展示文案的地方。
export const COMMAND_HELP: CommandHelpEntry[] = [
  { usage: 'stop <应用>', description: '温和停止，给应用收尾机会' },
  { usage: 'kill <应用>', description: '强制停止，直接结束进程树' },
  { usage: 'start <应用>', description: '启动应用或唤到前台' },
  { usage: 'restart <应用>', description: '先停后启' },
  { usage: 'status [应用]', description: '查运行状态，省略则看全部' },
  { usage: 'list', description: '列出全部注册应用与运行态' },
  { usage: 'folder <应用>', description: '打开应用所在文件夹' },
  { usage: 'info <应用>', description: '查看路径、版本与类型' },
  { usage: 'capability <应用>', description: '读取应用当前声明的能力' },
  { usage: 'env', description: '查看宿主注入的能力服务变量' },
  { usage: 'clear', description: '清空执行流水（也可敲 cls）' },
  { usage: 'help', description: '显示这份命令清单（也可敲 ?）' },
]
