// 레벨 · 칭호 (docs/레벨_작업.md). 메인 레벨 = 활동 XP. XP 계산 자체는 서버가 복습 기록에서 한다 (apps/server/src/study/level.ts).
import type { Track } from './notes.ts'

/** XP 규칙 */
export const XP = {
  /** 처음 답한 카드 (정답 · 오답 상관없이, 이 답에는 복습 점수가 붙지 않는다) */
  newCard: 3,
  reviewCorrect: 2,
  reviewWrong: 1,
  /** 연속 학습일이 이 일수에 닿은 날 */
  streak: [
    { days: 7, xp: 20 },
    { days: 30, xp: 50 },
    { days: 100, xp: 150 },
  ],
  /** 내가 만든 문제가 공개되면 개당 */
  publishedNote: 5,
} as const

/** 레벨 n 이 되는 데 필요한 누적 XP. Lv1 = 0 */
export const xpForLevel = (n: number): number => (n <= 1 ? 0 : Math.round(50 * (n - 1) ** 1.5))

/** 누적 XP 의 레벨 (1 이상, 상한 없음) */
export const levelForXp = (xp: number): number => {
  let n = 1
  while (xpForLevel(n + 1) <= xp) n++
  return n
}

/** 칭호 언어. 레벨은 하나, 칭호만 일본어 · 영어 두 벌 */
export const TITLE_LANGS = ['ja', 'en'] as const
export type TitleLang = (typeof TITLE_LANGS)[number]
/** 사용자 설정: auto = 복습 XP 가 더 많은 쪽 */
export const TITLE_PREFS = ['auto', 'ja', 'en'] as const
export type TitlePref = (typeof TITLE_PREFS)[number]
export const isTitlePref = (v: unknown): v is TitlePref => typeof v === 'string' && (TITLE_PREFS as readonly string[]).includes(v)

/** 트랙 → 칭호 언어 (항목 · 보너스는 언어 판정에서 뺀다) */
export const TRACK_TITLE_LANG: Readonly<Record<Track, TitleLang>> = { kana: 'ja', kanji: 'ja', toeic: 'en', toefl: 'en' }

/** 일본어 칭호 표: 이 레벨부터 (큰 것부터 찾는다) */
export const TITLES_JA: readonly { from: number; title: string }[] = [
  { from: 1, title: '「あ」부터 시작한 새싹 🌱' },
  { from: 3, title: '가타카나 보면 멈칫하는 사람' },
  { from: 5, title: '편의점 いらっしゃいませ 알아들음' },
  { from: 7, title: '라멘 주문 성공자 🍜' },
  { from: 10, title: '한자 보면 덜 무서운 사람' },
  { from: 13, title: '후리가나 졸업반 🎓' },
  { from: 16, title: '단어장 수집가' },
  { from: 20, title: 'JLPT 접수 버튼 앞에서 고민 중' },
  { from: 25, title: '애니 자막 반쯤 끈 사람 📺' },
  { from: 30, title: '일드 무자막 도전자' },
  { from: 35, title: '한자 2000자 탐험가 🧭' },
  { from: 40, title: '오사카 사투리도 알아듣는 사람 🐙' },
  { from: 50, title: '나카무라 그 자체 👑' },
]

/** 영어 칭호 표 */
export const TITLES_EN: readonly { from: number; title: string }[] = [
  { from: 1, title: 'ABC 떼고 온 새싹 🌱' },
  { from: 3, title: '"Fine, thank you. And you?" 자동 반사' },
  { from: 5, title: '카페 영어 주문 성공자 ☕' },
  { from: 7, title: '미드 자막을 영어로 바꿔 본 사람' },
  { from: 10, title: '단어장 형광펜 장인 🖍️' },
  { from: 13, title: '토익 LC 에서 졸지 않는 사람' },
  { from: 16, title: '메일 끝에 "Best regards" 쓰는 사람' },
  { from: 20, title: '토익 접수 버튼 앞에서 고민 중' },
  { from: 25, title: '해외 직구 문의 메일 혼자 보내는 사람 📦' },
  { from: 30, title: '영어 원서 첫 장 넘긴 사람 📖' },
  { from: 35, title: '아카데믹 단어 탐험가 🧭' },
  { from: 40, title: '토플 스피킹 타이머도 안 무서운 사람 ⏱️' },
  { from: 50, title: '원어민 코스프레 장인 👑' },
]

/** 예전 이름 (일본어 칭호 표) */
export const TITLES = TITLES_JA

const TITLE_TABLES: Readonly<Record<TitleLang, readonly { from: number; title: string }[]>> = { ja: TITLES_JA, en: TITLES_EN }

export const titleForLevel = (level: number, lang: TitleLang = 'ja'): string => {
  const table = TITLE_TABLES[lang]
  for (let i = table.length - 1; i >= 0; i--) if (level >= table[i]!.from) return table[i]!.title
  return table[0]!.title
}

/** 자동 판정: 복습 XP 가 더 많은 언어, 같으면 일본어 */
export const autoTitleLang = (xp: Readonly<Record<TitleLang, number>>): TitleLang => (xp.en > xp.ja ? 'en' : 'ja')

/** 설정 + 언어별 복습 XP → 쓸 칭호 언어 */
export const titleLangFor = (pref: TitlePref, xp: Readonly<Record<TitleLang, number>>): TitleLang =>
  pref === 'auto' ? autoTitleLang(xp) : pref

export interface LevelInfo {
  level: number
  title: string
  /** title 의 언어 */
  titleLang: TitleLang
  /** 누적 XP */
  xp: number
  /** 지금 레벨이 시작된 누적 XP */
  levelXp: number
  /** 다음 레벨이 되는 누적 XP */
  nextLevelXp: number
}

export const levelInfo = (xp: number, titleLang: TitleLang = 'ja'): LevelInfo => {
  const level = levelForXp(xp)
  return { level, title: titleForLevel(level, titleLang), titleLang, xp, levelXp: xpForLevel(level), nextLevelXp: xpForLevel(level + 1) }
}

/**
 * 연속 학습일 보너스. days 는 복습한 학습일 이름('YYYY-MM-DD')을 오래된 것부터 중복 없이,
 * prev 는 하루 전 이름. 연속이 끊기면 다시 7일부터 받을 수 있다.
 * 각 보너스를 받은 날과 XP 를 돌려준다.
 */
export const streakBonuses = (days: readonly string[], prev: (day: string) => string): { day: string; xp: number }[] => {
  const out: { day: string; xp: number }[] = []
  let run = 0
  let last = ''
  for (const d of days) {
    run = last !== '' && prev(d) === last ? run + 1 : 1
    last = d
    for (const m of XP.streak) if (m.days === run) out.push({ day: d, xp: m.xp })
  }
  return out
}
