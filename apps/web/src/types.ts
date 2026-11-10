// 서버 API 응답 타입을 한곳에 모은다.
// 학습(study/*) 타입은 study.ts 에 있고 여기서 다시 내보낸다. 나머지는 새 API 계약(통계 · 친구 · 프로필 · 관리)이다.
// 아직 서버에 없는 API 는 404 를 돌려주며, 화면은 이를 "준비 중"으로 보여 준다(hooks.ts useApi 의 notReady).
import type { FieldsByTrack, NoteTrack, Track } from '@nakamura/core'

export type {
  AnswerResult,
  DeckSummary,
  QueueItem,
  StudySummary,
  TrackSummary,
  WriteLevel,
  WriteOptions,
  WriteSummary,
} from './study.ts'

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

/** 친구가 만든 항목의 카드 상태 */
export interface DeckStats extends Omit<TrackStats, 'track'> {
  /** 학습 키 'deck:<키>' */
  key: string
  name: string
}

/** GET stats/tracks */
export interface TrackStatsResponse {
  tracks: TrackStats[]
  /** 예전 서버는 없을 수 있다 */
  decks?: DeckStats[]
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
  note: { track: NoteTrack; fields: Record<string, unknown>; status: string } | null
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

// --- 친구 문제 만들기 ---

/** 노트 상태: 초안(검토 중) · 공개 · 퇴출(반려) */
export type NoteStatus = 'draft' | 'published' | 'retired'

export const UPLOAD_STATUS_LABEL: Record<NoteStatus, string> = {
  draft: '검토 중',
  published: '공개',
  retired: '반려',
}

/** POST notes 의 응답 · GET notes/mine 의 항목 */
export interface UploadedNote {
  id: string
  track: NoteTrack
  fields: Record<string, unknown>
  status: NoteStatus
  createdAt: number
  updatedAt: number
}

/** GET notes/mine */
export interface MyNotesResponse {
  notes: UploadedNote[]
}

/** GET admin/drafts */
export interface Draft {
  id: string
  track: NoteTrack
  fields: Record<string, unknown>
  createdAt: number
  /** 만든 사람의 보이는 이름 (사용자가 지워졌으면 null) */
  uploader: string | null
  uploaderId: number | null
  /** 파일로 올렸으면 묶음 id, 직접 만들었으면 null */
  batch: string | null
}

/** 검토 대기가 남은 파일 묶음 */
export interface DraftBatch {
  id: string
  track: NoteTrack
  /** 항목 파일이면 항목 이름 */
  deck: string | null
  /** 남은 검토 대기 수 */
  count: number
  createdAt: number
  uploader: string | null
  uploaderId: number | null
}

export interface DraftsResponse {
  drafts: Draft[]
  batches: DraftBatch[]
}

// --- 파일 올리기 ---

/** created 만듦 · invalid 검사 실패 · duplicate 파일 안 중복 또는 이미 있음 · limit 하루 제한을 넘어 건너뜀 */
export type FileItemStatus = 'created' | 'invalid' | 'duplicate' | 'limit'

export interface FileItemResult {
  /** 파일 안 순서 (1부터) */
  no: number
  status: FileItemStatus
  /** 대표 글자 (한자 · 단어 · 앞면) */
  label: string
  id?: string
  errors?: string[]
}

/** POST notes/file */
export interface FileUploadResult {
  batch: string | null
  track: NoteTrack
  deck?: { key: string; name: string; isNew: boolean }
  created: number
  results: FileItemResult[]
}
