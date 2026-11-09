// 학습일 경계. 사용자의 시간대(users.tz)에서 새벽 4시에 하루가 바뀐다 (Anki 와 같다).
// 새벽 1시에 공부해도 전날 학습으로 친다. 하루 신규 카드 제한 · 오늘 복습 수 · 연속 학습일이 모두 이 기준을 쓴다.
// 의존성 없이 Intl 만 쓴다. 서머타임이 있는 시간대도 그날 04:00 벽시계 시각으로 계산한다.

export const DAY_START_HOUR = 4
export const DEFAULT_TZ = 'Asia/Seoul'
const DAY_MS = 24 * 3600 * 1000

const formatters = new Map<string, Intl.DateTimeFormat>()
const formatter = (tz: string): Intl.DateTimeFormat => {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** 쓸 수 없는 시간대 이름이면 기본값(Asia/Seoul) */
export const safeTz = (tz: string | null | undefined): string => {
  if (!tz) return DEFAULT_TZ
  try {
    formatter(tz)
    return tz
  } catch {
    return DEFAULT_TZ
  }
}

/** 그 순간의 tz 벽시계를 UTC 인 것처럼 읽은 ms (초 단위) */
const wallAsUtc = (ms: number, tz: string): number => {
  const p: Record<string, number> = {}
  for (const part of formatter(tz).formatToParts(ms)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!)
}

const keyOf = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10)
const parseKey = (key: string): number => Date.parse(`${key}T00:00:00Z`)

/** 학습일 이름 'YYYY-MM-DD'. 04:00 전이면 전날. */
export const dayKey = (ms: number, tz: string): string => keyOf(wallAsUtc(ms, tz) - DAY_START_HOUR * 3600 * 1000)

/** 하루 전 학습일 이름 */
export const prevDayKey = (key: string): string => keyOf(parseKey(key) - DAY_MS)

/** ms 가 속한 학습일이 시작된 순간 (그날 tz 04:00) */
export const dayStart = (ms: number, tz: string): number => {
  const target = parseKey(dayKey(ms, tz)) + DAY_START_HOUR * 3600 * 1000
  // 벽시계 → 순간: 오프셋을 두 번 맞추면 서머타임 경계에서도 맞는다
  const offset = (t: number) => wallAsUtc(t, tz) - Math.floor(t / 1000) * 1000
  const guess = target - offset(target)
  return target - offset(guess)
}

/**
 * 연속 학습일. keys 는 복습한 학습일 이름을 최근 것부터(중복 허용).
 * 오늘 복습했으면 오늘부터, 아니면 어제부터 거꾸로 센다. 어제도 없으면 0.
 */
export const streakOf = (keys: Iterable<string>, today: string): number => {
  let streak = 0
  let last = ''
  let expected = today
  for (const k of keys) {
    if (k === last) continue
    if (k > today) continue // 미래 기록은 무시 (시계가 어긋난 경우)
    if (k === expected) {
      streak++
      last = k
      expected = prevDayKey(k)
    } else if (streak === 0 && k === prevDayKey(today)) {
      streak = 1
      last = k
      expected = prevDayKey(k)
    } else break
  }
  return streak
}
