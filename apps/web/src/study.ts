// 학습 API 타입 (apps/server/src/routes/study.ts 와 맞춘다)
import type { Note, Track } from '@nakamura/core'

export const TRACK_LABEL: Record<Track, string> = { kana: '가나', kanji: '한자', toeic: '토익' }

export interface QueueItem {
  cardId: string
  noteId: string
  drillId: string
  track: Track
  fields: Note['fields']
  isNew: boolean
  /** 고르기 연습 방식의 보기 */
  choices?: string[]
}

export interface AnswerResult {
  correct: boolean
  expected: string
  /** 1 다시 · 2 어려움 · 3 좋음 · 4 쉬움 */
  rating: number
  due: number
}

export interface TrackSummary {
  track: Track
  /** 공개된 노트 수. 0 이면 준비 중 */
  notes: number
  due: number
  newLeft: number
  newPerDay: number
  learned: number
  reviewsToday: number
}

export interface StudySummary {
  day: string
  streak: number
  reviewsToday: number
  tracks: TrackSummary[]
}

export const REPORT_REASONS = [
  ['wrong_answer', '정답이 틀렸어요'],
  ['typo', '오타가 있어요'],
  ['audio', '소리가 이상해요'],
  ['other', '기타'],
] as const
