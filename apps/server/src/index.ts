import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { ensureDataDirs, loadConfig } from './config.ts'
import { openDb } from './db.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const cfg = loadConfig()
ensureDataDirs(cfg)
const db = openDb(cfg.dbPath)
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
