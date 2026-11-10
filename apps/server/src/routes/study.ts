// 학습 API. app.ts 에서 /api 아래에 붙인다. 모두 로그인 필요.
//   GET  /study/summary                 트랙별 { track, notes, due, newLeft, newPerDay, learned, reviewsToday } + { day, streak, reviewsToday }
//   GET  /study/queue?track=&limit=     { items: QueueItem[] } (순서는 study/service.ts 맨 위 설명)
//   POST /study/answer                  { cardId, response, durationMs?, rating?, selfCorrect? } → { correct, expected, rating, due }
//                                       selfCorrect 는 자기 평가 연습 방식(kanji-write)에서만 쓴다. 다른 연습 방식은 무시.
//   GET  /study/settings                { newPerDay: { kana, kanji, toeic } }
//   PUT  /study/settings                { newPerDay: { kana?, kanji?, toeic? } } (0–100 정수)
//   POST /reports                       { noteId, cardId?, reason, body? } → 201 { id }
// 하루 경계 · 연속 학습일은 사용자 시간대의 04:00 기준 (study/day.ts).
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { isTrack, type Track } from '@nakamura/core'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { answerCard, buildQueue, getNewPerDay, NEW_PER_DAY_MAX, setNewPerDay, summary } from '../study/service.ts'
import { readBody } from './auth.ts'

export const REPORT_REASONS = ['wrong_answer', 'typo', 'audio', 'other'] as const
export const REPORT_BODY_MAX = 1000
const RESPONSE_MAX = 200
const QUEUE_LIMIT_MAX = 100
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
    if (!isTrack(track)) return c.json({ error: '알 수 없는 트랙입니다' }, 400)
    const raw = c.req.query('limit')
    const limit = raw === undefined ? 20 : Number(raw)
    if (!Number.isInteger(limit) || limit < 1 || limit > QUEUE_LIMIT_MAX) {
      return c.json({ error: `limit 은 1–${QUEUE_LIMIT_MAX} 정수여야 합니다` }, 400)
    }
    return c.json({ items: buildQueue(db, c.get('user')!.id, track, limit, now()) })
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

  r.get('/study/settings', c => c.json({ newPerDay: getNewPerDay(db, c.get('user')!.id) }))

  r.put('/study/settings', async c => {
    const body = await readBody(c)
    const values = body?.newPerDay
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return c.json({ error: 'newPerDay 객체가 필요합니다' }, 400)
    }
    const next: Partial<Record<Track, number>> = {}
    for (const [k, v] of Object.entries(values)) {
      if (!isTrack(k)) return c.json({ error: `알 수 없는 트랙입니다: ${k}` }, 400)
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > NEW_PER_DAY_MAX) {
        return c.json({ error: `하루 새 카드는 0–${NEW_PER_DAY_MAX} 정수여야 합니다` }, 400)
      }
      next[k] = v as number
    }
    const userId = c.get('user')!.id
    setNewPerDay(db, userId, next)
    return c.json({ newPerDay: getNewPerDay(db, userId) })
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
