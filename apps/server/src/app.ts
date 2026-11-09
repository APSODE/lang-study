import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requireJsonForMutations } from './auth/csrf.ts'
import { type AppEnv, loadUser } from './auth/middleware.ts'
import type { Config } from './config.ts'
import { schemaVersion } from './db.ts'
import { adminRoutes } from './routes/admin.ts'
import { authRoutes } from './routes/auth.ts'
import { meRoutes } from './routes/me.ts'
import { noteRoutes } from './routes/notes.ts'
import { socialRoutes } from './routes/social.ts'
import { statsRoutes } from './routes/stats.ts'
import { studyRoutes } from './routes/study.ts'

export interface AppOptions {
  /** 현재 시각 (ms). 테스트에서 하루 경계 · 연속 학습일을 옮길 때 바꾼다. */
  now?: () => number
}

export const createApp = (cfg: Config, db: DatabaseSync, opts: AppOptions = {}) => {
  const app = new Hono<AppEnv>()
  const api = new Hono<AppEnv>()

  // 본문은 작은 JSON 뿐이다. 콘텐츠 업로드 · 녹음처럼 큰 요청은 해당 라우트에서 따로 늘린다.
  api.use('*', bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ error: '요청이 너무 큽니다' }, 413) }))
  api.use('*', requireJsonForMutations)
  api.use('*', loadUser(db, cfg))
  api.get('/health', c => c.json({ ok: true, schema: schemaVersion(db) }))
  api.route('/', authRoutes(cfg, db))
  api.route('/', studyRoutes(db, { now: opts.now }))
  api.route('/', noteRoutes(db))
  api.route('/', statsRoutes(db, { now: opts.now }))
  api.route('/', socialRoutes(db, { now: opts.now }))
  api.route('/', meRoutes(db))
  api.route('/', adminRoutes(db, { now: opts.now }))

  const root = new Hono<AppEnv>()
  root.route('/api', api)

  // 웹 정적 파일 (빌드된 경우에만). 경로가 없으면 SPA 의 index.html.
  if (existsSync(join(cfg.webDist, 'index.html'))) {
    const index = readFileSync(join(cfg.webDist, 'index.html'), 'utf8')
    const strip = (p: string) => (cfg.basePath && p.startsWith(cfg.basePath) ? p.slice(cfg.basePath.length) || '/' : p)
    root.use('/*', serveStatic({ root: cfg.webDist, rewriteRequestPath: strip }))
    root.get('*', c => (c.req.path.startsWith(`${cfg.basePath}/api/`) ? c.notFound() : c.html(index)))
  }

  app.route(cfg.basePath || '/', root)
  return app
}
