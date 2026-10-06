package main

// 变更类别：外部改动通知里表达「哪类数据变了」，前端据此就地重载对应数据块。
const (
	changeKindNotes     = "notes"
	changeKindFavorites = "favorites"
	changeKindAssets    = "assets"
	changeKindTrash     = "trash"
)

// changeKindsForMethod 把外部写入方法映射为受影响的变更类别。
// 只读方法与不产生仓库数据变化的方法返回空；一个方法可能同时影响多类（如回收站操作）。
func changeKindsForMethod(method string) []string {
	switch method {
	case "hypercortex.favorites.createFolder",
		"hypercortex.favorites.updateFolder",
		"hypercortex.favorites.addItem",
		"hypercortex.favorites.removeItem",
		"hypercortex.favorites.moveItem",
		"hypercortex.favorites.save":
		return []string{changeKindFavorites}

	case "hypercortex.notes.create",
		"hypercortex.notes.saveFaces",
		"hypercortex.notes.updateMetadata",
		"hypercortex.notes.patchFace",
		"hypercortex.notes.saveFaceOrder",
		"hypercortex.notes.deleteFace",
		"hypercortex.notes.saveFaceSettings",
		"hypercortex.notes.versions.publish",
		"hypercortex.notes.versions.restore":
		return []string{changeKindNotes}

	case "hypercortex.assets.delete",
		"hypercortex.assets.updateMetadata":
		return []string{changeKindAssets}

	case "hypercortex.trash.moveNote",
		"hypercortex.trash.permanentlyDeleteNoteDir":
		return []string{changeKindNotes, changeKindTrash}

	case "hypercortex.trash.moveAsset":
		return []string{changeKindAssets, changeKindTrash}

	case "hypercortex.trash.moveFolder":
		return []string{changeKindFavorites, changeKindTrash}

	case "hypercortex.trash.permanentlyDeleteItem":
		return []string{changeKindTrash}

	case "hypercortex.trash.restore":
		return []string{changeKindNotes, changeKindFavorites, changeKindAssets, changeKindTrash}
	}
	return nil
}
