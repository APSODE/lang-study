// 학습 통계: 날마다 복습 수(활동 달력) · 트랙별 · 항목별 카드 상태. 라우트는 routes/stats.ts.
// 날짜는 모두 사용자 시간대의 학습일(04:00 경계, study/day.ts).
import type { DatabaseSync } from 'node:sqlite'
import { deckStudyKey, TRACKS, type StudyKey, type Track } from '@nakamura/core'
import { publishedCatalog, publishedDecks } from './catalog.ts'
import { dayKey, keyStart, shiftDayKey } from './day.ts'
import { userTz } from './service.ts'

/** 복습 간격이 이 일수 이상이면 '익힌' 카드 (Anki 의 mature 와 같다) */
export const MATURE_DAYS = 21
export const ACTIVITY_DAYS_DEFAULT = 84
export const ACTIVITY_DAYS_MAX = 366
/** 트랙 정답률을 보는 기간 (오늘 포함 학습일 수) */
const ACCURACY_DAYS = 7

/** ts-fsrs State */
const STATE_REVIEW = 2

export interface DayActivity {
  day: string
  reviews: number
  correct: number
}

/** 오늘로 끝나는 days 일 (오래된 것부터, 복습이 없는 날은 0) */
export const activity = (db: DatabaseSync, userId: number, days: number, now: number): DayActivity[] => {
  const tz = userTz(db, userId)
  const today = dayKey(now, tz)
  const out: DayActivity[] = []
  const byDay = new Map<string, DayActivity>()
  for (let k = days - 1; k >= 0; k--) {
    const d = { day: shiftDayKey(today, -k), reviews: 0, correct: 0 }
    out.push(d)
    byDay.set(d.day, d)
  }
  const rows = db
    .prepare('SELECT reviewed_at AS t, correct FROM review_logs WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at <= ?')
    .iterate(userId, keyStart(out[0]!.day, tz), now) as Iterable<{ t: number; correct: number }>
  for (const r of rows) {
    const d = byDay.get(dayKey(r.t, tz))
    if (!d) continue
    d.reviews++
    if (r.correct) d.correct++
  }
  return out
}

export interface CardBuckets {
  /** 공개 노트 × 적용되는 연습 방식 (일시 중지한 카드 제외) */
  cards: number
  /** 아직 한 번도 보지 않은 카드 */
  unseen: number
  /** FSRS Learning · Relearning */
  learning: number
  /** Review, 간격 21일 미만 */
  young: number
  /** Review, 간격 21일 이상 */
  mature: number
}

/** 한 사용자 · 한 학습 키(트랙 · 항목)의 카드 상태. 공개되지 않았거나 연습 방식이 더 이상 적용되지 않는 카드 · 일시 중지 카드는 세지 않는다. */
export const cardBuckets = (db: DatabaseSync, userId: number, track: StudyKey): CardBuckets => {
  const catalog = publishedCatalog(db, track)
  const total = catalog.notes.reduce((n, c) => n + c.drills.length, 0)
  const rows = db
    .prepare(
      `SELECT note_id AS noteId, drill_id AS drillId, suspended,
              json_extract(fsrs, '$.state') AS state, json_extract(fsrs, '$.scheduled_days') AS ivl
         FROM user_cards WHERE user_id = ? AND track = ?`,
    )
    .all(userId, track) as { noteId: string; drillId: string; suspended: number; state: number; ivl: number | null }[]
  let seen = 0
  let suspended = 0
  const b = { learning: 0, young: 0, mature: 0 }
  for (const r of rows) {
    const entry = catalog.byId.get(r.noteId)
    if (!entry || !entry.drills.some(d => d.id === r.drillId)) continue
    seen++
    if (r.suspended) {
      suspended++
      continue
    }
    if (r.state === STATE_REVIEW) {
      if ((r.ivl ?? 0) >= MATURE_DAYS) b.mature++
      else b.young++
    } else {
      // Learning · Relearning. 답한 카드가 New 로 남는 일은 없지만, 있으면 배우는 중으로 친다.
      b.learning++
    }
  }
  return { cards: total - suspended, unseen: total - seen, ...b }
}

export interface TrackStats extends CardBuckets {
  track: Track
  notes: number
  /** 최근 7 학습일 이 트랙 복습의 정답 비율. 복습이 없으면 null */
  accuracy7d: number | null
}

/** 최근 7 학습일 학습 키(user_cards.track)별 정답 비율 */
const accuracyByKey = (db: DatabaseSync, userId: number, now: number): Map<string, number> => {
  const tz = userTz(db, userId)
  const from = keyStart(shiftDayKey(dayKey(now, tz), -(ACCURACY_DAYS - 1)), tz)
  return new Map(
    (
      db
        .prepare(
          `SELECT uc.track AS track, count(*) AS n, total(r.correct) AS c
             FROM review_logs r
             JOIN user_cards uc ON uc.user_id = r.user_id AND uc.card_id = r.card_id
             JOIN notes n ON n.id = uc.note_id
            WHERE r.user_id = ? AND r.reviewed_at >= ? AND r.reviewed_at <= ?
              AND uc.suspended = 0 AND n.status = 'published'
            GROUP BY uc.track`,
        )
        .all(userId, from, now) as { track: string; n: number; c: number }[]
    ).map(r => [r.track, r.c / r.n]),
  )
}

export const trackStats = (db: DatabaseSync, userId: number, now: number): TrackStats[] => {
  const acc = accuracyByKey(db, userId, now)
  return TRACKS.map(track => ({
    track,
    notes: publishedCatalog(db, track).notes.length,
    ...cardBuckets(db, userId, track),
    accuracy7d: acc.get(track) ?? null,
  }))
}

export interface DeckStats extends CardBuckets {
  /** 학습 키 'deck:<키>' */
  key: string
  name: string
  notes: number
  accuracy7d: number | null
}

/** 공개된 카드가 있는 항목마다 카드 상태 (만든 순서) */
export const deckStats = (db: DatabaseSync, userId: number, now: number): DeckStats[] => {
  const decks = publishedDecks(db)
  if (decks.length === 0) return []
  const acc = accuracyByKey(db, userId, now)
  return decks.map(d => {
    const key = deckStudyKey(d.key)
    return { key, name: d.name, notes: d.notes, ...cardBuckets(db, userId, key), accuracy7d: acc.get(key) ?? null }
  })
}
