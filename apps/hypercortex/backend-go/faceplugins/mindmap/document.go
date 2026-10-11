// Package mindmap 是思维导图面（mindmap）的数据语义半包。
// 它只实现协议要求的内容语义，不感知宿主存储、索引与编排结构。
package mindmap

import (
	"encoding/json"
	"strings"
)

// node 是导图内容 JSON 里的一个节点；内容格式与前端导图库对齐：{data:{text},children:[]}。
type node struct {
	Data     nodeData `json:"data"`
	Children []node   `json:"children"`
}

// nodeData 是节点自身数据；数据语义半包只关心文本。
type nodeData struct {
	Text string `json:"text"`
}

// parseDocument 解析导图内容 JSON；非法内容返回 false。
func parseDocument(content string) (node, bool) {
	var root node
	if err := json.Unmarshal([]byte(content), &root); err != nil {
		return node{}, false
	}
	return root, true
}

// walkTexts 先根深度遍历导图节点，逐个交出节点文本。
func walkTexts(current node, visit func(string)) {
	visit(current.Data.Text)
	for i := range current.Children {
		walkTexts(current.Children[i], visit)
	}
}

// newDocument 生成一个只含单个根节点的导图内容；根文本取笔记标题，缺省「中心主题」。
func newDocument(rootText string) string {
	text := strings.TrimSpace(rootText)
	if text == "" {
		text = "中心主题"
	}
	payload, err := json.Marshal(node{Data: nodeData{Text: text}, Children: []node{}})
	if err != nil {
		return `{"data":{"text":"中心主题"},"children":[]}`
	}
	return string(payload)
}
