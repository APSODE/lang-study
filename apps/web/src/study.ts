// 학습 API 타입 (apps/server/src/routes/study.ts 와 맞춘다)
import type { Note, NoteTrack, Track } from '@nakamura/core'

/** 트랙 이름. deck 은 친구가 만든 항목(앞면 · 뒷면 카드) */
export const TRACK_LABEL: Record<NoteTrack, string> = { kana: '가나', kanji: '한자', toeic: '토익', toefl: '토플', deck: '항목' }

export interface QueueItem {
  cardId: string
  noteId: string
  drillId: string
  /** 노트의 트랙 (항목 카드는 'deck') */
  track: NoteTrack
  fields: Note['fields']
  isNew: boolean
  /** 고르기 연습 방식의 보기 */
  choices?: string[]
  /** 예시 낱말 연습 방식(kanji-word-*): 낼 예시 낱말의 순번 (fields.examples[example]) */
  example?: number
  /** 친구가 만든 문제면 만든 사람 (보이는 이름) */
  author?: string
}

export interface AnswerResult {
  correct: boolean
  expected: string
  /** 1 다시 · 2 어려움 · 3 좋음 · 4 쉬움 */
  rating: number
  due: number
}

/** 트랙 · 항목 실력: 익힌 노트(복습 간격 21일 이상 카드가 있는 노트) 수 */
export interface Mastery {
  mastered: number
  total: number
  /** 한자만: 쉬운 단계부터 80% 이상 익힌 가장 높은 JLPT 단계 (5 = N5). 없으면 null */
  jlpt: number | null
}

/** 레벨 (활동 XP). 칭호는 서버(core level.ts)가 준다 */
export interface LevelSummary {
  level: number
  title: string
  xp: number
  /** 지금 레벨이 시작된 누적 XP */
  levelXp: number
  /** 다음 레벨이 되는 누적 XP */
  nextLevelXp: number
  /** 오늘 얻은 XP */
  xpToday: number
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
  /** 예전 서버는 없을 수 있다 */
  mastery?: Mastery
}

/** 작문 모드 요약 (한자 일작). 트랙 요약의 숫자에는 작문 카드가 들어가지 않는다 */
export interface WriteSummary {
  track: Track
  due: number
  /** 오늘 남은 새 문제 (레벨 조건 없이) */
  newLeft: number
  newPerDay: number
  /** 한 번이라도 푼 작문 문제 수 */
  learned: number
}

/** 친구가 만든 항목 하나의 요약 (공개된 카드가 있는 항목만) */
export interface DeckSummary {
  /** 학습 키 'deck:<키>'. 학습 화면은 #/study/<key> */
  key: string
  name: string
  /** 카드를 만든 사람들 (먼저 만든 순) */
  authors: string[]
  notes: number
  due: number
  newLeft: number
  newPerDay: number
  learned: number
  reviewsToday: number
  /** 예전 서버는 없을 수 있다 */
  mastery?: Mastery
}

export interface StudySummary {
  day: string
  streak: number
  reviewsToday: number
  /** 예전 서버는 없을 수 있다 */
  level?: LevelSummary
  tracks: TrackSummary[]
  writing: WriteSummary
  /** 친구가 만든 항목 (만든 순서). 예전 서버는 없을 수 있다 */
  decks?: DeckSummary[]
}

/** 만든 사람 표시: "하나", "하나 외 2명" */
export const authorsLabel = (authors: string[]): string =>
  authors.length === 0 ? '' : authors.length === 1 ? authors[0]! : `${authors[0]} 외 ${authors.length - 1}명`

/** 글자로 언어 짐작 (항목 카드의 lang 속성 · 듣기). 가나가 있으면 일본어, 로마자뿐이면 영어 */
export const guessLang = (s: string): 'ja' | 'en' | undefined =>
  /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s) ? 'ja' : /^[\x20-\x7e]*[A-Za-z][\x20-\x7e]*$/.test(s) ? 'en' : undefined

export interface WriteLevel {
  /** JLPT 레벨 (5 = N5) */
  jlpt: number
  /** 작문 문제가 있는(예문이 있는) 한자 수 */
  total: number
  /** 그중 공부한(보통 카드가 있는) 한자 */
  learned: number
  /** 그중 작문 문제를 이미 본 한자 */
  introduced: number
  /** 공부했고 작문 문제는 아직 안 본 한자 */
  learnedFresh: number
}

/** GET study/write/options?track= */
export interface WriteOptions {
  levels: WriteLevel[]
  newPerDay: number
  /** 오늘 남은 새 문제 (레벨 조건 없이) */
  newLeft: number
  due: number
}

/** 작문 학습 조건 (#/study/<트랙>?mode=write&levels=5,4&learned=1) */
export interface WriteParams {
  /** null = 모든 레벨 */
  levels: number[] | null
  learnedOnly: boolean
}

export const writeStudyPath = (track: Track, p: WriteParams): string =>
  `/study/${track}?mode=write${p.levels ? `&levels=${p.levels.join(',')}` : ''}${p.learnedOnly ? '&learned=1' : ''}`

/** 해시 매개변수 → 작문 조건. 레벨이 하나도 맞지 않으면 null (모든 레벨) */
export const parseWriteParams = (q: URLSearchParams): WriteParams => {
  const raw = q.get('levels')
  const levels = raw ? [...new Set(raw.split(',').map(Number))].filter(n => Number.isInteger(n) && n >= 1 && n <= 5) : []
  return { levels: levels.length ? levels : null, learnedOnly: q.get('learned') === '1' }
}

export const REPORT_REASONS = [
  ['wrong_answer', '정답이 틀렸어요'],
  ['typo', '오타가 있어요'],
  ['audio', '소리가 이상해요'],
  ['other', '기타'],
] as const
