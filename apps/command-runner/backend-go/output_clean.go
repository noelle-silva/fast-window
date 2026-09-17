package main

import (
	"regexp"
	"strings"
)

// terminalEscapePattern 覆盖终端控制序列：CSI（ESC [ 参数 终止符）与 OSC（ESC ] 内容 BEL/ESC \）。
var terminalEscapePattern = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)

// sanitizeOutputLine 把子进程的原始输出行清洗成可展示的纯文本：
// 去掉终端控制序列（颜色、光标、标题等），退格按逐字擦除处理，回车按行内覆盖处理
// （保留覆盖后的剩余内容），其余不可见控制字符直接丢弃。
// 制表符与全部可见字符（含中文与符号）原样保留。
func sanitizeOutputLine(line string) string {
	line = terminalEscapePattern.ReplaceAllString(line, "")
	line = strings.TrimRight(line, "\r")

	out := make([]rune, 0, len(line))
	for _, r := range line {
		switch {
		case r == '\b':
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
		case r == '\r':
			out = out[:0]
		case r == '\t':
			out = append(out, r)
		case r < 0x20 || r == 0x7f:
			// 其余不可见控制字符直接丢弃。
		default:
			out = append(out, r)
		}
	}
	return string(out)
}
