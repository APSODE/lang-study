// 화면들이 같이 쓰는 훅.
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'

export interface ApiState<T> {
  /** 지금 경로의 응답. 아직 없으면 null (경로가 바뀌면 이전 경로의 응답은 내지 않는다) */
  data: T | null
  error: ApiError | null
  /** 요청 중 (다시 불러오는 중에도 이전 data 는 그대로 둔다) */
  loading: boolean
  /** 서버에 아직 없는 API (404). 화면은 "준비 중"으로 보여 준다 */
  notReady: boolean
  reload: () => void
  /** 응답을 화면에서 직접 고칠 때 (저장 뒤 서버가 돌려준 값으로 바꾸기 등) */
  setData: (data: T) => void
}

/**
 * GET api/<path>. path 가 null 이면 요청하지 않는다.
 * 같은 경로로 다시 불러올 때는 이전 응답을 보여 주다가 새 응답으로 바꾼다(깜빡임 없이).
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: ApiError | null }>({
    path: null,
    data: null,
    error: null,
  })
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (path === null) return
    let alive = true
    setLoading(true)
    api<T>(path)
      .then(data => alive && setState({ path, data, error: null }))
      .catch((err: unknown) => {
        if (!alive) return
        const e = err instanceof ApiError ? err : new ApiError(0, (err as Error).message)
        setState(s => ({ path, data: s.path === path ? s.data : null, error: e }))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [path, tick])

  const reload = useCallback(() => setTick(t => t + 1), [])
  const setData = useCallback((data: T) => setState(s => ({ ...s, data, error: null })), [])

  const same = state.path === path
  const error = same ? state.error : null
  return {
    data: same ? state.data : null,
    error,
    loading: path !== null && (loading || !same),
    notReady: error?.status === 404,
    reload,
    setData,
  }
}
