package html

import (
	"regexp"

	"fast-window-hypercortex-backend/faceplugin"
)

// htmlMaskPatterns 是网页面内容中不参与引用提取的区域：
// 脚本、样式、预格式文本、代码与 HTML 注释。
var htmlMaskPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script\s*>`),
	regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style\s*>`),
	regexp.MustCompile(`(?is)<pre\b[^>]*>.*?</pre\s*>`),
	regexp.MustCompile(`(?is)<code\b[^>]*>.*?</code\s*>`),
	regexp.MustCompile(`(?s)<!--.*?-->`),
}

// maskCode 与前端 html 插件 extractRefs.ts 保持一致：把代码/注释区域替换为等长空格。
func maskCode(content string) string {
	buf := []byte(content)
	for _, pattern := range htmlMaskPatterns {
		for _, loc := range pattern.FindAllIndex(buf, -1) {
			for i := loc[0]; i < loc[1]; i++ {
				buf[i] = ' '
			}
		}
	}
	return string(buf)
}

// ExtractRefs 提取网页面内容中的系统引用：先遮蔽 HTML 代码/注释区域，再按统一占位符语法解析。
func ExtractRefs(content string) []faceplugin.Ref {
	return faceplugin.ExtractPlaceholderRefs(maskCode(content))
}
