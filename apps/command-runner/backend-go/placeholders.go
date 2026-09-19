package main

import (
	"fmt"
	"regexp"
	"strings"
)

// placeholderRefPattern 匹配脚本中的占位符引用 {{名称}}；名称不含花括号。
var placeholderRefPattern = regexp.MustCompile(`\{\{[^{}]+\}\}`)

// placeholder 是一个占位符定义：名称 + 预先定义的候选值列表。
// 命令脚本以 {{名称}} 引用；运行时由界面从候选值中为每个引用选定一个值。
type placeholder struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

// normalizePlaceholders 校验并规范化一组占位符定义：
//   - 名称去首尾空白后非空、不含花括号与换行，同组内不重名；
//   - 候选值去首尾空白后非空、不含换行，同组内不重复，每个占位符至少保留一个。
func normalizePlaceholders(list []placeholder) ([]placeholder, error) {
	result := make([]placeholder, 0, len(list))
	seenNames := make(map[string]bool, len(list))
	for _, item := range list {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			return nil, fmt.Errorf("占位符名称不能为空")
		}
		if strings.ContainsAny(name, "{}") {
			return nil, fmt.Errorf("占位符名称不能包含花括号: %s", name)
		}
		if strings.ContainsAny(name, "\r\n") {
			return nil, fmt.Errorf("占位符名称不能包含换行: %s", name)
		}
		if seenNames[name] {
			return nil, fmt.Errorf("占位符「%s」重复注册", name)
		}
		seenNames[name] = true

		values := make([]string, 0, len(item.Values))
		seenValues := make(map[string]bool, len(item.Values))
		for _, raw := range item.Values {
			value := strings.TrimSpace(raw)
			if value == "" {
				return nil, fmt.Errorf("占位符「%s」的候选值不能为空", name)
			}
			if strings.ContainsAny(value, "\r\n") {
				return nil, fmt.Errorf("占位符「%s」的候选值不能包含换行", name)
			}
			if seenValues[value] {
				return nil, fmt.Errorf("占位符「%s」的候选值重复: %s", name, value)
			}
			seenValues[value] = true
			values = append(values, value)
		}
		if len(values) == 0 {
			return nil, fmt.Errorf("占位符「%s」至少需要一个候选值", name)
		}
		result = append(result, placeholder{Name: name, Values: values})
	}
	return result, nil
}

// applyPlaceholderValues 把脚本中的 {{名称}} 替换为本次运行选定的值。
// 单遍扫描：每处引用只查表一次，替换结果不再参与匹配，
// 因此候选值里即使出现引用形式也保持字面量、不受替换顺序影响。
// 未提供取值（未注册或本次未参与选择）的引用原样保留，当作脚本的真实内容。
func applyPlaceholderValues(script string, values map[string]string) string {
	if len(values) == 0 {
		return script
	}
	return placeholderRefPattern.ReplaceAllStringFunc(script, func(ref string) string {
		name := ref[2 : len(ref)-2]
		value, ok := values[name]
		if !ok {
			return ref
		}
		return value
	})
}

// collectPlaceholderNames 把一组占位符的名称以 source 为来源描述登记进占用索引。
func collectPlaceholderNames(index map[string]string, list []placeholder, source string) {
	for _, item := range list {
		if _, exists := index[item.Name]; !exists {
			index[item.Name] = source
		}
	}
}

// ensurePlaceholderNamesFree 校验一组占位符的名称均未被占用索引中的来源注册。
// 同一仓库范围内（仓库级 + 命令级）不允许同名占位符重复注册。
func ensurePlaceholderNamesFree(list []placeholder, index map[string]string) error {
	for _, item := range list {
		if source, exists := index[item.Name]; exists {
			return fmt.Errorf("占位符「%s」已被%s注册", item.Name, source)
		}
	}
	return nil
}

// commandPlaceholderOccupancy 汇总与某条命令的命令级占位符竞争的已有名称：
// 所属仓库的仓库级占位符 + 同仓库其他命令的命令级占位符。
// excludeCommandID 用于更新命令时排除自身，自身旧定义不算冲突。
func (svc *service) commandPlaceholderOccupancy(repo repo, excludeCommandID string) (map[string]string, error) {
	index := make(map[string]string)
	collectPlaceholderNames(index, repo.Placeholders, "仓库级占位符")
	doc, err := svc.loadCommands()
	if err != nil {
		return nil, err
	}
	for _, item := range doc.Commands {
		if item.RepoID != repo.ID || item.ID == excludeCommandID {
			continue
		}
		collectPlaceholderNames(index, item.Placeholders, fmt.Sprintf("命令「%s」", item.Name))
	}
	return index, nil
}

// repoLevelPlaceholderOccupancy 汇总与某仓库的仓库级占位符竞争的已有名称：
// 该仓库全部命令的命令级占位符。
func (svc *service) repoLevelPlaceholderOccupancy(repoID string) (map[string]string, error) {
	index := make(map[string]string)
	doc, err := svc.loadCommands()
	if err != nil {
		return nil, err
	}
	for _, item := range doc.Commands {
		if item.RepoID != repoID {
			continue
		}
		collectPlaceholderNames(index, item.Placeholders, fmt.Sprintf("命令「%s」", item.Name))
	}
	return index, nil
}
