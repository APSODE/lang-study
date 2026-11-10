// 레벨 (활동 XP) · 트랙별 실력(익힌 노트 수). 규칙은 docs/레벨_작업.md, 레벨 · 칭호 계산은 core level.ts.
// XP 는 따로 저장하지 않고 요청마다 기록에서 다시 센다 (기존 사용자도 지금까지 한 만큼으로 시작한다):
//   - 복습 기록(review_logs): 카드별 첫 답 +3, 그 뒤 정답 +2 · 오답 +1. SQL 창 함수 한 번.
//   - 연속 학습일 7 · 30 · 100일에 닿은 날 보너스: 복습한 학습일 목록에서. 학습일은 15분 단위로 묶어 센다
//     (모든 시간대 오프셋이 15분의 배수라서 같은 15분 안의 기록은 같은 학습일이다) — 기록 수가 많아도 dayKey 호출은 적다.
//   - 공개된 내가 만든 문제(notes.source = 'upload:<id>', status published) 개당 +5. 오늘 얻은 몫은 updated_at 으로 어림한다.
//   - "그날 할 복습을 다 비운 날 +10" 은 기록으로 알 수 없어서 뺐다 (그날 due 였던 카드 목록이 남지 않는다).
// 칭호는 일본어 · 영어 두 벌. users.title_lang 이 auto 면 복습 XP(가나 · 한자 vs 토익 · 토플, 항목 · 보너스 제외)가 더 많은 쪽, 같으면 일본어.
import type { DatabaseSync } from 'node:sqlite'
import {
  isTitlePref,
  isTrack,
  levelInfo,
  streakBonuses,
  titleLangFor,
  TRACK_TITLE_LANG,
  XP,
  type KanjiFields,
  type LevelInfo,
  type StudyKey,
  type TitleLang,
  type TitlePref,
} from '@nakamura/core'
import { publishedCatalog } from './catalog.ts'
import { dayKey, dayStart, prevDayKey, safeTz } from './day.ts'

/** 복습 간격이 이 일수 이상이면 '익힌' 카드 (stats.ts 의 MATURE_DAYS 와 같다) */
const MATURE_DAYS = 21
const STATE_REVIEW = 2
const BUCKET_MS = 15 * 60 * 1000
/** 이 비율 이상 익히면 그 JLPT 단계 한자를 '정복' */
export const JLPT_CLEAR_RATIO = 0.8

export interface UserLevel extends LevelInfo {
  /** 오늘(학습일) 얻은 XP */
  xpToday: number
}

const tzOf = (db: DatabaseSync, userId: number): string =>
  safeTz((db.prepare('SELECT tz FROM users WHERE id = ?').get(userId) as { tz: string } | undefined)?.tz)

/** [전체, start 이후, 언어별 전체] 복습 XP (now 까지). 언어별은 카드의 노트 트랙으로 나눈다 (항목 · 지워진 노트는 빠진다) */
const reviewXp = (db: DatabaseSync, userId: number, start: number, now: number): [number, number, Record<TitleLang, number>] => {
  const rows = db
    .prepare(
      `SELECT n.track AS track,
              total(CASE WHEN first THEN ? WHEN correct THEN ? ELSE ? END) AS all_,
              total(CASE WHEN t < ? THEN 0 WHEN first THEN ? WHEN correct THEN ? ELSE ? END) AS today
         FROM (SELECT correct, reviewed_at AS t, card_id,
                      row_number() OVER (PARTITION BY card_id ORDER BY reviewed_at, id) = 1 AS first
                 FROM review_logs WHERE user_id = ?) l
         LEFT JOIN notes n ON n.id = substr(l.card_id, 1, instr(l.card_id, ':') - 1)
        WHERE t <= ?
        GROUP BY n.track`,
    )
    .all(XP.newCard, XP.reviewCorrect, XP.reviewWrong, start, XP.newCard, XP.reviewCorrect, XP.reviewWrong, userId, now) as {
    track: string | null
    all_: number
    today: number
  }[]
  let all = 0
  let today = 0
  const byLang: Record<TitleLang, number> = { ja: 0, en: 0 }
  for (const r of rows) {
    all += r.all_
    today += r.today
    if (r.track !== null && isTrack(r.track)) byLang[TRACK_TITLE_LANG[r.track]] += r.all_
  }
  return [all, today, byLang]
}

/** [전체, 오늘] 연속 학습일 보너스 */
const streakXp = (db: DatabaseSync, userId: number, tz: string, now: number): [number, number] => {
  const buckets = db
    .prepare('SELECT DISTINCT reviewed_at / ? AS b FROM review_logs WHERE user_id = ? AND reviewed_at <= ? ORDER BY b')
    .all(BUCKET_MS, userId, now) as { b: number }[]
  const days: string[] = []
  for (const { b } of buckets) {
    const k = dayKey(Math.floor(b) * BUCKET_MS, tz)
    if (days[days.length - 1] !== k) days.push(k)
  }
  const today = dayKey(now, tz)
  let all = 0
  let todayXp = 0
  for (const s of streakBonuses(days, prevDayKey)) {
    all += s.xp
    if (s.day === today) todayXp += s.xp
  }
  return [all, todayXp]
}

/** [전체, start 이후] 공개된 내가 만든 문제 XP */
const noteXp = (db: DatabaseSync, userId: number, start: number): [number, number] => {
  const r = db
    .prepare(
      `SELECT count(*) AS n, total(updated_at >= ?) AS today FROM notes WHERE source = ? AND status = 'published'`,
    )
    .get(start, `upload:${userId}`) as { n: number; today: number }
  return [r.n * XP.publishedNote, r.today * XP.publishedNote]
}

export const userXp = (
  db: DatabaseSync,
  userId: number,
  now: number,
): { xp: number; xpToday: number; reviewXpByLang: Record<TitleLang, number> } => {
  const tz = tzOf(db, userId)
  const start = dayStart(now, tz)
  const review = reviewXp(db, userId, start, now)
  const parts = [review, streakXp(db, userId, tz, now), noteXp(db, userId, start)]
  return { xp: parts.reduce((n, p) => n + p[0], 0), xpToday: parts.reduce((n, p) => n + p[1], 0), reviewXpByLang: review[2] }
}

/** 칭호 언어 설정 (users.title_lang, 모르는 값은 auto) */
export const titlePrefOf = (db: DatabaseSync, userId: number): TitlePref => {
  const v = (db.prepare('SELECT title_lang AS v FROM users WHERE id = ?').get(userId) as { v: string } | undefined)?.v
  return isTitlePref(v) ? v : 'auto'
}

export const userLevel = (db: DatabaseSync, userId: number, now: number): UserLevel => {
  const { xp, xpToday, reviewXpByLang } = userXp(db, userId, now)
  return { ...levelInfo(xp, titleLangFor(titlePrefOf(db, userId), reviewXpByLang)), xpToday }
}

// --- 트랙별 실력 ---

export interface Mastery {
  /** 익힌 노트 (복습 간격 21일 이상인 카드가 하나라도 있는 공개 노트, 일시 중지 카드 제외) */
  mastered: number
  /** 공개 노트 수 */
  total: number
  /** 한자만: 쉬운 단계부터 차례로 80% 이상 익힌 가장 높은 JLPT 단계 (5 = N5). 없으면 null */
  jlpt: number | null
}

export const mastery = (db: DatabaseSync, userId: number, key: StudyKey): Mastery => {
  const catalog = publishedCatalog(db, key)
  const ids = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT note_id AS id FROM user_cards
            WHERE user_id = ? AND track = ? AND suspended = 0
              AND json_extract(fsrs, '$.state') = ? AND json_extract(fsrs, '$.scheduled_days') >= ?`,
        )
        .all(userId, key, STATE_REVIEW, MATURE_DAYS) as { id: string }[]
    ).map(r => r.id),
  )
  let mastered = 0
  const byLevel = new Map<number, { total: number; mastered: number }>()
  for (const c of catalog.notes) {
    const has = ids.has(c.note.id)
    if (has) mastered++
    if (key === 'kanji') {
      const lv = (c.note.fields as KanjiFields).jlpt
      if (lv === undefined) continue
      const l = byLevel.get(lv) ?? { total: 0, mastered: 0 }
      l.total++
      if (has) l.mastered++
      byLevel.set(lv, l)
    }
  }
  let jlpt: number | null = null
  if (key === 'kanji') {
    for (const lv of [...byLevel.keys()].sort((a, b) => b - a)) {
      const l = byLevel.get(lv)!
      if (l.mastered < l.total * JLPT_CLEAR_RATIO) break
      jlpt = lv
    }
  }
  return { mastered, total: catalog.notes.length, jlpt }
}
