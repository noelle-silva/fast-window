// 业务端请求的路径拼装与查询合并：与具体数据概念无关的公共部分。
//
// 端点表由各数据概念自己维护；这里只保证两件事：
// 1. 路径参数先编码再拼进模板，缺参数直接失败，不把空段发到服务端换一个含糊的状态码；
// 2. 查询参数一律在路径拼完之后合并，空值不落进 URL。
//    顺序错了会出真问题：把 ?ownerId=… 拼在子路径前面，子路径会被并进查询，
//    服务端只看得到作用域根路径，非 GET 方法直接 405。

export type EbNetRequest = (req: any) => Promise<any>

export type PathQuery = Record<string, string>

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = text(params[name])
    if (!value) throw new Error(`缺少路径参数：${name}`)
    return encodeURIComponent(value)
  })
}

export function withQuery(path: string, query: PathQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const next = text(value)
    if (next) params.set(key, next)
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}
