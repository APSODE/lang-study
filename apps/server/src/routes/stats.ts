// 학습 통계 API. app.ts 에서 /api 아래에 붙인다. 모두 로그인 필요.
//   GET /stats/activity?days=84    { days: { day, reviews, correct }[] } 오늘로 끝나는 days 일 (1–366, 오래된 것부터)
//   GET /stats/tracks              { tracks: { track, notes, cards, unseen, learning, young, mature, accuracy7d }[] }
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { activity, ACTIVITY_DAYS_DEFAULT, ACTIVITY_DAYS_MAX, trackStats } from '../study/stats.ts'

export const statsRoutes = (db: DatabaseSync, opts: { now?: () => number } = {}) => {
  const now = opts.now ?? Date.now
  const r = new Hono<AppEnv>()
  r.use('/stats/*', requireUser)

  r.get('/stats/activity', c => {
    const raw = c.req.query('days')
    const days = raw === undefined ? ACTIVITY_DAYS_DEFAULT : Number(raw)
    if (!Number.isInteger(days) || days < 1 || days > ACTIVITY_DAYS_MAX) {
      return c.json({ error: `days 는 1–${ACTIVITY_DAYS_MAX} 정수여야 합니다` }, 400)
    }
    return c.json({ days: activity(db, c.get('user')!.id, days, now()) })
  })

  r.get('/stats/tracks', c => c.json({ tracks: trackStats(db, c.get('user')!.id, now()) }))

  return r
}
