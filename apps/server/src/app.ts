import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { Config } from './config.ts'
import { schemaVersion } from './db.ts'

export const createApp = (cfg: Config, db: DatabaseSync) => {
  const app = new Hono()
  const api = new Hono()

  api.get('/health', c => c.json({ ok: true, schema: schemaVersion(db) }))

  const root = new Hono()
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
