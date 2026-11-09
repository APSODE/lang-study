// 로그인 실패 제한 (메모리). (IP, 소문자 이름) 마다 15분에 10번 실패하면 잠시 막는다.
// 프로세스 하나로 도는 작은 서버라 메모리로 충분하다. 재시작하면 초기화된다.

export interface Throttle {
  /** 막혀 있으면 다시 시도할 수 있을 때까지 남은 초, 아니면 0 */
  blockedFor(key: string, now?: number): number
  fail(key: string, now?: number): void
  reset(key: string): void
}

export const createThrottle = (maxFailures = 10, windowMs = 15 * 60 * 1000): Throttle => {
  const hits = new Map<string, { count: number; since: number }>()

  const prune = (now: number) => {
    for (const [k, v] of hits) if (now - v.since >= windowMs) hits.delete(k)
  }

  return {
    blockedFor(key, now = Date.now()) {
      const h = hits.get(key)
      if (!h) return 0
      if (now - h.since >= windowMs) {
        hits.delete(key)
        return 0
      }
      return h.count >= maxFailures ? Math.ceil((h.since + windowMs - now) / 1000) : 0
    },
    fail(key, now = Date.now()) {
      if (hits.size > 10_000) prune(now)
      const h = hits.get(key)
      if (!h || now - h.since >= windowMs) hits.set(key, { count: 1, since: now })
      else h.count++
    },
    reset(key) {
      hits.delete(key)
    },
  }
}
