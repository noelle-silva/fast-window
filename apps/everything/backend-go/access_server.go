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
	"strings"
	"sync"
)

// accessMaxBodyBytes 限制外部请求体大小：JSON-RPC 请求本身很小，超出即无法解析。
const accessMaxBodyBytes = 1 << 20

// accessAllowedMethods 是外部访问允许调用的只读方法白名单。
// 管理（everything.access.*）、安装（everything.setup.*）、运行（everything.runtime.*）
// 与本地副作用（openPath / copyPath / revealPath）一律不对外开放。
var accessAllowedMethods = map[string]struct{}{
	"everything.search": {},
}

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
// 并把白名单内的只读方法路由到数据能力（后台 dispatch）。
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
	if !matchAccessKey(doc, bearerKey(r)) {
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
	// 外部访问只开放白名单内的只读方法；其余一律拒绝。
	if _, allowed := accessAllowedMethods[method]; !allowed {
		writeAccessResponse(w, http.StatusForbidden, accessFailure("外部访问无权调用该方法"))
		return
	}
	result, err := a.svc.dispatchSafe(method, request.Params)
	if err != nil {
		writeAccessResponse(w, http.StatusOK, accessError(err))
		return
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

// matchAccessKey 在配置中查找密钥；逐条常数时间比较。
func matchAccessKey(doc externalAccessDoc, key string) bool {
	if key == "" {
		return false
	}
	for _, entry := range doc.Keys {
		if subtle.ConstantTimeCompare([]byte(entry.Key), []byte(key)) == 1 {
			return true
		}
	}
	return false
}

func accessSuccess(result any) accessResponse {
	return accessResponse{OK: true, Result: result}
}

func accessFailure(message string) accessResponse {
	return accessResponse{OK: false, Error: map[string]any{"message": message}}
}

// accessError 构造失败信封；错误码从错误链提取，无码时省略字段。
func accessError(err error) accessResponse {
	return accessResponse{OK: false, Error: map[string]any{"message": err.Error()}}
}

func writeAccessResponse(w http.ResponseWriter, status int, payload accessResponse) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
