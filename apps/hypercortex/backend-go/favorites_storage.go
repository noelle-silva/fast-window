package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"os"
	"strings"
)

type favoriteGridLayout struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

type favoriteFolder struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	CreatedAtMs float64 `json:"createdAtMs"`
	UpdatedAtMs float64 `json:"updatedAtMs"`
}

type favoriteItemRef struct {
	ID          string             `json:"id"`
	FolderID    string             `json:"folderId"`
	Kind        string             `json:"kind"`
	TargetID    string             `json:"targetId"`
	Layout      favoriteGridLayout `json:"layout"`
	CreatedAtMs float64            `json:"createdAtMs"`
	UpdatedAtMs float64            `json:"updatedAtMs"`
}

type favoritesDoc struct {
	Version        int                          `json:"version"`
	RootFolderID   string                       `json:"rootFolderId"`
	Folders        map[string]favoriteFolder    `json:"folders"`
	RefsByFolderID map[string][]favoriteItemRef `json:"refsByFolderId"`
}

func defaultFavoriteLayout() favoriteGridLayout {
	return favoriteGridLayout{X: 0, Y: 0, W: 2, H: 2}
}

func freshFavoritesDoc(now float64) favoritesDoc {
	root := favoriteFolder{ID: "root", Title: "根目录", Description: "", CreatedAtMs: now, UpdatedAtMs: now}
	return favoritesDoc{Version: 1, RootFolderID: "root", Folders: map[string]favoriteFolder{"root": root}, RefsByFolderID: map[string][]favoriteItemRef{"root": []favoriteItemRef{}}}
}

func favoriteObject(value any) map[string]any {
	if rec, ok := value.(map[string]any); ok {
		return rec
	}
	return nil
}

func favoriteList(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	return nil
}

func finiteFloat64(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func nonNegativeInt(value any, fallback int) int {
	n := asFloat(value)
	if !finiteFloat64(n) {
		return fallback
	}
	return max(0, int(math.Floor(n)))
}

func positiveTimestamp(value any, fallback float64) float64 {
	n := asFloat(value)
	if n > 0 && finiteFloat64(n) {
		return n
	}
	return fallback
}

func normalizeFavoriteLayout(raw any) favoriteGridLayout {
	base := defaultFavoriteLayout()
	rec := favoriteObject(raw)
	if rec == nil {
		return base
	}
	w := nonNegativeInt(rec["w"], base.W)
	h := nonNegativeInt(rec["h"], base.H)
	return favoriteGridLayout{
		X: nonNegativeInt(rec["x"], base.X),
		Y: nonNegativeInt(rec["y"], base.Y),
		W: max(1, w),
		H: max(1, h),
	}
}

func normalizeFavoriteFolder(now float64, id string, raw any) favoriteFolder {
	rec := favoriteObject(raw)
	title := "未命名收藏夹"
	description := ""
	created := now
	updated := now
	if rec != nil {
		title = nonEmpty(asString(rec["title"]), title)
		description = strings.TrimSpace(asString(rec["description"]))
		created = positiveTimestamp(rec["createdAtMs"], now)
		updated = positiveTimestamp(rec["updatedAtMs"], created)
	}
	if id == "root" && strings.TrimSpace(title) == "" {
		title = "根目录"
	}
	if id == "root" && title == "未命名收藏夹" {
		title = "根目录"
	}
	return favoriteFolder{ID: id, Title: title, Description: description, CreatedAtMs: created, UpdatedAtMs: updated}
}

func normalizeFavoriteRefKind(value any) string {
	switch strings.TrimSpace(asString(value)) {
	case "folder", "note", "asset":
		return strings.TrimSpace(asString(value))
	default:
		return ""
	}
}

func stableFavoriteRefID(folderID string, kind string, targetID string) string {
	return "ref_" + folderID + "__" + kind + "__" + targetID
}

func normalizeFavoriteRef(now float64, folderID string, raw any) (favoriteItemRef, bool) {
	rec := favoriteObject(raw)
	if rec == nil {
		return favoriteItemRef{}, false
	}
	kind := normalizeFavoriteRefKind(rec["kind"])
	targetID := strings.TrimSpace(asString(rec["targetId"]))
	if kind == "" || targetID == "" {
		return favoriteItemRef{}, false
	}
	id := strings.TrimSpace(asString(rec["id"]))
	if id == "" {
		id = stableFavoriteRefID(folderID, kind, targetID)
	}
	created := positiveTimestamp(rec["createdAtMs"], now)
	updated := positiveTimestamp(rec["updatedAtMs"], created)
	return favoriteItemRef{ID: id, FolderID: folderID, Kind: kind, TargetID: targetID, Layout: normalizeFavoriteLayout(rec["layout"]), CreatedAtMs: created, UpdatedAtMs: updated}, true
}

func normalizeFavoritesDoc(raw any) (favoritesDoc, bool) {
	now := nowMs()
	base := freshFavoritesDoc(now)
	docRec := favoriteObject(raw)
	if docRec == nil {
		return base, true
	}

	foldersRec := favoriteObject(docRec["folders"])
	refsByFolderIDRec := favoriteObject(docRec["refsByFolderId"])
	nextFolders := map[string]favoriteFolder{}
	for key, value := range foldersRec {
		id := strings.TrimSpace(key)
		if id == "" {
			continue
		}
		nextFolders[id] = normalizeFavoriteFolder(now, id, value)
	}
	if _, ok := nextFolders["root"]; !ok {
		nextFolders["root"] = base.Folders["root"]
	}

	nextRefsByFolderID := map[string][]favoriteItemRef{}
	for rawFolderID, rawRefs := range refsByFolderIDRec {
		folderID := strings.TrimSpace(rawFolderID)
		if folderID == "" {
			continue
		}
		if _, ok := nextFolders[folderID]; !ok {
			nextFolders[folderID] = normalizeFavoriteFolder(now, folderID, nil)
		}

		seen := map[string]bool{}
		refs := []favoriteItemRef{}
		for _, item := range favoriteList(rawRefs) {
			ref, ok := normalizeFavoriteRef(now, folderID, item)
			if !ok {
				continue
			}
			uniqKey := ref.Kind + ":" + ref.TargetID
			if seen[uniqKey] {
				continue
			}
			seen[uniqKey] = true
			refs = append(refs, ref)
		}
		nextRefsByFolderID[folderID] = refs
	}
	for folderID := range nextFolders {
		if _, ok := nextRefsByFolderID[folderID]; !ok {
			nextRefsByFolderID[folderID] = []favoriteItemRef{}
		}
	}

	normalized := favoritesDoc{Version: 1, RootFolderID: "root", Folders: nextFolders, RefsByFolderID: nextRefsByFolderID}
	var normalizedValue any
	normalizedPayload, normalizedErr := json.Marshal(normalized)
	if normalizedErr == nil {
		normalizedErr = json.Unmarshal(normalizedPayload, &normalizedValue)
	}
	rawBytes, rawErr := json.Marshal(raw)
	normalizedBytes, normalizedErr := json.Marshal(normalizedValue)
	changed := rawErr != nil || normalizedErr != nil || !bytes.Equal(rawBytes, normalizedBytes)
	return normalized, changed
}

func (svc *service) tryLoadFavorites() (favoritesDoc, bool, error) {
	target, err := svc.resolvePath("data", favoritesFile)
	if err != nil {
		return favoritesDoc{}, false, err
	}
	var raw any
	if err := readJSONFile(target, &raw); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return favoritesDoc{}, false, nil
		}
		return favoritesDoc{}, false, nil
	}
	if asFloat(favoriteObject(raw)["version"]) != 1 {
		return favoritesDoc{}, false, nil
	}
	doc, changed := normalizeFavoritesDoc(raw)
	return doc, changed, nil
}

func (svc *service) ensureFavorites() (any, error) {
	existing, changed, err := svc.tryLoadFavorites()
	if err != nil {
		return nil, err
	}
	if existing.Version == 1 {
		if changed {
			if err := svc.saveFavoritesDoc(existing); err != nil {
				return nil, err
			}
		}
		return existing, nil
	}
	now := nowMs()
	fresh := freshFavoritesDoc(now)
	target, err := svc.resolvePath("data", favoritesFile)
	if err != nil {
		return nil, err
	}
	if err := writeJSONFile(target, fresh); err != nil {
		return nil, err
	}
	return fresh, nil
}

func (svc *service) saveFavoritesDoc(doc favoritesDoc) error {
	target, err := svc.resolvePath("data", favoritesFile)
	if err != nil {
		return err
	}
	return writeJSONFile(target, doc)
}

func (svc *service) saveFavorites(raw json.RawMessage) error {
	var value any
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" {
		value = nil
	} else if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	doc, _ := normalizeFavoritesDoc(value)
	return svc.saveFavoritesDoc(doc)
}
