package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// 实体图标（笔记 / 收藏夹 / 附件）：种类 + 取值 的统一描述。
// 种类只有四种：default（不设自定义图标）、library（图标库名称）、image（图片文件引用）、svg（SVG 文本）。
// 图片的二进制不进入元数据，元数据只记种类与文件引用；SVG 以文本直接存进元数据。
const (
	iconsDir     = "Icons"
	noteAssetsDir = "assets"
)

type entityIcon struct {
	Kind string `json:"kind"`
	Name string `json:"name,omitempty"`
	Path string `json:"path,omitempty"`
	SVG  string `json:"svg,omitempty"`
}

// normalizeEntityIcon 把任意提交值收敛为规范图标：default / 空值返回 nil（无自定义图标）。
// 各取值种类必须携带对应字段，否则快速失败。
func normalizeEntityIcon(raw any) (*entityIcon, error) {
	if raw == nil {
		return nil, nil
	}
	rec, ok := raw.(map[string]any)
	if !ok {
		return nil, errors.New("图标描述必须是对象")
	}
	kind := strings.TrimSpace(asString(rec["kind"]))
	switch kind {
	case "", "default":
		return nil, nil
	case "library":
		name := strings.TrimSpace(asString(rec["name"]))
		if name == "" {
			return nil, errors.New("图标库图标缺少名称")
		}
		return &entityIcon{Kind: "library", Name: name}, nil
	case "image":
		path := strings.TrimSpace(asString(rec["path"]))
		if path == "" {
			return nil, errors.New("图片图标缺少文件引用")
		}
		return &entityIcon{Kind: "image", Path: filepath.ToSlash(path)}, nil
	case "svg":
		svg := strings.TrimSpace(asString(rec["svg"]))
		if svg == "" {
			return nil, errors.New("SVG 图标缺少内容")
		}
		return &entityIcon{Kind: "svg", SVG: svg}, nil
	default:
		return nil, fmt.Errorf("未知图标种类：%s", kind)
	}
}

// entityIconFromRaw 是宽松读取：非法图标描述按「无自定义图标」处理，保证旧数据与脏数据可加载。
func entityIconFromRaw(raw any) *entityIcon {
	icon, err := normalizeEntityIcon(raw)
	if err != nil {
		return nil
	}
	return icon
}

// sanitizeEntityIcon 对已结构化的图标做一次规范化校验；非法时按「无自定义图标」处理。
func sanitizeEntityIcon(icon *entityIcon) *entityIcon {
	if icon == nil {
		return nil
	}
	return entityIconFromRaw(map[string]any{"kind": icon.Kind, "name": icon.Name, "path": icon.Path, "svg": icon.SVG})
}

func entityIconEqual(a *entityIcon, b *entityIcon) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Kind == b.Kind && a.Name == b.Name && a.Path == b.Path && a.SVG == b.SVG
}

// sanitizeIconID 把实体标识收敛为安全的文件名片段（文件名包含实体类型与标识，避免冲突）。
func sanitizeIconID(value string) string {
	out := make([]rune, 0, len(value))
	for _, r := range strings.TrimSpace(value) {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
			continue
		}
		out = append(out, '_')
	}
	if len(out) == 0 {
		return "x"
	}
	return string(out)
}

// assetExtFromMime 由 MIME 反查扩展名（图标图片落盘用）。
func assetExtFromMime(mimeType string) string {
	m := normalizeAssetMime(mimeType)
	for _, item := range assetFileTypes {
		if normalizeAssetMime(item.Mime) == m {
			return normalizeAssetFileExt(item.Ext)
		}
		for _, alias := range item.MimeAliases {
			if normalizeAssetMime(alias) == m {
				return normalizeAssetFileExt(item.Ext)
			}
		}
	}
	return ""
}

// decodeIconDataURL 解析 base64 图片数据 URL，返回二进制与扩展名。
func decodeIconDataURL(dataURL string) ([]byte, string, error) {
	s := strings.TrimSpace(dataURL)
	if !strings.HasPrefix(s, "data:") {
		return nil, "", errors.New("图片数据无效")
	}
	comma := strings.Index(s, ",")
	if comma < 0 {
		return nil, "", errors.New("图片数据无效")
	}
	header := s[:comma]
	if !strings.Contains(header, ";base64") {
		return nil, "", errors.New("图片数据必须是 base64")
	}
	mimeType := strings.TrimPrefix(strings.SplitN(header, ";", 2)[0], "data:")
	ext := assetExtFromMime(mimeType)
	if ext == "" {
		return nil, "", fmt.Errorf("不支持的图片类型：%s", mimeType)
	}
	payload := strings.NewReplacer("\n", "", "\r", "", " ", "").Replace(s[comma+1:])
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, "", errors.New("图片数据解析失败")
	}
	if len(data) == 0 {
		return nil, "", errors.New("图片数据为空")
	}
	return data, ext, nil
}

// iconFullRel 把图标引用解析为作用域内的完整相对路径：
// 笔记图标的引用相对笔记包，收藏夹/附件图标的引用相对仓库根。
func iconFullRel(targetKind string, ref string, path string) string {
	clean := filepath.ToSlash(strings.TrimSpace(path))
	if targetKind == "note" {
		return filepath.ToSlash(filepath.Join(strings.TrimSpace(ref), clean))
	}
	return clean
}

// iconWriteRel 计算新图片图标的目标相对路径。
func iconWriteRel(targetKind string, ref string, ext string) string {
	switch targetKind {
	case "note":
		return filepath.ToSlash(filepath.Join(strings.TrimSpace(ref), noteAssetsDir, "icon."+ext))
	case "folder":
		return filepath.ToSlash(filepath.Join(iconsDir, "folder_"+sanitizeIconID(ref)+"."+ext))
	default:
		return filepath.ToSlash(filepath.Join(iconsDir, "asset_"+sanitizeIconID(ref)+"."+ext))
	}
}

// iconPathFromWriteRel 把写盘用的完整相对路径换算回元数据中记录的引用形态。
func iconPathFromWriteRel(targetKind string, ref string, writeRel string) string {
	if targetKind == "note" {
		prefix := filepath.ToSlash(strings.TrimSpace(ref)) + "/"
		return strings.TrimPrefix(filepath.ToSlash(writeRel), prefix)
	}
	return filepath.ToSlash(writeRel)
}

// deleteIconFile 删除图标图片文件（不存在时静默忽略）。
func (svc *service) deleteIconFile(scope string, targetKind string, ref string, icon *entityIcon) {
	if icon == nil || icon.Kind != "image" || strings.TrimSpace(icon.Path) == "" {
		return
	}
	full := iconFullRel(targetKind, ref, icon.Path)
	target, err := svc.resolvePath(scope, full)
	if err != nil {
		return
	}
	_ = os.Remove(target)
}

// resolveIconInput 把一次图标提交解析为规范图标：
// - default / 空：返回 nil（恢复默认）；
// - library / svg：直接规范；
// - image：带 dataUrl 时落盘新图片并返回新引用；不带 dataUrl 时沿用当前图片引用（未换图）。
func (svc *service) resolveIconInput(scope string, targetKind string, ref string, input map[string]any, current *entityIcon) (*entityIcon, error) {
	kind := strings.TrimSpace(asString(input["kind"]))
	switch kind {
	case "", "default":
		return nil, nil
	case "library", "svg":
		return normalizeEntityIcon(input)
	case "image":
		dataURL := strings.TrimSpace(asString(input["dataUrl"]))
		if dataURL == "" {
			if current != nil && current.Kind == "image" && strings.TrimSpace(current.Path) != "" {
				return &entityIcon{Kind: "image", Path: current.Path}, nil
			}
			return nil, errors.New("缺少图片数据")
		}
		data, ext, err := decodeIconDataURL(dataURL)
		if err != nil {
			return nil, err
		}
		writeRel := iconWriteRel(targetKind, ref, ext)
		target, err := svc.resolvePath(scope, writeRel)
		if err != nil {
			return nil, err
		}
		if err := ensureParent(target); err != nil {
			return nil, err
		}
		if err := writeFileAtomic(target, data); err != nil {
			return nil, err
		}
		return &entityIcon{Kind: "image", Path: iconPathFromWriteRel(targetKind, ref, writeRel)}, nil
	default:
		return nil, fmt.Errorf("未知图标种类：%s", kind)
	}
}

// cleanupReplacedIcon 在图标被替换后清理不再被引用的旧图片文件。
func (svc *service) cleanupReplacedIcon(scope string, targetKind string, ref string, old *entityIcon, next *entityIcon) {
	if old == nil || old.Kind != "image" {
		return
	}
	if next != nil && next.Kind == "image" && filepath.ToSlash(next.Path) == filepath.ToSlash(old.Path) {
		return
	}
	svc.deleteIconFile(scope, targetKind, ref, old)
}

func noteMetaFromManifest(manifest noteManifest, packageDir string) noteMeta {
	return noteMeta{
		ID:          manifest.ID,
		Title:       manifest.Title,
		Description: manifest.Description,
		Dir:         filepath.ToSlash(packageDir),
		CreatedAtMs: manifest.CreatedAtMs,
		UpdatedAtMs: manifest.UpdatedAtMs,
		Icon:        manifest.Icon,
	}
}

// updateNoteIcon 更新笔记图标：写入笔记包内的图片、清理旧图片、刷新清单与索引。
func (svc *service) updateNoteIcon(scope string, raw json.RawMessage, expectedVersion float64) (any, error) {
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	dir := strings.TrimSpace(asString(input["packageDir"]))
	if dir == "" {
		return nil, errors.New("缺少笔记目录")
	}
	manifest, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		return nil, err
	}
	if err := checkVersionConflict("笔记", expectedVersion, manifest.UpdatedAtMs); err != nil {
		return nil, err
	}
	iconInput, _ := input["icon"].(map[string]any)
	if iconInput == nil {
		iconInput = map[string]any{}
	}
	next, err := svc.resolveIconInput(scope, "note", dir, iconInput, manifest.Icon)
	if err != nil {
		return nil, err
	}
	if entityIconEqual(next, manifest.Icon) {
		return map[string]any{"version": manifest.UpdatedAtMs, "changed": false, "manifest": manifest}, nil
	}
	svc.cleanupReplacedIcon(scope, "note", dir, manifest.Icon, next)
	manifest.Icon = next
	manifest.UpdatedAtMs = nowMs()
	manifest = normalizeManifest(manifest)
	if err := svc.writeJSON(scope, filepath.ToSlash(filepath.Join(dir, manifestFile)), manifest); err != nil {
		return nil, err
	}
	meta := noteMetaFromManifest(manifest, dir)
	if err := svc.upsertNoteMeta(scope, meta); err != nil {
		return nil, err
	}
	return map[string]any{"version": manifest.UpdatedAtMs, "changed": true, "manifest": manifest, "meta": meta}, nil
}

// updateFolderIcon 更新收藏夹图标：写入仓库根 Icons/ 下的图片、清理旧图片、写回收藏夹文档。
func (svc *service) updateFolderIcon(scope string, raw json.RawMessage) (any, error) {
	if err := repoScopeOrError(scope); err != nil {
		return nil, err
	}
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	folderID := strings.TrimSpace(asString(input["folderId"]))
	doc, err := svc.loadFavoritesForWrite(scope)
	if err != nil {
		return nil, err
	}
	folder, err := favoriteFolderOrFail(doc, folderID)
	if err != nil {
		return nil, err
	}
	iconInput, _ := input["icon"].(map[string]any)
	if iconInput == nil {
		iconInput = map[string]any{}
	}
	next, err := svc.resolveIconInput(scope, "folder", folder.ID, iconInput, folder.Icon)
	if err != nil {
		return nil, err
	}
	if entityIconEqual(next, folder.Icon) {
		return map[string]any{"version": doc.UpdatedAtMs, "changed": false, "folder": folder}, nil
	}
	svc.cleanupReplacedIcon(scope, "folder", folder.ID, folder.Icon, next)
	folder.Icon = next
	folder.UpdatedAtMs = nowMs()
	doc.Folders[folder.ID] = folder
	version, err := svc.saveFavoritesDoc(scope, doc)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "changed": true, "folder": folder}, nil
}

// updateAssetIcon 更新附件图标：写入仓库根 Icons/ 下的图片、清理旧图片、写回附件索引。
func (svc *service) updateAssetIcon(scope string, raw json.RawMessage) (any, error) {
	if err := repoScopeOrError(scope); err != nil {
		return nil, err
	}
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	assetID := strings.TrimSpace(asString(input["assetId"]))
	ext := normalizeAssetExt(asString(input["ext"]))
	if assetID == "" {
		return nil, errors.New("附件 ID 不能为空")
	}
	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		return nil, err
	}
	key := assetKey(assetID, ext)
	entry, ok := idx.Assets[key]
	if !ok || strings.TrimSpace(entry.Path) == "" {
		return nil, errors.New("附件档案不存在")
	}
	iconInput, _ := input["icon"].(map[string]any)
	if iconInput == nil {
		iconInput = map[string]any{}
	}
	next, err := svc.resolveIconInput(scope, "asset", assetID, iconInput, entry.Icon)
	if err != nil {
		return nil, err
	}
	if entityIconEqual(next, entry.Icon) {
		return map[string]any{"changed": false, "asset": assetPoolItemFromMetadata(entry)}, nil
	}
	svc.cleanupReplacedIcon(scope, "asset", assetID, entry.Icon, next)
	entry.Icon = next
	entry.UpdatedAtMs = nowMs()
	entry = newAssetMetadata(entry)
	idx.Assets[key] = entry
	if err := svc.saveAssetIndex(scope, idx); err != nil {
		return nil, err
	}
	return map[string]any{"changed": true, "asset": assetPoolItemFromMetadata(entry)}, nil
}

// trashDisplayIconForPackage 生成回收站列表用的展示图标：笔记图标的引用相对笔记包，
// 这里把它拼到回收站包目录，得到可直接读取的仓库根相对路径。非图片图标原样返回。
func trashDisplayIconForPackage(icon *entityIcon, packageDir string) *entityIcon {
	if icon == nil || icon.Kind != "image" || strings.TrimSpace(icon.Path) == "" {
		return icon
	}
	display := *icon
	display.Path = filepath.ToSlash(filepath.Join(filepath.FromSlash(strings.TrimSpace(packageDir)), filepath.FromSlash(icon.Path)))
	return &display
}

// trashDisplayIconForMovedFile 生成回收站列表用的展示图标：图片图标文件随条目移入回收站条目目录，
// 这里把文件名拼到条目目录，得到可直接读取的仓库根相对路径。非图片图标原样返回。
func trashDisplayIconForMovedFile(icon *entityIcon, entryDir string) *entityIcon {
	if icon == nil || icon.Kind != "image" || strings.TrimSpace(icon.Path) == "" {
		return icon
	}
	display := *icon
	base := filepath.Base(filepath.FromSlash(strings.TrimSpace(icon.Path)))
	display.Path = filepath.ToSlash(filepath.Join(filepath.FromSlash(strings.TrimSpace(entryDir)), base))
	return &display
}

// moveIconFileIntoDir 把图片图标文件移入目标目录（随实体进回收站），返回移动后的文件名；无图片或文件缺失返回空串。
func (svc *service) moveIconFileIntoDir(scope string, icon *entityIcon, destDir string) string {
	if icon == nil || icon.Kind != "image" || strings.TrimSpace(icon.Path) == "" {
		return ""
	}
	from, err := svc.resolvePath(scope, icon.Path)
	if err != nil || !exists(from) {
		return ""
	}
	base := filepath.Base(filepath.FromSlash(icon.Path))
	to := filepath.Join(destDir, base)
	if err := os.Rename(from, to); err != nil {
		return ""
	}
	return base
}

// restoreIconFileFromDir 把图标文件从目录移回其元数据记录的位置（随实体出回收站）；失败静默忽略。
func (svc *service) restoreIconFileFromDir(scope string, icon *entityIcon, srcDir string) {
	if icon == nil || icon.Kind != "image" || strings.TrimSpace(icon.Path) == "" {
		return
	}
	base := filepath.Base(filepath.FromSlash(icon.Path))
	from := filepath.Join(srcDir, base)
	if !exists(from) {
		return
	}
	to, err := svc.resolvePath(scope, icon.Path)
	if err != nil {
		return
	}
	if err := ensureParent(to); err != nil {
		return
	}
	_ = os.Rename(from, to)
}

// readEntityIconImage 读取图标图片并返回 data URL：笔记引用相对笔记包，其余相对仓库根。
func (svc *service) readEntityIconImage(scope string, raw json.RawMessage) (string, error) {
	input := map[string]any{}
	if err := json.Unmarshal(raw, &input); err != nil {
		return "", err
	}
	path := strings.TrimSpace(asString(input["path"]))
	if path == "" {
		return "", errors.New("图标文件引用为空")
	}
	targetKind := strings.TrimSpace(asString(input["targetKind"]))
	if targetKind == "" {
		targetKind = "asset"
	}
	ref := strings.TrimSpace(asString(input["ref"]))
	full := iconFullRel(targetKind, ref, path)
	target, err := svc.resolvePath(scope, full)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return "", err
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(target)), ".")
	mimeType := mimeFromExt(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
