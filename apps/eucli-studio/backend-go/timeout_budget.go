package main

import (
	"net/http"
	"strings"
	"time"
)

// 三层超时预算（design-5 契约 2）：
//
//	交互类：box 10s  < studio 15s < 前端 20s
//	后台类：box 30s  < studio 40s < 前端 45s
//	T_work 独立于以上三者，只归 box（模型 300s、流空闲 120s 保持不变）。
//
// 不变量：T_transport(内层) < T_transport(外层) < T_interaction。
// 任何一层都不允许越过自己的预算去等下一层。
type timeoutClass int

const (
	timeoutClassInteraction timeoutClass = iota
	timeoutClassBackground
)

const (
	boxInteractionTimeout      = 10 * time.Second
	boxBackgroundTimeout       = 30 * time.Second
	studioInteractionTimeout   = 15 * time.Second
	studioBackgroundTimeout    = 40 * time.Second
	frontendInteractionTimeout = 20 * time.Second
	frontendBackgroundTimeout  = 45 * time.Second

	// httpClientAbsoluteTimeout 是 studio → box 这一跳的绝对上限：
	// 它高于 studio 后台预算，但远低于旧的 120s，任何漏配路径都不会再跑 120s。
	httpClientAbsoluteTimeout = 45 * time.Second
)

func studioTimeoutForClass(class timeoutClass) time.Duration {
	if class == timeoutClassBackground {
		return studioBackgroundTimeout
	}
	return studioInteractionTimeout
}

func boxTimeoutForClass(class timeoutClass) time.Duration {
	if class == timeoutClassBackground {
		return boxBackgroundTimeout
	}
	return boxInteractionTimeout
}

// methodTimeoutClass 只按「交互 / 后台」两种语义分类：
// 读与健康检查属于交互；写、命令、上传属于后台。
//
// envelope 是 dispatch 已经解析好的透传信封（netRequest / eb.request）：
// 它们的语义由承载的 HTTP 方法与路径决定，必须与 ebTimeoutClass 保持一致，
// 否则会出现「studio 中间层比前端外层还长」的倒挂。
// 传零值表示非透传请求。
func methodTimeoutClass(method string, envelope ebRequest) timeoutClass {
	switch method {
	case "aiChat.storageGet",
		"aiChat.storageGetMany",
		"aiChat.sessionIndex.get",
		"aiChat.sessionSummary.list",
		"aiChat.session.get",
		"aiChat.session.window",
		// session.graph 是纯读投影：与 window/get 同属交互预算，
		// 否则前端 20s < studio 40s，中间层比外层还长。
		"aiChat.session.graph",
		"aiChat.setActiveChat",
		"aiChat.imageRead",
		"eucli.config.get",
		"releaseCandidates.list",
		"artifacts.installations",
		"aiChat.healthCheck",
		"studio.bootstrap":
		return timeoutClassInteraction
	case "aiChat.netRequest", "eucli.eb.request":
		return ebTimeoutClass(envelope)
	default:
		return timeoutClassBackground
	}
}

// ebTimeoutClass 按「这一跳到 box 的动作语义」分类：
// GET 是读（交互），其余是写 / 命令（后台）。
func ebTimeoutClass(req ebRequest) timeoutClass {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" || method == http.MethodGet {
		return timeoutClassInteraction
	}
	// 停止运行是用户点击的交互命令，必须快速返回，不能被后台预算拖长。
	if strings.HasSuffix(strings.TrimRight(strings.TrimSpace(req.Path), "/"), "/cancel") {
		return timeoutClassInteraction
	}
	return timeoutClassBackground
}

// timeoutBudgetFor 是 healthCheck 对外公布的前端预算：
// 前端只消费这里给出的数字，绝不自己另写一套常量。
func frontendTimeoutBudget() map[string]any {
	return map[string]any{
		"interactionMs": int(frontendInteractionTimeout / time.Millisecond),
		"backgroundMs":  int(frontendBackgroundTimeout / time.Millisecond),
	}
}
