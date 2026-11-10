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
import type { DatabaseSync } from 'node:sqlite'
import {
  cardId as makeCardId,
  DEFAULT_NEW_PER_DAY,
  newCard,
  normMeaning,
  parseCard,
  review,
  serializeCard,
  TRACKS,
  type Drill,
  type Grade,
  type KanaFields,
  type Note,
  type ToeicFields,
  type Track,
} from '@nakamura/core'
import { type Catalog, type CatalogNote, publishedCatalog } from './catalog.ts'
import { dayKey, dayStart, safeTz, streakOf } from './day.ts'

export const NEW_PER_DAY_MAX = 100
/** 할 카드가 없을 때 미리 낼 범위 */
export const LEARN_AHEAD_MS = 20 * 60 * 1000

export type Rng = () => number

export interface QueueItem {
  cardId: string
  noteId: string
  drillId: string
  track: Track
  fields: Note['fields']
  isNew: boolean
  /** 고르기 연습 방식의 보기 (섞인 순서) */
  choices?: string[]
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

// --- 새 카드 후보 ---

interface Candidate {
  entry: CatalogNote
  drill: Drill
}

/** 오늘 소개할 수 있는 새 카드를 순서대로 (오늘 남은 수는 여기서 자르지 않는다) */
export const newCandidates = (db: DatabaseSync, userId: number, track: Track, start: number): Candidate[] => {
  const catalog = publishedCatalog(db, track)
  const seen = new Map<string, { drills: Set<string>; firstIntro: number }>()
  const rows = db
    .prepare('SELECT note_id AS noteId, drill_id AS drillId, introduced_at AS at FROM user_cards WHERE user_id = ? AND track = ?')
    .all(userId, track) as { noteId: string; drillId: string; at: number }[]
  for (const r of rows) {
    const s = seen.get(r.noteId) ?? { drills: new Set<string>(), firstIntro: r.at }
    s.drills.add(r.drillId)
    s.firstIntro = Math.min(s.firstIntro, r.at)
    seen.set(r.noteId, s)
  }

  const fresh: Candidate[] = []
  const follow: (Candidate & { k: number })[] = []
  for (const entry of catalog.notes) {
    const s = seen.get(entry.note.id)
    if (!s) {
      if (entry.drills[0]) fresh.push({ entry, drill: entry.drills[0] })
    } else if (s.firstIntro < start) {
      entry.drills.forEach((d, k) => {
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

const introducedSince = (db: DatabaseSync, userId: number, track: Track, start: number): number =>
  count(db, 'SELECT count(*) AS n FROM user_cards WHERE user_id = ? AND track = ? AND introduced_at >= ?', userId, track, start)

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

export const buildQueue = (
  db: DatabaseSync,
  userId: number,
  track: Track,
  limit: number,
  now: number,
  rng: Rng = Math.random,
): QueueItem[] => {
  const catalog = publishedCatalog(db, track)
  const start = dayStart(now, userTz(db, userId))

  const item = (entry: CatalogNote, drillId: string, isNew: boolean): QueueItem => {
    const choices = choicesFor(catalog, entry.note, drillId, rng)
    return {
      cardId: makeCardId(entry.note.id, drillId),
      noteId: entry.note.id,
      drillId,
      track,
      fields: entry.note.fields,
      isNew,
      ...(choices ? { choices } : {}),
    }
  }
  /** 노트가 공개 상태이고 연습 방식이 아직 적용되는 카드만 */
  const fromRows = (rows: CardRow[]): QueueItem[] =>
    rows.flatMap(r => {
      const entry = catalog.byId.get(r.noteId)
      return entry && entry.drills.some(d => d.id === r.drillId) ? [item(entry, r.drillId, false)] : []
    })
  const dueSql = `SELECT uc.card_id AS cardId, uc.note_id AS noteId, uc.drill_id AS drillId
     FROM user_cards uc JOIN notes n ON n.id = uc.note_id
     WHERE uc.user_id = ? AND uc.track = ? AND uc.suspended = 0 AND uc.due <= ? AND n.status = 'published'
     ORDER BY uc.due, uc.card_id LIMIT ?`

  const due = fromRows(db.prepare(dueSql).all(userId, track, now, limit) as unknown as CardRow[])

  const room = limit - due.length
  const quota = getNewPerDay(db, userId)[track] - introducedSince(db, userId, track, start)
  const fresh =
    room > 0 && quota > 0
      ? newCandidates(db, userId, track, start)
          .slice(0, Math.min(room, quota))
          .map(c => item(c.entry, c.drill.id, true))
      : []

  let ahead: QueueItem[] = []
  if (due.length === 0 && fresh.length === 0) {
    ahead = fromRows(db.prepare(dueSql).all(userId, track, now + LEARN_AHEAD_MS, limit) as unknown as CardRow[])
  }
  return [...declump(due), ...declump(fresh), ...declump(ahead)]
}

// --- 요약 ---

export const trackSummary = (db: DatabaseSync, userId: number, track: Track, now: number, start: number): TrackSummary => {
  const catalog = publishedCatalog(db, track)
  const newPerDay = getNewPerDay(db, userId)[track]
  const quota = Math.max(0, newPerDay - introducedSince(db, userId, track, start))
  const newLeft = quota === 0 ? 0 : Math.min(quota, newCandidates(db, userId, track, start).length)
  return {
    track,
    notes: catalog.notes.length,
    due: count(
      db,
      `SELECT count(*) AS n FROM user_cards uc JOIN notes n ON n.id = uc.note_id
       WHERE uc.user_id = ? AND uc.track = ? AND uc.suspended = 0 AND uc.due <= ? AND n.status = 'published'`,
      userId,
      track,
      now,
    ),
    newLeft,
    newPerDay,
    learned: count(db, 'SELECT count(*) AS n FROM user_cards WHERE user_id = ? AND track = ?', userId, track),
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
    | { track: Track; fields: string }
    | undefined
  if (!row) return NOT_FOUND
  const entry = publishedCatalog(db, row.track).byId.get(noteId)
  const drill = entry?.drills.find(d => d.id === drillId)
  if (!entry || !drill) return NOT_FOUND

  // 클라이언트가 보낸 정답 여부는 받지 않는다. 틀리면 평가는 무조건 다시(Again).
  // 예외는 자기 평가 연습 방식(selfGraded)의 selfCorrect 뿐이다.
  const checked = drill.check(entry.note, input.response)
  const { expected } = checked
  const correct = checked.correct || (drill.selfGraded === true && input.selfCorrect === true)
  const rating = (correct ? (input.rating ?? 3) : 1) as Grade
  const track = row.track
  const id = makeCardId(noteId, drillId)

  db.exec('BEGIN IMMEDIATE')
  try {
    const cur = db.prepare('SELECT fsrs FROM user_cards WHERE user_id = ? AND card_id = ?').get(userId, id) as
      | { fsrs: string }
      | undefined
    if (!cur) {
      const start = dayStart(now, userTz(db, userId))
      if (introducedSince(db, userId, track, start) >= getNewPerDay(db, userId)[track]) {
        db.exec('ROLLBACK')
        return { ok: false, status: 409, error: '오늘 볼 새 카드를 모두 봤습니다' }
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
