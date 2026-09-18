export type ToolCatalogItem = {
  id?: unknown
  name?: unknown
  description?: unknown
  type?: unknown
}

export function toolCatalogItems(tools: any): ToolCatalogItem[] {
  return Array.isArray(tools?.items) ? tools.items.filter((tool: any) => tool && typeof tool === 'object') : []
}

export function toolDisplayName(tool: ToolCatalogItem): string {
  return String(tool?.name || tool?.id || '').trim()
}

export function toolCatalogByName(items: ToolCatalogItem[]): Map<string, ToolCatalogItem> {
  const result = new Map<string, ToolCatalogItem>()
  for (const tool of items) {
    const name = toolDisplayName(tool)
    if (name) result.set(name, tool)
  }
  return result
}
