export const apiBase = '__TAURI_INTERNALS__' in window ? 'http://127.0.0.1:8178/api/v1' : '/api/v1'

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const detail = typeof body.detail === 'string' ? body.detail
      : Array.isArray(body.detail) ? body.detail.map((item: {msg: string}) => item.msg).join(' ')
      : 'The workspace could not complete this request. Check the local API and retry.'
    throw new Error(detail)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : 'The request failed. Please retry.'
}

// Follow the bounded API pages so older reports remain accessible in the inbox.
export async function requestAll<T>(path: string): Promise<T[]> {
  const items: T[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await request<T[]>(`${path}?offset=${offset}`)
    items.push(...page)
    if (page.length < 100) return items
  }
}
