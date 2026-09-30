package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// maxAccessPort 是开放端口的合法上限。
const maxAccessPort = 65535

// externalAccessKey 是一把访问密钥：name 为身份名称，key 为凭据本体。
// Everything 只有单一索引，钥匙不绑定任何范围。
type externalAccessKey struct {
	Name        string  `json:"name"`
	Key         string  `json:"key"`
	CreatedAtMs float64 `json:"createdAtMs"`
}

// externalAccessDoc 是外部访问配置文档；port 为 0 表示尚未配置端口。
type externalAccessDoc struct {
	Version int                 `json:"version"`
	Port    int                 `json:"port"`
	Keys    []externalAccessKey `json:"keys"`
}

func emptyExternalAccessDoc() externalAccessDoc {
	return externalAccessDoc{Version: 1, Keys: []externalAccessKey{}}
}

func normalizeExternalAccessDoc(doc externalAccessDoc) externalAccessDoc {
	doc.Version = 1
	if doc.Keys == nil {
		doc.Keys = []externalAccessKey{}
	}
	if doc.Port < 0 || doc.Port > maxAccessPort {
		doc.Port = 0
	}
	return doc
}

func (svc *service) externalAccessPath() string {
	return filepath.Join(svc.dataDir, svc.identity.AccessFile)
}

// loadExternalAccess 读取外部访问配置；文件不存在时返回空文档（不落盘）。
func (svc *service) loadExternalAccess() (externalAccessDoc, error) {
	doc := emptyExternalAccessDoc()
	if err := readJSON(svc.externalAccessPath(), &doc); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return emptyExternalAccessDoc(), nil
		}
		return externalAccessDoc{}, fmt.Errorf("读取外部访问配置失败：%w", err)
	}
	return normalizeExternalAccessDoc(doc), nil
}

func (svc *service) saveExternalAccess(doc externalAccessDoc) error {
	return writeJSON(svc.externalAccessPath(), normalizeExternalAccessDoc(doc))
}

// createExternalAccessKey 生成一把新密钥并持久化。
func (svc *service) createExternalAccessKey(name string) (externalAccessDoc, error) {
	keyName := strings.TrimSpace(name)
	if keyName == "" {
		return externalAccessDoc{}, errors.New("密钥名称不能为空")
	}
	key, err := newAccessKey()
	if err != nil {
		return externalAccessDoc{}, err
	}
	doc, err := svc.loadExternalAccess()
	if err != nil {
		return externalAccessDoc{}, err
	}
	doc.Keys = append(doc.Keys, externalAccessKey{Name: keyName, Key: key, CreatedAtMs: nowMs()})
	if err := svc.saveExternalAccess(doc); err != nil {
		return externalAccessDoc{}, err
	}
	return doc, nil
}

// updateExternalAccessKey 更新指定密钥的名称；密钥本体与创建时间保持不变。
func (svc *service) updateExternalAccessKey(key string, name string) (externalAccessDoc, error) {
	target := strings.TrimSpace(key)
	if target == "" {
		return externalAccessDoc{}, errors.New("缺少访问密钥")
	}
	keyName := strings.TrimSpace(name)
	if keyName == "" {
		return externalAccessDoc{}, errors.New("密钥名称不能为空")
	}
	doc, err := svc.loadExternalAccess()
	if err != nil {
		return externalAccessDoc{}, err
	}
	found := false
	for i := range doc.Keys {
		if doc.Keys[i].Key != target {
			continue
		}
		doc.Keys[i].Name = keyName
		found = true
		break
	}
	if !found {
		return externalAccessDoc{}, fmt.Errorf("访问密钥不存在：%s", target)
	}
	if err := svc.saveExternalAccess(doc); err != nil {
		return externalAccessDoc{}, err
	}
	return doc, nil
}

// deleteExternalAccessKey 删除指定密钥并持久化。
func (svc *service) deleteExternalAccessKey(key string) (externalAccessDoc, error) {
	target := strings.TrimSpace(key)
	if target == "" {
		return externalAccessDoc{}, errors.New("缺少访问密钥")
	}
	doc, err := svc.loadExternalAccess()
	if err != nil {
		return externalAccessDoc{}, err
	}
	next := make([]externalAccessKey, 0, len(doc.Keys))
	found := false
	for _, entry := range doc.Keys {
		if entry.Key == target {
			found = true
			continue
		}
		next = append(next, entry)
	}
	if !found {
		return externalAccessDoc{}, fmt.Errorf("访问密钥不存在：%s", target)
	}
	doc.Keys = next
	if err := svc.saveExternalAccess(doc); err != nil {
		return externalAccessDoc{}, err
	}
	return doc, nil
}

// saveExternalAccessPort 保存开放端口并让外部访问服务真实监听该端口；
// 端口必须是 1~65535 的整数，新端口监听失败时不改变配置与既有监听。
func (svc *service) saveExternalAccessPort(port float64) (externalAccessDoc, error) {
	if port != math.Trunc(port) || port < 1 || port > maxAccessPort {
		return externalAccessDoc{}, fmt.Errorf("端口必须是 1 到 %d 之间的整数", maxAccessPort)
	}
	doc, err := svc.loadExternalAccess()
	if err != nil {
		return externalAccessDoc{}, err
	}
	if _, err := svc.accessServer.listen(int(port)); err != nil {
		return externalAccessDoc{}, err
	}
	previousPort := doc.Port
	doc.Port = int(port)
	if err := svc.saveExternalAccess(doc); err != nil {
		// 落盘失败：尽量恢复原有监听，保持配置与运行一致。
		if previousPort > 0 {
			_, _ = svc.accessServer.listen(previousPort)
		} else {
			svc.accessServer.stop()
		}
		return externalAccessDoc{}, err
	}
	return doc, nil
}

func newAccessKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成访问密钥失败：%w", err)
	}
	return hex.EncodeToString(buf), nil
}
