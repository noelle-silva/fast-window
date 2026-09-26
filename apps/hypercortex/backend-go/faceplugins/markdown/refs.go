package markdown

import (
	"regexp"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

var fenceLineHeadRe = regexp.MustCompile(`^[ \t]{0,3}` + "```")
var fenceLineSeekRe = regexp.MustCompile(`\n[ \t]{0,3}` + "```")

// maskFencedCodeBlocks 与前端 markdown 插件 extractRefs.ts 保持一致：遮蔽 ``` 围栏代码块（含闭合行换行）。
func maskFencedCodeBlocks(content string) string {
	buf := []byte(content)
	pos := 0
	for {
		openAt, ok := nextFenceOpenIndex(content, pos)
		if !ok {
			break
		}
		end := len(content)
		if closeAt, found := nextFenceOpenIndex(content, openAt+3); found {
			if lineEnd := strings.IndexByte(content[closeAt+3:], '\n'); lineEnd >= 0 {
				end = closeAt + 3 + lineEnd + 1
			}
		}
		for i := openAt; i < end; i++ {
			buf[i] = ' '
		}
		pos = end
	}
	return string(buf)
}

// nextFenceOpenIndex 等价前端 extractRefs.ts openRe.exec 语义：^ 仅匹配文本头，其余围栏必须出现在行首 \n 之后。
func nextFenceOpenIndex(src string, pos int) (openAt int, ok bool) {
	if pos == 0 {
		if loc := fenceLineHeadRe.FindStringIndex(src); loc != nil && loc[0] == 0 {
			return 0, true
		}
	}
	loc := fenceLineSeekRe.FindStringIndex(src[pos:])
	if loc == nil {
		return 0, false
	}
	return pos + loc[1] - 3, true
}

// maskInlineCodeSpans 与前端 markdown 插件 extractRefs.ts 保持一致：遮蔽行内代码双反引号/单反引号区间（含两端标记）。
func maskInlineCodeSpans(content string) string {
	buf := []byte(content)
	i := 0
	for i < len(content) {
		if content[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(content) && content[j] == '`' {
			j++
		}
		fence := content[i:j]
		closeAt := strings.Index(content[j:], fence)
		if closeAt < 0 {
			i = j
			continue
		}
		closeAt += j
		end := closeAt + len(fence)
		for p := i; p < end; p++ {
			buf[p] = ' '
		}
		i = end
	}
	return string(buf)
}

func maskCode(content string) string {
	return maskInlineCodeSpans(maskFencedCodeBlocks(content))
}

// ExtractRefs 提取文本面内容中的系统引用：先遮蔽 markdown 代码区域，再按统一占位符语法解析。
func ExtractRefs(content string) []faceplugin.Ref {
	return faceplugin.ExtractPlaceholderRefs(maskCode(content))
}
