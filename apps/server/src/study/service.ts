// 학습 로직: 요약 · 큐 · 답 채점 · 하루 신규 카드 설정. 라우트(routes/study.ts)는 입력 검사와 응답만 한다.
// 시각(now)은 항상 인자로 받는다 — 테스트가 하루 경계 · 연속 학습일을 마음대로 옮길 수 있게.
//
// 큐 순서
//   1. 복습할 카드: due <= now, 일시 중지 아님, 노트가 아직 공개 상태. 가장 오래 기다린 것부터.
//   2. 새 카드: 오늘 남은 신규 수(newLeft)만큼. 노트 하나의 연습 방식들이 연달아 나오지 않게 한다:
//      - 처음 보는 노트는 첫 연습 방식(가나는 kana-to-romaji)으로만 소개한다.
//      - 그 노트의 나머지 연습 방식(후속 카드)은 소개한 다음 학습일부터 나온다 (같은 날 정답을 보여 주지 않게).
//      - 후속 카드가 쌓이지 않도록 "새 노트 1 : 후속 2" 비율로 섞는다 (노트 하나가 카드 3장이므로 이 비율이 균형).
//        후속 카드끼리는 연습 방식 순서 → 노트 순서 (romaji-to-kana 를 먼저 모두, 그다음 kana-listen).
//   3. 1 · 2 가 모두 비었을 때만: 20분 안에 돌아올 카드(방금 틀린 카드 등)를 미리 낸다 (Anki 의 learn ahead).
//   각 구간 안에서 같은 노트의 카드가 붙어 있으면 다른 노트 카드를 사이에 끼운다.
//
// 학습 모드 (core 의 Drill.mode)
//   보통(normal): mode 가 없는 연습 방식만. 위 순서 그대로.
//   작문(write):   mode 'write' 연습 방식만 (지금은 kanji-write). 보통 큐 · 요약 · 하루 새 카드 수에 섞이지 않는다.
//     1. 복습할 작문 카드 — 고른 레벨과 상관없이 모두 (SRS 일정을 깨지 않게).
//     2. 새 작문 카드 — 고른 JLPT 레벨(levels)만, learnedOnly 면 보통 카드가 하나라도 있는 노트만. 순서는 카탈로그(쉬운 레벨 → 자주 쓰는 순).
//        하루 새 문제 수는 따로 (user_track_settings 의 'write:<트랙>', 기본 10).
//     3. learn ahead 는 보통 모드와 같다.
//
// 학습 키 (core deck.ts 의 StudyKey)
//   고정 트랙(kana · kanji · toeic)은 트랙 이름, 친구가 만든 항목은 'deck:<항목 키>'. 큐 · 요약 · 하루 새 카드 수는 이 키별로 따로다.
//   user_cards.track · user_track_settings.track 에 이 키를 넣는다 (항목 카드는 'deck:<키>', 노트의 track 은 'deck').
//   항목의 하루 새 카드 수는 기본값(15)이다 (설정 화면은 고정 트랙만).
import type { DatabaseSync } from 'node:sqlite'
import {
  cardId as makeCardId,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_WRITE_NEW_PER_DAY,
  drillIdsOf,
  drillMode,
  deckStudyKey,
  isTrack,
  newCard,
  normMeaning,
  parseCard,
  review,
  serializeCard,
  TRACKS,
  type Drill,
  type Grade,
  type KanaFields,
  type KanjiFields,
  type Note,
  type NoteTrack,
  type StudyKey,
  type StudyMode,
  type ToeicFields,
  type Track,
  studyKeyOf,
} from '@nakamura/core'
import { displayNames } from '../authors.ts'
import { type Catalog, type CatalogNote, publishedCatalog, publishedDecks } from './catalog.ts'
import { dayKey, dayStart, safeTz, streakOf } from './day.ts'

export const NEW_PER_DAY_MAX = 100
/** 할 카드가 없을 때 미리 낼 범위 */
export const LEARN_AHEAD_MS = 20 * 60 * 1000

export type Rng = () => number

export interface QueueItem {
  cardId: string
  noteId: string
  drillId: string
  /** 노트의 트랙 (항목 카드는 'deck') */
  track: NoteTrack
  fields: Note['fields']
  isNew: boolean
  /** 고르기 연습 방식의 보기 (섞인 순서) */
  choices?: string[]
  /** 친구가 만든 노트면 만든 사람의 보이는 이름 */
  author?: string
}

/** 학습 키 하나의 요약 */
export interface KeySummary {
  /** 공개된 노트 수. 0 이면 준비 중 */
  notes: number
  due: number
  newLeft: number
  newPerDay: number
  learned: number
  reviewsToday: number
}

export interface TrackSummary extends KeySummary {
  track: Track
}

/** 친구가 만든 항목의 요약 */
export interface DeckSummary extends KeySummary {
  /** 학습 키 'deck:<키>' (큐 · 학습 화면 경로에 쓴다) */
  key: string
  name: string
  /** 카드를 만든 사람들의 보이는 이름 (먼저 만든 순) */
  authors: string[]
}

const count = (db: DatabaseSync, sql: string, ...params: (string | number)[]): number =>
  (db.prepare(sql).get(...params) as { n: number }).n

export const userTz = (db: DatabaseSync, userId: number): string =>
  safeTz((db.prepare('SELECT tz FROM users WHERE id = ?').get(userId) as { tz: string } | undefined)?.tz)

// --- 하루 신규 카드 설정 ---

export const getNewPerDay = (db: DatabaseSync, userId: number): Record<Track, number> => {
  const out = Object.fromEntries(TRACKS.map(t => [t, DEFAULT_NEW_PER_DAY])) as Record<Track, number>
  const rows = db.prepare('SELECT track, new_per_day AS n FROM user_track_settings WHERE user_id = ?').all(userId) as {
    track: string
    n: number
  }[]
  for (const r of rows) if ((TRACKS as readonly string[]).includes(r.track)) out[r.track as Track] = r.n
  return out
}

export const setNewPerDay = (db: DatabaseSync, userId: number, values: Partial<Record<Track, number>>): void => {
  const up = db.prepare(
    'INSERT INTO user_track_settings(user_id, track, new_per_day) VALUES (?, ?, ?) ON CONFLICT(user_id, track) DO UPDATE SET new_per_day = excluded.new_per_day',
  )
  for (const [track, n] of Object.entries(values)) up.run(userId, track, n)
}

/** 작문 모드의 하루 새 문제 수. user_track_settings 에 'write:<트랙>' 키로 둔다 (트랙 키와 겹치지 않는다). */
const writeKey = (track: Track): string => `write:${track}`

export const getWriteNewPerDay = (db: DatabaseSync, userId: number, track: Track): number =>
  (
    db.prepare('SELECT new_per_day AS n FROM user_track_settings WHERE user_id = ? AND track = ?').get(userId, writeKey(track)) as
      | { n: number }
      | undefined
  )?.n ?? DEFAULT_WRITE_NEW_PER_DAY

export const setWriteNewPerDay = (db: DatabaseSync, userId: number, track: Track, n: number): void => {
  db.prepare(
    'INSERT INTO user_track_settings(user_id, track, new_per_day) VALUES (?, ?, ?) ON CONFLICT(user_id, track) DO UPDATE SET new_per_day = excluded.new_per_day',
  ).run(userId, writeKey(track), n)
}

/** 항목의 하루 새 카드 수 (user_track_settings 의 'deck:<키>', 기본 15) */
const deckNewPerDay = (db: DatabaseSync, userId: number, key: StudyKey): number =>
  (
    db.prepare('SELECT new_per_day AS n FROM user_track_settings WHERE user_id = ? AND track = ?').get(userId, key) as
      | { n: number }
      | undefined
  )?.n ?? DEFAULT_NEW_PER_DAY

const newPerDayOf = (db: DatabaseSync, userId: number, key: StudyKey, mode: StudyMode): number => {
  if (!isTrack(key)) return deckNewPerDay(db, userId, key)
  return mode === 'write' ? getWriteNewPerDay(db, userId, key) : getNewPerDay(db, userId)[key]
}

// --- 학습 모드 ---

/** user_cards 의 drill_id 를 모드로 거르는 SQL 조각과 매개변수 */
const modeFilter = (mode: StudyMode, col = 'drill_id'): { sql: string; params: string[] } => {
  const ids = drillIdsOf('write')
  if (ids.length === 0) return { sql: mode === 'write' ? '0' : '1', params: [] }
  return { sql: `${col} ${mode === 'write' ? 'IN' : 'NOT IN'} (${ids.map(() => '?').join(', ')})`, params: ids }
}

/** 노트의 연습 방식 중 그 모드의 것 (레지스트리 순서) */
const modeDrills = (entry: CatalogNote, mode: StudyMode): Drill[] => entry.drills.filter(d => drillMode(d) === mode)

/** 작문 문제 고르기에 쓰는 레벨. 한자는 JLPT (5 = N5). 레벨이 없는 트랙 · 노트는 undefined */
const levelOf = (note: Note): number | undefined => (note.track === 'kanji' ? (note.fields as KanjiFields).jlpt : undefined)

/** 작문 큐에서 새 문제를 고르는 조건 */
export interface WriteSelect {
  /** 이 레벨의 노트만. 없으면 모두 */
  levels?: number[]
  /** 보통 카드가 하나라도 있는(공부한) 노트만 */
  learnedOnly?: boolean
}

// --- 새 카드 후보 ---

interface Candidate {
  entry: CatalogNote
  drill: Drill
}

/** 오늘 소개할 수 있는 새 카드를 순서대로 (오늘 남은 수는 여기서 자르지 않는다) */
export const newCandidates = (db: DatabaseSync, userId: number, track: StudyKey, start: number): Candidate[] => {
  const catalog = publishedCatalog(db, track)
  const seen = new Map<string, { drills: Set<string>; firstIntro: number }>()
  // 작문 카드는 보지 않는다: 작문만 한 노트도 보통 모드에서는 처음 보는 노트다
  const normal = modeFilter('normal')
  const rows = db
    .prepare(
      `SELECT note_id AS noteId, drill_id AS drillId, introduced_at AS at FROM user_cards WHERE user_id = ? AND track = ? AND ${normal.sql}`,
    )
    .all(userId, track, ...normal.params) as { noteId: string; drillId: string; at: number }[]
  for (const r of rows) {
    const s = seen.get(r.noteId) ?? { drills: new Set<string>(), firstIntro: r.at }
    s.drills.add(r.drillId)
    s.firstIntro = Math.min(s.firstIntro, r.at)
    seen.set(r.noteId, s)
  }

  const fresh: Candidate[] = []
  const follow: (Candidate & { k: number })[] = []
  for (const entry of catalog.notes) {
    const drills = modeDrills(entry, 'normal')
    const s = seen.get(entry.note.id)
    if (!s) {
      if (drills[0]) fresh.push({ entry, drill: drills[0] })
    } else if (s.firstIntro < start) {
      drills.forEach((d, k) => {
        if (!s.drills.has(d.id)) follow.push({ entry, drill: d, k })
      })
    }
  }
  // 후속 카드는 연습 방식 순서가 먼저 (모든 노트의 romaji-to-kana → kana-listen). 같은 노트가 연달아 나오지 않는다.
  follow.sort((a, b) => a.k - b.k)

  // 새 노트 1 : 후속 2. 한쪽이 바닥나면 남은 쪽을 그대로.
  const out: Candidate[] = []
  let f = 0
  let g = 0
  while (f < fresh.length || g < follow.length) {
    const wantFresh = out.length % 3 === 0
    if ((wantFresh && f < fresh.length) || g >= follow.length) out.push(fresh[f++]!)
    else out.push(follow[g++]!)
  }
  return out
}

/**
 * 작문 모드의 새 문제 후보 (카탈로그 순서: 한자는 쉬운 레벨 → 자주 쓰는 순).
 * 같은 날 보통 카드로 처음 본 노트도 낸다 — 작문은 문제를 직접 고르는 모드라서.
 */
export const writeCandidates = (db: DatabaseSync, userId: number, track: Track, sel: WriteSelect = {}): Candidate[] => {
  const catalog = publishedCatalog(db, track)
  const write = modeFilter('write')
  const rows = db
    .prepare(`SELECT note_id AS noteId, card_id AS cardId, ${write.sql} AS w FROM user_cards WHERE user_id = ? AND track = ?`)
    .all(...write.params, userId, track) as { noteId: string; cardId: string; w: number }[]
  const learned = new Set(rows.filter(r => !r.w).map(r => r.noteId))
  const have = new Set(rows.filter(r => r.w).map(r => r.cardId))
  const levels = sel.levels ? new Set(sel.levels) : null

  const out: Candidate[] = []
  for (const entry of catalog.notes) {
    const drills = modeDrills(entry, 'write')
    if (drills.length === 0) continue
    if (levels) {
      const lv = levelOf(entry.note)
      if (lv === undefined || !levels.has(lv)) continue
    }
    if (sel.learnedOnly && !learned.has(entry.note.id)) continue
    for (const d of drills) if (!have.has(makeCardId(entry.note.id, d.id))) out.push({ entry, drill: d })
  }
  return out
}

const introducedSince = (db: DatabaseSync, userId: number, track: StudyKey, start: number, mode: StudyMode): number => {
  const f = modeFilter(mode)
  return count(
    db,
    `SELECT count(*) AS n FROM user_cards WHERE user_id = ? AND track = ? AND introduced_at >= ? AND ${f.sql}`,
    userId,
    track,
    start,
    ...f.params,
  )
}

/** 지금 복습할 카드 수 (그 모드만, 일시 중지 · 비공개 노트 제외) */
const dueCount = (db: DatabaseSync, userId: number, track: StudyKey, now: number, mode: StudyMode): number => {
  const f = modeFilter(mode, 'uc.drill_id')
  return count(
    db,
    `SELECT count(*) AS n FROM user_cards uc JOIN notes n ON n.id = uc.note_id
     WHERE uc.user_id = ? AND uc.track = ? AND uc.suspended = 0 AND uc.due <= ? AND n.status = 'published' AND ${f.sql}`,
    userId,
    track,
    now,
    ...f.params,
  )
}

/** 그 모드의 카드 수 (한 번이라도 본 카드) */
const learnedCount = (db: DatabaseSync, userId: number, track: StudyKey, mode: StudyMode): number => {
  const f = modeFilter(mode)
  return count(db, `SELECT count(*) AS n FROM user_cards WHERE user_id = ? AND track = ? AND ${f.sql}`, userId, track, ...f.params)
}

// --- 보기 ---

const shuffle = <T>(xs: T[], rng: Rng): T[] => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** 소리가 같은 가나(じ/ぢ, ず/づ, お/を)는 듣기 보기로 같이 내지 않는다 */
const kanaSound = (f: KanaFields): string => (f.romaji === 'wo' ? 'o' : f.romaji)
const kanaGroup = (f: KanaFields): string => (f.yoon ? 'yoon' : f.dakuon ? 'dakuon' : 'basic')

/**
 * 고르기 연습 방식의 보기 4개 (정답 포함, 섞음). 고르기가 아니거나 보기를 만들 수 없으면 undefined.
 *   kana-listen: 같은 문자 체계, 같은 묶음(기본 · 탁음 · 요음)을 먼저, 모자라면 다른 묶음에서. 소리가 같은 글자는 뺀다.
 *   toeic-meaning: 다른 단어의 뜻 3개 (정답과 뜻이 같은 것은 뺀다). 보기가 2개 미만이면 입력식으로 둔다.
 */
export const choicesFor = (catalog: Catalog, note: Note, drillId: string, rng: Rng = Math.random): string[] | undefined => {
  if (drillId === 'kana-listen') {
    const a = note.fields as KanaFields
    const pool = catalog.notes
      .map(c => c.note.fields as KanaFields)
      .filter(f => f.script === a.script && f.char !== a.char && kanaSound(f) !== kanaSound(a))
    const same = shuffle(pool.filter(f => kanaGroup(f) === kanaGroup(a)), rng)
    const other = shuffle(pool.filter(f => kanaGroup(f) !== kanaGroup(a)), rng)
    const picked = [...same, ...other].slice(0, 3).map(f => f.char)
    return shuffle([a.char, ...picked], rng)
  }
  if (drillId === 'toeic-meaning') {
    const answer = (note.fields as ToeicFields).meaning_ko
    const seen = new Set([normMeaning(answer)])
    const pool: string[] = []
    for (const c of shuffle(catalog.notes, rng)) {
      const m = (c.note.fields as ToeicFields).meaning_ko
      if (seen.has(normMeaning(m))) continue
      seen.add(normMeaning(m))
      pool.push(m)
      if (pool.length === 3) break
    }
    return pool.length ? shuffle([answer, ...pool], rng) : undefined
  }
  return undefined
}

// --- 큐 ---

/** 같은 노트의 카드가 붙어 있으면 뒤에서 다른 노트 카드를 끌어와 사이에 넣는다 (나머지 순서는 유지) */
const declump = (items: QueueItem[]): QueueItem[] => {
  const out = [...items]
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!.noteId
    if (out[i]!.noteId !== prev) continue
    const j = out.findIndex((x, k) => k > i && x.noteId !== prev)
    if (j < 0) break
    const [moved] = out.splice(j, 1)
    out.splice(i, 0, moved!)
  }
  return out
}

interface CardRow {
  cardId: string
  noteId: string
  drillId: string
}

export interface QueueOptions extends WriteSelect {
  /** 기본 'normal' */
  mode?: StudyMode
}

export const buildQueue = (
  db: DatabaseSync,
  userId: number,
  track: StudyKey,
  limit: number,
  now: number,
  rng: Rng = Math.random,
  opts: QueueOptions = {},
): QueueItem[] => {
  const mode = opts.mode ?? 'normal'
  if (mode === 'write' && !isTrack(track)) return []
  const catalog = publishedCatalog(db, track)
  const start = dayStart(now, userTz(db, userId))
  let names: Map<number, string> | undefined
  const authorOf = (entry: CatalogNote): string | undefined => {
    if (entry.uploaderId === null) return undefined
    names ??= displayNames(db)
    return names.get(entry.uploaderId)
  }

  const item = (entry: CatalogNote, drillId: string, isNew: boolean): QueueItem => {
    const choices = choicesFor(catalog, entry.note, drillId, rng)
    const author = authorOf(entry)
    return {
      cardId: makeCardId(entry.note.id, drillId),
      noteId: entry.note.id,
      drillId,
      track: entry.note.track,
      fields: entry.note.fields,
      isNew,
      ...(choices ? { choices } : {}),
      ...(author ? { author } : {}),
    }
  }
  /** 노트가 공개 상태이고 연습 방식이 아직 적용되는 카드만 */
  const fromRows = (rows: CardRow[]): QueueItem[] =>
    rows.flatMap(r => {
      const entry = catalog.byId.get(r.noteId)
      return entry && entry.drills.some(d => d.id === r.drillId) ? [item(entry, r.drillId, false)] : []
    })
  // 작문 복습은 고른 레벨과 상관없이 모두 낸다 (SRS 일정을 깨지 않게)
  const f = modeFilter(mode, 'uc.drill_id')
  const dueSql = `SELECT uc.card_id AS cardId, uc.note_id AS noteId, uc.drill_id AS drillId
     FROM user_cards uc JOIN notes n ON n.id = uc.note_id
     WHERE uc.user_id = ? AND uc.track = ? AND uc.suspended = 0 AND uc.due <= ? AND n.status = 'published' AND ${f.sql}
     ORDER BY uc.due, uc.card_id LIMIT ?`
  const dueRows = (until: number) => db.prepare(dueSql).all(userId, track, until, ...f.params, limit) as unknown as CardRow[]

  const due = fromRows(dueRows(now))

  const room = limit - due.length
  const quota = newPerDayOf(db, userId, track, mode) - introducedSince(db, userId, track, start, mode)
  const fresh =
    room > 0 && quota > 0
      ? (mode === 'write' && isTrack(track) ? writeCandidates(db, userId, track, opts) : newCandidates(db, userId, track, start))
          .slice(0, Math.min(room, quota))
          .map(c => item(c.entry, c.drill.id, true))
      : []

  let ahead: QueueItem[] = []
  if (due.length === 0 && fresh.length === 0) ahead = fromRows(dueRows(now + LEARN_AHEAD_MS))
  return [...declump(due), ...declump(fresh), ...declump(ahead)]
}

// --- 요약 ---

/** 학습 키 요약. due · newLeft · learned 는 보통 모드 카드만 (작문은 writeSummary). reviewsToday 는 그 키의 모든 복습. */
const keySummary = (db: DatabaseSync, userId: number, track: StudyKey, now: number, start: number): KeySummary => {
  const catalog = publishedCatalog(db, track)
  const newPerDay = newPerDayOf(db, userId, track, 'normal')
  const quota = Math.max(0, newPerDay - introducedSince(db, userId, track, start, 'normal'))
  const newLeft = quota === 0 ? 0 : Math.min(quota, newCandidates(db, userId, track, start).length)
  return {
    notes: catalog.notes.length,
    due: dueCount(db, userId, track, now, 'normal'),
    newLeft,
    newPerDay,
    learned: learnedCount(db, userId, track, 'normal'),
    reviewsToday: count(
      db,
      `SELECT count(*) AS n FROM review_logs r JOIN user_cards uc ON uc.user_id = r.user_id AND uc.card_id = r.card_id
       WHERE r.user_id = ? AND uc.track = ? AND r.reviewed_at >= ? AND r.reviewed_at <= ?`,
      userId,
      track,
      start,
      now,
    ),
  }
}

export const trackSummary = (db: DatabaseSync, userId: number, track: Track, now: number, start: number): TrackSummary => ({
  track,
  ...keySummary(db, userId, track, now, start),
})

/** 공개된 카드가 있는 항목마다 요약 (만든 순서) */
export const deckSummaries = (db: DatabaseSync, userId: number, now: number, start: number): DeckSummary[] => {
  const decks = publishedDecks(db)
  if (decks.length === 0) return []
  const names = displayNames(db)
  return decks.map(d => {
    const key = deckStudyKey(d.key)
    return {
      key,
      name: d.name,
      authors: d.uploaderIds.flatMap(id => names.get(id) ?? []),
      ...keySummary(db, userId, key, now, start),
    }
  })
}

export interface WriteSummary {
  track: Track
  due: number
  /** 오늘 남은 새 문제 (레벨 · 공부한 한자 조건 없이 셌을 때) */
  newLeft: number
  newPerDay: number
  /** 한 번이라도 푼 작문 카드 수 */
  learned: number
}

export const writeSummary = (db: DatabaseSync, userId: number, track: Track, now: number, start: number): WriteSummary => {
  const newPerDay = getWriteNewPerDay(db, userId, track)
  const quota = Math.max(0, newPerDay - introducedSince(db, userId, track, start, 'write'))
  return {
    track,
    due: dueCount(db, userId, track, now, 'write'),
    newLeft: quota === 0 ? 0 : Math.min(quota, writeCandidates(db, userId, track).length),
    newPerDay,
    learned: learnedCount(db, userId, track, 'write'),
  }
}

export interface WriteLevel {
  /** JLPT 레벨 (5 = N5) */
  jlpt: number
  /** 작문 문제가 있는(예문이 있는) 공개 노트 수 */
  total: number
  /** 그중 보통 카드가 하나라도 있는(공부한) 노트 */
  learned: number
  /** 그중 작문 카드가 이미 있는 노트 */
  introduced: number
  /** 공부했고 작문 카드는 아직 없는 노트 ("공부한 한자만" 일 때 새 문제 수) */
  learnedFresh: number
}

/** 작문 문제 고르기 화면: 레벨별 수 (N5 → N1) + 오늘 남은 새 문제 · 복습 */
export const writeOptions = (db: DatabaseSync, userId: number, track: Track, now: number) => {
  const start = dayStart(now, userTz(db, userId))
  const catalog = publishedCatalog(db, track)
  const write = modeFilter('write')
  const rows = db
    .prepare(`SELECT DISTINCT note_id AS noteId, ${write.sql} AS w FROM user_cards WHERE user_id = ? AND track = ?`)
    .all(...write.params, userId, track) as { noteId: string; w: number }[]
  const learned = new Set(rows.filter(r => !r.w).map(r => r.noteId))
  const introduced = new Set(rows.filter(r => r.w).map(r => r.noteId))
  const byLevel = new Map<number, WriteLevel>()
  for (const entry of catalog.notes) {
    const lv = levelOf(entry.note)
    if (lv === undefined || modeDrills(entry, 'write').length === 0) continue
    const l = byLevel.get(lv) ?? { jlpt: lv, total: 0, learned: 0, introduced: 0, learnedFresh: 0 }
    const id = entry.note.id
    l.total++
    if (learned.has(id)) l.learned++
    if (introduced.has(id)) l.introduced++
    if (learned.has(id) && !introduced.has(id)) l.learnedFresh++
    byLevel.set(lv, l)
  }
  const s = writeSummary(db, userId, track, now, start)
  return {
    levels: [...byLevel.values()].sort((a, b) => b.jlpt - a.jlpt),
    newPerDay: s.newPerDay,
    newLeft: s.newLeft,
    due: s.due,
  }
}

export const streak = (db: DatabaseSync, userId: number, now: number, tz: string): number => {
  const rows = db
    .prepare('SELECT reviewed_at AS t FROM review_logs WHERE user_id = ? AND reviewed_at <= ? ORDER BY reviewed_at DESC')
    .iterate(userId, now) as Iterable<{ t: number }>
  function* keys() {
    for (const r of rows) yield dayKey(r.t, tz)
  }
  return streakOf(keys(), dayKey(now, tz))
}

export const summary = (db: DatabaseSync, userId: number, now: number) => {
  const tz = userTz(db, userId)
  const start = dayStart(now, tz)
  return {
    day: dayKey(now, tz),
    streak: streak(db, userId, now, tz),
    reviewsToday: count(
      db,
      'SELECT count(*) AS n FROM review_logs WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at <= ?',
      userId,
      start,
      now,
    ),
    tracks: TRACKS.map(t => trackSummary(db, userId, t, now, start)),
    writing: writeSummary(db, userId, 'kanji', now, start),
    decks: deckSummaries(db, userId, now, start),
  }
}

// --- 답 ---

export interface AnswerInput {
  cardId: string
  response: string
  durationMs: number | null
  /** 맞혔을 때 사용자가 고른 평가 (2 어려움 · 3 좋음 · 4 쉬움). 없으면 좋음. */
  rating: 2 | 3 | 4 | null
  /**
   * 자기 평가 (일작처럼 selfGraded 연습 방식만): check 가 틀렸다고 해도 사용자가 모범 답안과 비교해 맞았다고 고른 경우.
   * 다른 연습 방식에서는 무시한다 — 클라이언트가 정답을 꾸밀 수 없게.
   */
  selfCorrect?: boolean
}

export type AnswerOutcome =
  | { ok: true; correct: boolean; expected: string; rating: Grade; due: number }
  | { ok: false; status: 404 | 409; error: string }

const NOT_FOUND = { ok: false, status: 404, error: '없는 카드입니다' } as const

/** 서버가 core 의 check 로 다시 채점하고, FSRS 를 갱신하고, 기록을 남긴다. 하나의 트랜잭션. */
export const answerCard = (db: DatabaseSync, userId: number, input: AnswerInput, now: number): AnswerOutcome => {
  const sep = input.cardId.indexOf(':')
  if (sep <= 0) return NOT_FOUND
  const noteId = input.cardId.slice(0, sep)
  const drillId = input.cardId.slice(sep + 1)
  const row = db.prepare("SELECT track, fields FROM notes WHERE id = ? AND status = 'published'").get(noteId) as
    | { track: NoteTrack; fields: string }
    | undefined
  if (!row) return NOT_FOUND
  // 학습 키: 고정 트랙은 트랙, 항목 카드는 deck:<키>. user_cards.track 에 이 값을 넣는다.
  const track = studyKeyOf({ id: noteId, track: row.track })
  if (!track) return NOT_FOUND
  const entry = publishedCatalog(db, track).byId.get(noteId)
  const drill = entry?.drills.find(d => d.id === drillId)
  if (!entry || !drill) return NOT_FOUND

  // 클라이언트가 보낸 정답 여부는 받지 않는다. 틀리면 평가는 무조건 다시(Again).
  // 예외는 자기 평가 연습 방식(selfGraded)의 selfCorrect 뿐이다.
  const checked = drill.check(entry.note, input.response)
  const { expected } = checked
  const correct = checked.correct || (drill.selfGraded === true && input.selfCorrect === true)
  const rating = (correct ? (input.rating ?? 3) : 1) as Grade
  const id = makeCardId(noteId, drillId)

  db.exec('BEGIN IMMEDIATE')
  try {
    const cur = db.prepare('SELECT fsrs FROM user_cards WHERE user_id = ? AND card_id = ?').get(userId, id) as
      | { fsrs: string }
      | undefined
    if (!cur) {
      // 하루 새 카드 수는 모드별로 따로 센다 (작문 카드는 트랙 수에 들어가지 않는다)
      const mode = drillMode(drill)
      const start = dayStart(now, userTz(db, userId))
      if (introducedSince(db, userId, track, start, mode) >= newPerDayOf(db, userId, track, mode)) {
        db.exec('ROLLBACK')
        return {
          ok: false,
          status: 409,
          error: mode === 'write' ? '오늘 볼 새 작문 문제를 모두 봤습니다' : '오늘 볼 새 카드를 모두 봤습니다',
        }
      }
    }
    const next = review(cur ? parseCard(cur.fsrs) : newCard(new Date(now)), rating, new Date(now)).card
    const due = next.due.getTime()
    if (cur) {
      db.prepare('UPDATE user_cards SET fsrs = ?, due = ? WHERE user_id = ? AND card_id = ?').run(
        serializeCard(next),
        due,
        userId,
        id,
      )
    } else {
      db.prepare(
        'INSERT INTO user_cards(user_id, card_id, note_id, drill_id, track, fsrs, due, introduced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(userId, id, noteId, drillId, track, serializeCard(next), due, now)
    }
    db.prepare(
      'INSERT INTO review_logs(user_id, card_id, rating, correct, response, duration_ms, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(userId, id, rating, correct ? 1 : 0, input.response, input.durationMs, now)
    db.exec('COMMIT')
    return { ok: true, correct, expected, rating, due }
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw err
  }
}
