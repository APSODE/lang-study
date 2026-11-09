// 같이 쓰는 기능 API. app.ts 에서 /api 아래에 붙인다. 모두 로그인 필요.
//   GET /social/leaderboard?period=week|month   { period, start, entries: { rank, userId, name, reviews, streak, isMe }[] }
//   GET /social/friends                         { friends: { userId, name, streak, reviewsWeek, lastStudiedDay, tracks }[] }
// 진도 공개를 끈 사용자(show_progress = 0)는 다른 사람에게 보이지 않는다. 자기 리더보드 자리는 보인다.
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { friends, leaderboard, type Period, PERIODS } from '../social.ts'

export const socialRoutes = (db: DatabaseSync, opts: { now?: () => number } = {}) => {
  const now = opts.now ?? Date.now
  const r = new Hono<AppEnv>()
  r.use('/social/*', requireUser)

  r.get('/social/leaderboard', c => {
    const period = c.req.query('period') ?? 'week'
    if (!(PERIODS as readonly string[]).includes(period)) {
      return c.json({ error: `period 는 ${PERIODS.join(' | ')} 중 하나여야 합니다` }, 400)
    }
    return c.json(leaderboard(db, c.get('user')!.id, period as Period, now()))
  })

  r.get('/social/friends', c => c.json({ friends: friends(db, c.get('user')!.id, now()) }))

  return r
}
