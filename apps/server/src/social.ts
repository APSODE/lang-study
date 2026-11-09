// 같이 쓰는 기능: 리더보드 · 친구 진도 · (관리자) 사용자 목록. 라우트는 routes/social.ts · routes/admin.ts.
// 리더보드 기준은 기간 복습 수 + 연속 학습일 (정답률은 쉬운 카드만 고르게 만들어서 쓰지 않는다, docs/논의_정리.md).
// 기간(주 · 달)은 보는 사람의 시간대로 자른다: 주는 월요일 04:00, 달은 1일 04:00 에 시작.
// 연속 학습일 · 마지막 학습일은 각 사용자 자신의 시간대로 센다 (study/summary 와 같은 값).
import type { DatabaseSync } from 'node:sqlite'
import { TRACKS, type Track } from '@nakamura/core'
import { dayKey, keyStart, monthStartKey, safeTz, weekStartKey } from './study/day.ts'
import { streak, userTz } from './study/service.ts'
import { cardBuckets } from './study/stats.ts'

export const PERIODS = ['week', 'month'] as const
export type Period = (typeof PERIODS)[number]

interface UserRow {
  id: number
  name: string
  tz: string
  isAdmin: number
  showProgress: number
  createdAt: number
}

const allUsers = (db: DatabaseSync): UserRow[] =>
  db
    .prepare(
      'SELECT id, name, tz, is_admin AS isAdmin, show_progress AS showProgress, created_at AS createdAt FROM users ORDER BY id',
    )
    .all() as unknown as UserRow[]

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)

/** 보는 사람(viewer) 시간대로 그 기간이 시작된 순간 */
export const periodStart = (db: DatabaseSync, viewerId: number, period: Period, now: number): number => {
  const tz = userTz(db, viewerId)
  const today = dayKey(now, tz)
  return keyStart(period === 'week' ? weekStartKey(today) : monthStartKey(today), tz)
}

/** [from, now] 의 사용자별 복습 수 */
const reviewsBetween = (db: DatabaseSync, from: number, now: number): Map<number, number> =>
  new Map(
    (
      db
        .prepare('SELECT user_id AS id, count(*) AS n FROM review_logs WHERE reviewed_at >= ? AND reviewed_at <= ? GROUP BY user_id')
        .all(from, now) as { id: number; n: number }[]
    ).map(r => [r.id, r.n]),
  )

/** 마지막으로 복습한 학습일 (그 사용자 시간대). 없으면 null */
const lastStudiedDay = (db: DatabaseSync, user: UserRow, now: number): string | null => {
  const row = db.prepare('SELECT max(reviewed_at) AS t FROM review_logs WHERE user_id = ? AND reviewed_at <= ?').get(user.id, now) as {
    t: number | null
  }
  return row.t === null ? null : dayKey(row.t, safeTz(user.tz))
}

const streakOfUser = (db: DatabaseSync, user: UserRow, now: number): number => streak(db, user.id, now, safeTz(user.tz))

// --- 리더보드 ---

export interface LeaderboardEntry {
  rank: number
  userId: number
  name: string
  reviews: number
  streak: number
  isMe: boolean
}

/**
 * 공개한 사용자 + 보는 사람 자신(공개를 꺼도 자기 자리는 보인다).
 * 복습 수 → 연속 학습일 → 이름 순. 복습 수와 연속 학습일이 모두 같으면 같은 순위 (1, 1, 3).
 */
export const leaderboard = (db: DatabaseSync, viewerId: number, period: Period, now: number) => {
  const start = periodStart(db, viewerId, period, now)
  const reviews = reviewsBetween(db, start, now)
  const rows = allUsers(db)
    .filter(u => u.showProgress === 1 || u.id === viewerId)
    .map(u => ({ userId: u.id, name: u.name, reviews: reviews.get(u.id) ?? 0, streak: streakOfUser(db, u, now), isMe: u.id === viewerId }))
    .sort((a, b) => b.reviews - a.reviews || b.streak - a.streak || byName(a, b))
  const entries: LeaderboardEntry[] = []
  rows.forEach((r, i) => {
    const prev = entries[i - 1]
    const rank = prev && prev.reviews === r.reviews && prev.streak === r.streak ? prev.rank : i + 1
    entries.push({ rank, ...r })
  })
  return { period, start, entries }
}

// --- 친구 진도 ---

export interface FriendTrack {
  track: Track
  /** 본 카드 (배우는 중 + 복습 중, 일시 중지 제외) */
  learned: number
  mature: number
}

export interface Friend {
  userId: number
  name: string
  streak: number
  reviewsWeek: number
  lastStudiedDay: string | null
  tracks: FriendTrack[]
}

/** 진도를 공개한 다른 사용자. 최근에 공부한 사람부터 (안 한 사람은 끝), 그다음 이름 순. */
export const friends = (db: DatabaseSync, viewerId: number, now: number): Friend[] => {
  const week = reviewsBetween(db, periodStart(db, viewerId, 'week', now), now)
  const out = allUsers(db)
    .filter(u => u.showProgress === 1 && u.id !== viewerId)
    .map(u => ({
      userId: u.id,
      name: u.name,
      streak: streakOfUser(db, u, now),
      reviewsWeek: week.get(u.id) ?? 0,
      lastStudiedDay: lastStudiedDay(db, u, now),
      tracks: TRACKS.map(track => {
        const b = cardBuckets(db, u.id, track)
        return { track, learned: b.learning + b.young + b.mature, mature: b.mature }
      }),
    }))
  const last = (f: Friend) => f.lastStudiedDay ?? ''
  return out.sort((a, b) => (last(a) === last(b) ? byName(a, b) : last(a) > last(b) ? -1 : 1))
}

// --- 관리자: 사용자 목록 ---

export interface UserOverview {
  id: number
  name: string
  isAdmin: boolean
  createdAt: number
  lastStudiedDay: string | null
  reviewsWeek: number
  showProgress: boolean
}

/** 모든 사용자 (가입 순). 주간 복습 수는 보는 관리자의 주 기준. */
export const userOverview = (db: DatabaseSync, viewerId: number, now: number): UserOverview[] => {
  const week = reviewsBetween(db, periodStart(db, viewerId, 'week', now), now)
  return allUsers(db).map(u => ({
    id: u.id,
    name: u.name,
    isAdmin: u.isAdmin === 1,
    createdAt: u.createdAt,
    lastStudiedDay: lastStudiedDay(db, u, now),
    reviewsWeek: week.get(u.id) ?? 0,
    showProgress: u.showProgress === 1,
  }))
}
