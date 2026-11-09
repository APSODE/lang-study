import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { ensureDataDirs, loadConfig } from './config.ts'
import { seedContentIfEmpty } from './content.ts'
import { openDb } from './db.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const cfg = loadConfig()
ensureDataDirs(cfg)
const db = openDb(cfg.dbPath)

// 빈 DB 면 content/*.json 을 넣는다. 실패해도 서버는 띄운다 (관리 명령 import-content 로 다시 넣을 수 있다).
try {
  const seeded = seedContentIfEmpty(db, cfg.contentDir)
  if (seeded) {
    const names = seeded.files.map(f => basename(f)).join(', ')
    console.log(`콘텐츠 초기 가져오기 (${names}): 추가 ${seeded.added} · 갱신 ${seeded.updated} · 그대로 ${seeded.unchanged}`)
  }
} catch (err) {
  console.error(`콘텐츠 초기 가져오기 실패 (${cfg.contentDir}): ${(err as Error).message}`)
}

const app = createApp(cfg, db)

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: process.env.HOST || '127.0.0.1' }, info =>
  console.log(`NakamuraProject: http://${info.address}:${info.port}${cfg.basePath || '/'}  (DATA_DIR=${cfg.dataDir})`),
)

const shutdown = () => {
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
