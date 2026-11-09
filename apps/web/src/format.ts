// 날짜 · 숫자 표시. 서버의 날짜 키('YYYY-MM-DD')는 사용자 시간대 기준이라, 계산은 UTC 달력으로만 한다(브라우저 시간대에 흔들리지 않게).

const parseDay = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** b − a (일) */
export const daysBetween = (a: string, b: string): number => Math.round((parseDay(b) - parseDay(a)) / 86_400_000)

/** 0 = 월 … 6 = 일 */
export const weekdayMon0 = (day: string): number => (new Date(parseDay(day)).getUTCDay() + 6) % 7

export const addDays = (day: string, n: number): string => new Date(parseDay(day) + n * 86_400_000).toISOString().slice(0, 10)

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const
export const weekdayLabel = (day: string): string => WEEKDAYS[weekdayMon0(day)]!

/** '2026-11-09' → '11월 9일 (월)' */
export const dayLabel = (day: string, withWeekday = true): string => {
  const [, m, d] = day.split('-').map(Number)
  return `${m}월 ${d}일${withWeekday ? ` (${weekdayLabel(day)})` : ''}`
}

/** 마지막으로 공부한 날 → '오늘' · '어제' · 'N일 전' · '기록 없음' */
export const relativeDay = (day: string | null, today: string | null): string => {
  if (!day) return '기록 없음'
  if (!today) return dayLabel(day, false)
  const n = daysBetween(day, today)
  if (n <= 0) return '오늘'
  if (n === 1) return '어제'
  return `${n}일 전`
}

/** 브라우저 시간대의 오늘 (서버 날짜를 아직 모를 때만 쓴다) */
export const localToday = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

export const fmtDateTime = (ms: number): string =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export const fmtNum = (n: number): string => n.toLocaleString('ko-KR')

export const fmtPct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`)
