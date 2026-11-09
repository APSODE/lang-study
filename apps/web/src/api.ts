// 서버 API 호출. 상대 경로(api/...)라 BASE_PATH 아래에 배포돼도 그대로 동작한다.
// 상태를 바꾸는 요청은 항상 Content-Type: application/json 으로 보낸다 (서버의 CSRF 방어).

export type SessionUser = { id: number; name: string; isAdmin: boolean }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  let res: Response
  try {
    res = await fetch(`api/${path}`, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다')
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `요청이 실패했습니다 (${res.status})`)
  return data as T
}
