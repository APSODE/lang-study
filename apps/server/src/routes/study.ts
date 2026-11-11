// 학습 API. app.ts 에서 /api 아래에 붙인다. 모두 로그인 필요.
//   GET  /study/summary                 트랙별 { track, notes, due, newLeft, newPerDay, learned, reviewsToday, mastery: { mastered, total, jlpt } }
//                                       + { day, streak, reviewsToday, level: { level, title, titleLang, xp, levelXp, nextLevelXp, xpToday } } (study/level.ts)
//                                       + writing: { track: 'kanji', due, newLeft, newPerDay, learned } (작문 모드. 트랙 숫자에는 작문 카드가 빠진다)
//                                       + writings: 같은 모양, 작문 모드가 있는 트랙마다 (kanji · toeic · toefl)
//                                       + decks: { key: 'deck:<키>', name, authors, notes, due, newLeft, newPerDay, learned, reviewsToday }[]
//                                         (친구가 만든 항목, 공개된 카드가 있는 것만, 만든 순서)
//   GET  /study/queue?track=&limit=     { items: QueueItem[] } (순서는 study/service.ts 맨 위 설명)
//                                       track 은 트랙(kana · kanji · toeic · toefl) 또는 항목 학습 키 deck:<키>.
//                                       QueueItem.author = 친구가 만든 노트의 만든 사람 (보이는 이름)
//        &mode=write&levels=5,4&learnedOnly=1
//                                       작문 모드: 복습할 작문 카드(레벨 무관) → 새 작문 카드(levels 의 JLPT 레벨만, learnedOnly 면 공부한 노트만)
//                                       track = kanji(일작) · toeic · toefl(영작). levels 는 한자에만 뜻이 있다.
//   GET  /study/write/options?track=kanji
//                                       { levels: { jlpt, total, learned, introduced, learnedFresh }[], all: { total, learned, introduced, learnedFresh },
//                                         newPerDay, newLeft, due } (영어 트랙은 levels 가 빈 배열)
//   POST /study/answer                  { cardId, response, durationMs?, rating?, selfCorrect? } → { correct, expected, rating, due }
//                                       selfCorrect 는 자기 평가 연습 방식(kanji-write · word-write · deck-recall)에서만 쓴다. 다른 연습 방식은 무시.
//   GET  /study/settings                { newPerDay: { kana, kanji, toeic, toefl }, writeNewPerDay, writeNewPerDays: { kanji, toeic, toefl } }
//   PUT  /study/settings                { newPerDay?: { kana?, kanji?, toeic?, toefl? }, writeNewPerDay?, writeNewPerDays?: { kanji?, toeic?, toefl? } }
//                                       (0–100 정수, 하나는 있어야 한다. writeNewPerDay = 예전 한자 작문 값)
//   POST /reports                       { noteId, cardId?, reason, body? } → 201 { id }
// 하루 경계 · 연속 학습일은 사용자 시간대의 04:00 기준 (study/day.ts).
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { isStudyKey, isTrack, writeTracks, type Track } from '@nakamura/core'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import {
  answerCard,
  buildQueue,
  getNewPerDay,
  getWriteNewPerDay,
  NEW_PER_DAY_MAX,
  type QueueOptions,
  setNewPerDay,
  setWriteNewPerDay,
  summary,
  writeOptions,
} from '../study/service.ts'
import { readBody } from './auth.ts'

export const REPORT_REASONS = ['wrong_answer', 'typo', 'audio', 'other'] as const
export const REPORT_BODY_MAX = 1000
const RESPONSE_MAX = 200
const QUEUE_LIMIT_MAX = 100
/** 예전 writeNewPerDay · summary.writing 이 가리키는 트랙 (한자 일작). 트랙별 값은 writeNewPerDays */
const WRITE_TRACK: Track = 'kanji'
const LEVELS = [1, 2, 3, 4, 5]
/** 한 카드에 이보다 오래 걸린 기록은 자리를 비운 것으로 보고 자른다 */
const DURATION_MAX = 10 * 60 * 1000

export interface StudyOptions {
  /** 현재 시각 (ms). 테스트에서 하루 경계 · 연속 학습일을 옮길 때 바꾼다. */
  now?: () => number
}

export const studyRoutes = (db: DatabaseSync, opts: StudyOptions = {}) => {
  const now = opts.now ?? Date.now
  const r = new Hono<AppEnv>()
  r.use('/study/*', requireUser)
  r.use('/reports', requireUser)

  r.get('/study/summary', c => c.json(summary(db, c.get('user')!.id, now())))

  r.get('/study/queue', c => {
    const track = c.req.query('track')
    if (!isStudyKey(track)) return c.json({ error: '알 수 없는 트랙입니다' }, 400)
    const raw = c.req.query('limit')
    const limit = raw === undefined ? 20 : Number(raw)
    if (!Number.isInteger(limit) || limit < 1 || limit > QUEUE_LIMIT_MAX) {
      return c.json({ error: `limit 은 1–${QUEUE_LIMIT_MAX} 정수여야 합니다` }, 400)
    }
    const mode = c.req.query('mode')
    if (mode !== undefined && mode !== 'normal' && mode !== 'write') {
      return c.json({ error: 'mode 는 write 만 쓸 수 있습니다' }, 400)
    }
    const opts: QueueOptions = {}
    if (mode === 'write') {
      if (!isTrack(track) || !writeTracks().includes(track)) return c.json({ error: '작문 모드가 없는 트랙입니다' }, 400)
      opts.mode = 'write'
      const levels = c.req.query('levels')
      if (levels !== undefined) {
        const list = levels.split(',').map(Number)
        if (levels === '' || list.some(n => !LEVELS.includes(n))) {
          return c.json({ error: 'levels 는 1–5 를 쉼표로 이은 값이어야 합니다 (예: 5,4)' }, 400)
        }
        opts.levels = [...new Set(list)]
      }
      const learned = c.req.query('learnedOnly')
      if (learned !== undefined) {
        if (!['1', '0', 'true', 'false'].includes(learned)) return c.json({ error: 'learnedOnly 는 1 또는 0 이어야 합니다' }, 400)
        opts.learnedOnly = learned === '1' || learned === 'true'
      }
    } else if (c.req.query('levels') !== undefined || c.req.query('learnedOnly') !== undefined) {
      return c.json({ error: 'levels · learnedOnly 는 작문 모드(mode=write)에서만 씁니다' }, 400)
    }
    return c.json({ items: buildQueue(db, c.get('user')!.id, track, limit, now(), Math.random, opts) })
  })

  r.get('/study/write/options', c => {
    const track = c.req.query('track') ?? WRITE_TRACK
    if (!isTrack(track) || !writeTracks().includes(track)) return c.json({ error: '작문 모드가 없는 트랙입니다' }, 400)
    return c.json(writeOptions(db, c.get('user')!.id, track, now()))
  })

  r.post('/study/answer', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '요청 형식이 올바르지 않습니다' }, 400)
    const { cardId, response, durationMs, rating, selfCorrect } = body
    if (typeof cardId !== 'string' || cardId === '' || cardId.length > 200) {
      return c.json({ error: 'cardId 가 없습니다' }, 400)
    }
    if (typeof response !== 'string' || response.length > RESPONSE_MAX) {
      return c.json({ error: `답은 ${RESPONSE_MAX}자 이하의 문자열이어야 합니다` }, 400)
    }
    if (rating !== undefined && rating !== null && rating !== 2 && rating !== 3 && rating !== 4) {
      return c.json({ error: 'rating 은 2(어려움) · 3(좋음) · 4(쉬움) 중 하나여야 합니다' }, 400)
    }
    if (selfCorrect !== undefined && selfCorrect !== null && typeof selfCorrect !== 'boolean') {
      return c.json({ error: 'selfCorrect 는 true 또는 false 여야 합니다' }, 400)
    }
    const duration =
      typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
        ? Math.min(Math.round(durationMs), DURATION_MAX)
        : null
    const out = answerCard(
      db,
      c.get('user')!.id,
      {
        cardId,
        response,
        durationMs: duration,
        rating: (rating ?? null) as 2 | 3 | 4 | null,
        selfCorrect: selfCorrect === true,
      },
      now(),
    )
    if (!out.ok) return c.json({ error: out.error }, out.status)
    const { correct, expected, rating: given, due } = out
    return c.json({ correct, expected, rating: given, due })
  })

  const settingsOf = (userId: number) => ({
    newPerDay: getNewPerDay(db, userId),
    writeNewPerDay: getWriteNewPerDay(db, userId, WRITE_TRACK),
    writeNewPerDays: Object.fromEntries(writeTracks().map(t => [t, getWriteNewPerDay(db, userId, t)])),
  })

  r.get('/study/settings', c => c.json(settingsOf(c.get('user')!.id)))

  r.put('/study/settings', async c => {
    const body = await readBody(c)
    if (!body || (body.newPerDay === undefined && body.writeNewPerDay === undefined && body.writeNewPerDays === undefined)) {
      return c.json({ error: 'newPerDay · writeNewPerDays 객체 또는 writeNewPerDay 가 필요합니다' }, 400)
    }
    const values = body.newPerDay
    const next: Partial<Record<Track, number>> = {}
    if (values !== undefined) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        return c.json({ error: 'newPerDay 객체가 필요합니다' }, 400)
      }
      for (const [k, v] of Object.entries(values)) {
        if (!isTrack(k)) return c.json({ error: `알 수 없는 트랙입니다: ${k}` }, 400)
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > NEW_PER_DAY_MAX) {
          return c.json({ error: `하루 새 카드는 0–${NEW_PER_DAY_MAX} 정수여야 합니다` }, 400)
        }
        next[k] = v as number
      }
    }
    const write = body.writeNewPerDay
    if (write !== undefined && (!Number.isInteger(write) || (write as number) < 0 || (write as number) > NEW_PER_DAY_MAX)) {
      return c.json({ error: `작문 하루 새 문제는 0–${NEW_PER_DAY_MAX} 정수여야 합니다` }, 400)
    }
    const writes: [Track, number][] = []
    if (write !== undefined) writes.push([WRITE_TRACK, write as number])
    const perTrack = body.writeNewPerDays
    if (perTrack !== undefined) {
      if (!perTrack || typeof perTrack !== 'object' || Array.isArray(perTrack)) {
        return c.json({ error: 'writeNewPerDays 객체가 필요합니다' }, 400)
      }
      for (const [k, v] of Object.entries(perTrack)) {
        if (!isTrack(k) || !writeTracks().includes(k)) return c.json({ error: `작문 모드가 없는 트랙입니다: ${k}` }, 400)
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > NEW_PER_DAY_MAX) {
          return c.json({ error: `작문 하루 새 문제는 0–${NEW_PER_DAY_MAX} 정수여야 합니다` }, 400)
        }
        writes.push([k, v as number])
      }
    }
    const userId = c.get('user')!.id
    db.exec('BEGIN IMMEDIATE')
    try {
      setNewPerDay(db, userId, next)
      for (const [t, n] of writes) setWriteNewPerDay(db, userId, t, n)
      db.exec('COMMIT')
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw err
    }
    return c.json(settingsOf(userId))
  })

  r.post('/reports', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '요청 형식이 올바르지 않습니다' }, 400)
    const { noteId, cardId, reason, body: text } = body
    if (typeof noteId !== 'string' || noteId === '') return c.json({ error: 'noteId 가 없습니다' }, 400)
    if (cardId !== undefined && cardId !== null && (typeof cardId !== 'string' || !cardId.startsWith(`${noteId}:`))) {
      return c.json({ error: 'cardId 가 노트와 맞지 않습니다' }, 400)
    }
    if (!(REPORT_REASONS as readonly unknown[]).includes(reason)) {
      return c.json({ error: `reason 은 ${REPORT_REASONS.join(' | ')} 중 하나여야 합니다` }, 400)
    }
    if (text !== undefined && text !== null && (typeof text !== 'string' || text.length > REPORT_BODY_MAX)) {
      return c.json({ error: `내용은 ${REPORT_BODY_MAX}자 이하여야 합니다` }, 400)
    }
    if (!db.prepare('SELECT 1 FROM notes WHERE id = ?').get(noteId)) return c.json({ error: '없는 노트입니다' }, 404)
    const trimmed = typeof text === 'string' ? text.trim() : ''
    const id = Number(
      db
        .prepare('INSERT INTO reports(note_id, card_id, user_id, reason, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(noteId, (cardId as string | undefined) ?? null, c.get('user')!.id, reason as string, trimmed || null, now())
        .lastInsertRowid,
    )
    return c.json({ id }, 201)
  })

  return r
}
