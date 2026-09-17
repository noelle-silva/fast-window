package main

import "testing"

func TestSanitizeOutputLine(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{name: "去掉颜色码保留内容", in: "\x1b[32m✓ built in 5.79s\x1b[39m", want: "✓ built in 5.79s"},
		{name: "多个颜色码混排", in: "\x1b[2mdist/\x1b[22m\x1b[36massets/index.js\x1b[39m", want: "dist/assets/index.js"},
		{name: "去掉窗口标题序列", in: "\x1b]0;window title\x07content", want: "content"},
		{name: "普通文本与中文符号原样保留", in: "plain 中文 ➜ │ ✓", want: "plain 中文 ➜ │ ✓"},
		{name: "回车只保留覆盖后的剩余内容", in: "progress 10%\rprogress 50%", want: "progress 50%"},
		{name: "行尾回车来自换行不吞掉整行", in: "normal line\r", want: "normal line"},
		{name: "退格逐字擦除", in: "C\bL\bI\bN\bK\b \bE:\\dir>pnpm dev", want: "E:\\dir>pnpm dev"},
		{name: "丢弃其他控制字符", in: "bell\x07 and nul\x00 kept\x7f", want: "bell and nul kept"},
		{name: "制表符保留", in: "col1\tcol2", want: "col1\tcol2"},
	}
	for _, testCase := range cases {
		if got := sanitizeOutputLine(testCase.in); got != testCase.want {
			t.Fatalf("%s: sanitizeOutputLine(%q) = %q, want %q", testCase.name, testCase.in, got, testCase.want)
		}
	}
}
