// 서버 API 응답 타입을 한곳에 모은다.
// 학습(study/*) 타입은 study.ts 에 있고 여기서 다시 내보낸다. 나머지는 새 API 계약(통계 · 친구 · 프로필 · 관리)이다.
// 아직 서버에 없는 API 는 404 를 돌려주며, 화면은 이를 "준비 중"으로 보여 준다(hooks.ts useApi 의 notReady).
import type { FieldsByTrack, Track } from '@nakamura/core'

export type { AnswerResult, QueueItem, StudySummary, TrackSummary } from './study.ts'

// --- 통계 ---

export interface ActivityDay {
  /** 사용자 시간대 기준 날짜 'YYYY-MM-DD' */
  day: string
  reviews: number
  correct: number
}

/** GET stats/activity?days=N — 오래된 날 → 오늘, 정확히 N개 */
export interface ActivityResponse {
  days: ActivityDay[]
}

export interface TrackStats {
  track: Track
  notes: number
  cards: number
  unseen: number
  learning: number
  young: number
  mature: number
  /** 최근 7일 정답률 0–1. 기록이 없으면 null */
  accuracy7d: number | null
}

/** GET stats/tracks */
export interface TrackStatsResponse {
  tracks: TrackStats[]
}

// --- 친구 ---

export type LeaderboardPeriod = 'week' | 'month'

export interface LeaderboardEntry {
  rank: number
  userId: number
  /** 보이는 이름 (닉네임 ?? 로그인 이름) */
  name: string
  reviews: number
  streak: number
  isMe: boolean
}

/** GET social/leaderboard?period=week|month */
export interface LeaderboardResponse {
  period: LeaderboardPeriod
  /** 기간 시작 (ms) */
  start: number
  entries: LeaderboardEntry[]
}

export interface FriendTrack {
  track: Track
  learned: number
  mature: number
}

export interface Friend {
  userId: number
  /** 보이는 이름 (닉네임 ?? 로그인 이름) */
  name: string
  streak: number
  reviewsWeek: number
  lastStudiedDay: string | null
  tracks: FriendTrack[]
}

/** GET social/friends */
export interface FriendsResponse {
  friends: Friend[]
}

// --- 내 정보 ---

/** GET / PUT me/profile */
export interface Profile {
  /** 로그인 이름 (바뀌지 않는다) */
  name: string
  /** 닉네임. 없으면 null */
  displayName: string | null
  /** 보이는 이름 (displayName ?? name) */
  display: string
  isAdmin: boolean
  showProgress: boolean
  tz: string
  /** 가입 시각 (ms) */
  createdAt: number
}

// --- 노트 ---

/** GET notes?track=… */
export interface NotesResponse<T extends Track = Track> {
  notes: { id: string; fields: FieldsByTrack[T] }[]
}

// --- 관리 ---

export type ReportStatus = 'open' | 'resolved' | 'rejected'
export type ReportFilter = ReportStatus | 'all'
export type ReportReason = 'wrong_answer' | 'typo' | 'audio' | 'other'

export const REPORT_REASON_LABEL: Record<string, string> = {
  wrong_answer: '정답 오류',
  typo: '오타',
  audio: '음성',
  other: '기타',
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  open: '열림',
  resolved: '해결',
  rejected: '반려',
}

export interface Report {
  id: number
  noteId: string
  cardId: string | null
  userName: string
  reason: ReportReason | string
  body: string | null
  status: ReportStatus
  createdAt: number
  resolvedAt: number | null
  /** 처리한 관리자 이름 */
  resolvedBy: string | null
  note: { track: Track; fields: Record<string, unknown>; status: string } | null
}

/** GET admin/reports?status=… */
export interface ReportsResponse {
  reports: Report[]
}

export interface AdminUser {
  id: number
  /** 로그인 이름 */
  name: string
  /** 보이는 이름 (닉네임 ?? 로그인 이름) */
  display: string
  isAdmin: boolean
  createdAt: number
  lastStudiedDay: string | null
  reviewsWeek: number
  showProgress: boolean
}

/** GET admin/users */
export interface AdminUsersResponse {
  users: AdminUser[]
}
