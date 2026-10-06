package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// accessMaxBodyBytes 限制外部请求体大小：JSON-RPC 请求本身很小，超出即无法解析。
const accessMaxBodyBytes = 1 << 20

// accessRequest 是外部访问的请求体：方法名 + 参数。
type accessRequest struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

// accessResponse 是外部访问的响应体，与后台帧同形：ok / result / error。
type accessResponse struct {
	OK     bool           `json:"ok"`
	Result any            `json:"result,omitempty"`
	Error  map[string]any `json:"error,omitempty"`
}

// accessServer 是外部访问服务：在配置端口上监听 HTTP，校验访问密钥，
// 并把请求按密钥绑定的仓库路由到数据能力（后台 dispatch）；密钥只能访问所绑仓库。
type accessServer struct {
	svc      *service
	mu       sync.Mutex
	port     int
	listener net.Listener
	server   *http.Server
}

func newAccessServer(svc *service) *accessServer {
	return &accessServer{svc: svc}
}

// listen 让服务在指定端口上监听；先监听新端口成功后再切换，失败时保持原监听不变。
// port 为 0 时由系统分配随机端口；返回实际监听端口。
func (a *accessServer) listen(port int) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if port > 0 && a.listener != nil && a.port == port {
		return a.port, nil
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return 0, fmt.Errorf("端口 %d 监听失败：%w", port, err)
	}
	a.shutdownLocked()
	server := &http.Server{Handler: http.HandlerFunc(a.handle)}
	a.listener = listener
	a.server = server
	a.port = listener.Addr().(*net.TCPAddr).Port
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("外部访问服务停止：%v", err)
		}
	}()
	return a.port, nil
}

// stop 关闭监听（不改变已保存的配置）。
func (a *accessServer) stop() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.shutdownLocked()
}

func (a *accessServer) shutdownLocked() {
	if a.server != nil {
		_ = a.server.Close()
		a.server = nil
	}
	if a.listener != nil {
		_ = a.listener.Close()
		a.listener = nil
	}
	a.port = 0
}

func (a *accessServer) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/rpc" {
		http.NotFound(w, r)
		return
	}
	doc, err := a.svc.loadExternalAccess()
	if err != nil {
		writeAccessResponse(w, http.StatusInternalServerError, accessFailure("读取访问配置失败："+err.Error()))
		return
	}
	repoID, ok := matchAccessKey(doc, bearerKey(r))
	if !ok {
		writeAccessResponse(w, http.StatusUnauthorized, accessFailure("访问密钥无效"))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, accessMaxBodyBytes))
	if err != nil {
		writeAccessResponse(w, http.StatusBadRequest, accessFailure("读取请求失败"))
		return
	}
	var request accessRequest
	if err := json.Unmarshal(body, &request); err != nil || strings.TrimSpace(request.Method) == "" {
		writeAccessResponse(w, http.StatusBadRequest, accessFailure("请求格式无效"))
		return
	}
	method := strings.TrimSpace(request.Method)
	// 访问设置只能由本机界面管理，外部密钥一律无权触碰。
	if strings.HasPrefix(method, "hypercortex.access.") {
		writeAccessResponse(w, http.StatusForbidden, accessFailure("外部访问无权管理访问设置"))
		return
	}
	scopedParams, err := bindAccessScope(request.Params, repoID)
	if err != nil {
		writeAccessResponse(w, http.StatusForbidden, accessFailure(err.Error()))
		return
	}
	result, err := a.svc.dispatchSafe(method, scopedParams)
	if err != nil {
		writeAccessResponse(w, http.StatusOK, accessError(method, err))
		return
	}
	// 外部写入成功：把「变了」（带仓库与变更类别）顺着既有常驻连线推给前端；
	// 只推外部改的，本地界面自己的写入不经过这里。
	if kinds := changeKindsForMethod(method); len(kinds) > 0 {
		a.svc.changes.publish(repoID, kinds...)
	}
	writeAccessResponse(w, http.StatusOK, accessSuccess(result))
}

// startExternalAccessServer 按已保存的配置启动外部访问服务；未配置端口时不监听。
func (svc *service) startExternalAccessServer() error {
	doc, err := svc.loadExternalAccess()
	if err != nil {
		return err
	}
	if doc.Port <= 0 {
		return nil
	}
	port, err := svc.accessServer.listen(doc.Port)
	if err != nil {
		return err
	}
	log.Printf("外部访问服务监听 http://127.0.0.1:%d", port)
	return nil
}

// bearerKey 从 Authorization 头提取 Bearer 密钥；缺失或格式不符时返回空串。
func bearerKey(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

// matchAccessKey 在配置中查找密钥，命中时返回该密钥绑定的仓库；逐条常数时间比较。
func matchAccessKey(doc externalAccessDoc, key string) (string, bool) {
	if key == "" {
		return "", false
	}
	for _, entry := range doc.Keys {
		if subtle.ConstantTimeCompare([]byte(entry.Key), []byte(key)) == 1 {
			return entry.RepoID, true
		}
	}
	return "", false
}

// bindAccessScope 把请求参数中的仓库作用域收敛到密钥绑定的仓库：
// 调用者显式指定了其他仓库时快速失败（密钥只能访问绑定的仓库），
// 未指定或指定绑定仓库本身时统一补上绑定仓库。
func bindAccessScope(params json.RawMessage, repoID string) (json.RawMessage, error) {
	record := map[string]json.RawMessage{}
	if len(params) > 0 {
		_ = json.Unmarshal(params, &record)
	}
	if record == nil {
		record = map[string]json.RawMessage{}
	}
	if raw, ok := record["scope"]; ok && len(raw) > 0 {
		var scope string
		if err := json.Unmarshal(raw, &scope); err == nil {
			if scope = strings.TrimSpace(scope); scope != "" && scope != repoID {
				return nil, fmt.Errorf("该访问密钥只能访问绑定仓库，不能访问仓库 %s", scope)
			}
		}
	}
	record["scope"] = json.RawMessage(strconv.Quote(repoID))
	out, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("构造请求参数失败：%w", err)
	}
	return out, nil
}

func accessSuccess(result any) accessResponse {
	return accessResponse{OK: true, Result: result}
}

func accessFailure(message string) accessResponse {
	return accessResponse{OK: false, Error: map[string]any{"message": message}}
}

// accessError 构造带机器可读错误码的失败信封：码从错误链提取，无码时省略字段。
func accessError(method string, err error) accessResponse {
	payload := map[string]any{"message": convergeErrorMessage(method, err)}
	if code := convergeErrorCode(method, err); code != "" {
		payload["code"] = code
	}
	return accessResponse{OK: false, Error: payload}
}

func writeAccessResponse(w http.ResponseWriter, status int, payload accessResponse) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
