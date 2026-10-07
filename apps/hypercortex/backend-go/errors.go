package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"regexp"
	"strings"
)

// 应用端统一错误出口的收敛机制（外部访问出口与界面出口共用）：
// 错误一律用接口语言「对象＋状态」，任何时候不出现磁盘路径、目录名与内部编号。

// 机器可读错误码：文案可改，码不变，供调用方程序化区分错误类型。
const (
	codeVersionConflict   = "VERSION_CONFLICT"
	codeVersionNotFound   = "VERSION_NOT_FOUND"
	codeUnknownFaceKind   = "UNKNOWN_FACE_KIND"
	codeDuplicateFavorite = "DUPLICATE_FAVORITE"
	codePathEscape        = "PATH_ESCAPE"
	codeFolderNotFound    = "FOLDER_NOT_FOUND"
	codeNoteNotFound      = "NOTE_NOT_FOUND"
)

// codedError 是带错误码的领域错误：Error 只给可读文案，码由出口单独提取。
type codedError struct {
	code    string
	message string
}

func (e *codedError) Error() string { return e.message }

// coded 构造带机器可读错误码的领域错误。
func coded(code string, format string, args ...any) error {
	return &codedError{code: code, message: fmt.Sprintf(format, args...)}
}

// errorCodeOf 提取错误链上的机器可读错误码；没有码时返回空串。
func errorCodeOf(err error) string {
	var target *codedError
	if errors.As(err, &target) {
		return target.code
	}
	return ""
}

// windowsAbsolutePathPattern 是兜底保险：任何漏出的磁盘路径片段都替换为中性词。
var windowsAbsolutePathPattern = regexp.MustCompile(`[A-Za-z]:\\[^\r\n]*`)

// convergeErrorMessage 把内部错误收敛为对外文本：
// 按请求方法给出对象归属，文件系统类错误收敛为「对象不存在 / 对象数据不可用」，
// 其余错误剥除可能漏出的路径片段。
func convergeErrorMessage(method string, err error) string {
	if err == nil {
		return ""
	}
	subject := errorSubject(method)
	var pathError *fs.PathError
	if errors.As(err, &pathError) || errors.Is(err, os.ErrNotExist) || errors.Is(err, fs.ErrPermission) {
		if errors.Is(err, os.ErrNotExist) {
			return subject + "不存在"
		}
		return subject + "数据不可用"
	}
	return maskAbsolutePaths(err.Error())
}

// convergeErrorCode 给出对外错误码：领域错误的码原样透出；
// 文件系统「不存在」按对象归属给出 <对象>_NOT_FOUND；其余错误没有码。
func convergeErrorCode(method string, err error) string {
	if err == nil {
		return ""
	}
	if code := errorCodeOf(err); code != "" {
		return code
	}
	if errors.Is(err, os.ErrNotExist) {
		return errorSubjectCode(method) + "_NOT_FOUND"
	}
	return ""
}

// errorSubject 把请求方法映射为接口语言里的对象名。
func errorSubject(method string) string {
	switch {
	case strings.HasPrefix(method, "hypercortex.notes."):
		return "笔记"
	case strings.HasPrefix(method, "hypercortex.icons."):
		return "图标"
	case strings.HasPrefix(method, "hypercortex.assets."):
		return "附件"
	case strings.HasPrefix(method, "hypercortex.favorites."):
		return "收藏夹"
	case strings.HasPrefix(method, "hypercortex.trash."):
		return "回收站"
	case strings.HasPrefix(method, "hypercortex.repos."):
		return "仓库"
	case strings.HasPrefix(method, "hypercortex.refs."):
		return "引用关系"
	case strings.HasPrefix(method, "hypercortex.search."):
		return "搜索数据"
	case strings.HasPrefix(method, "hypercortex.repoState."):
		return "仓库状态"
	case strings.HasPrefix(method, "hypercortex.metadata."):
		return "应用数据"
	case strings.HasPrefix(method, "hypercortex.access."):
		return "访问配置"
	default:
		return "数据"
	}
}

// errorSubjectCode 把请求方法映射为错误码里的对象前缀。
func errorSubjectCode(method string) string {
	switch {
	case strings.HasPrefix(method, "hypercortex.notes."):
		return "NOTE"
	case strings.HasPrefix(method, "hypercortex.icons."):
		return "ICON"
	case strings.HasPrefix(method, "hypercortex.assets."):
		return "ASSET"
	case strings.HasPrefix(method, "hypercortex.favorites."):
		return "FAVORITE"
	case strings.HasPrefix(method, "hypercortex.trash."):
		return "TRASH"
	case strings.HasPrefix(method, "hypercortex.repos."):
		return "REPO"
	case strings.HasPrefix(method, "hypercortex.refs."):
		return "REF"
	case strings.HasPrefix(method, "hypercortex.search."):
		return "SEARCH"
	case strings.HasPrefix(method, "hypercortex.repoState."):
		return "REPO_STATE"
	default:
		return "DATA"
	}
}

// maskAbsolutePaths 只处理可能含盘符路径的文本；无路径时不触碰原文。
func maskAbsolutePaths(message string) string {
	if !strings.Contains(message, ":\\") {
		return message
	}
	return windowsAbsolutePathPattern.ReplaceAllString(message, "（路径已收敛）")
}
