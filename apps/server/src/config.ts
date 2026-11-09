// 설정은 환경 변수만. 호스트별 차이는 .env 에만 둔다 (docs/논의_정리.md "배포 · 이전").
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export interface Config {
  port: number
  dataDir: string
  dbPath: string
  audioDir: string
  backupDir: string
  publicUrl: string
  /** '' 또는 '/lang' 처럼 앞에 / 가 있고 뒤에는 없다 */
  basePath: string
  sessionSecret: string
  /** 비어 있으면 DB → git 내보내기를 끈다 */
  gitRemote: string
  webDist: string
}

const normBase = (s: string): string => {
  const t = s.trim().replace(/\/+$/, '')
  return t === '' ? '' : t.startsWith('/') ? t : `/${t}`
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const dataDir = resolve(env.DATA_DIR || './data')
  const port = Number(env.PORT || 8081)
  const cfg: Config = {
    port,
    dataDir,
    dbPath: resolve(dataDir, 'db', 'app.sqlite'),
    audioDir: resolve(dataDir, 'audio'),
    backupDir: resolve(dataDir, 'backups'),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    basePath: normBase(env.BASE_PATH || ''),
    sessionSecret: env.SESSION_SECRET || '',
    gitRemote: env.GIT_REMOTE || '',
    webDist: resolve(env.WEB_DIST || resolve(import.meta.dirname, '../../web/dist')),
  }
  if (env.NODE_ENV === 'production' && (cfg.sessionSecret === '' || cfg.sessionSecret === 'change-me')) {
    throw new Error('SESSION_SECRET 을 설정하세요 (openssl rand -hex 32)')
  }
  return cfg
}

/** 빈 DATA_DIR 로 띄워도 스스로 초기화된다 */
export const ensureDataDirs = (cfg: Config): void => {
  for (const d of [resolve(cfg.dbPath, '..'), cfg.audioDir, cfg.backupDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
}
