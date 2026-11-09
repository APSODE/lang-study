// 해시 라우팅 (#/login, #/join/<code>, #/admin/invites, #/study/<트랙>, #/kana, #/settings, #/).
// 정적 파일을 base './' 로 내므로 경로 라우팅 대신 해시를 쓴다. 새 의존성 없이 hashchange 만 듣는다.
import { useEffect, useSyncExternalStore } from 'react'

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** 현재 경로. '#/join/abc' → '/join/abc', 해시가 없으면 '/' */
const current = () => window.location.hash.replace(/^#/, '') || '/'

export const useRoute = (): string => useSyncExternalStore(subscribe, current)

export const navigate = (path: string, replace = false) => {
  if (replace) window.location.replace(`#${path}`)
  else window.location.hash = path
}

/** 렌더하는 순간 다른 경로로 보낸다 (뒤로 가기 기록을 남기지 않는다) */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to])
  return null
}
