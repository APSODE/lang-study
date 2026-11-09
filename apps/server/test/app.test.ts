import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { ensureDataDirs, loadConfig } from '../src/config.ts'
import { backupTo, listMigrations, openDb, schemaVersion } from '../src/db.ts'

const setup = (env: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'nakamura-'))
  const cfg = loadConfig({ DATA_DIR: join(dir, 'data'), WEB_DIST: join(dir, 'web'), ...env })
  ensureDataDirs(cfg)
  return { dir, cfg, db: openDb(cfg.dbPath) }
}

describe('빈 DATA_DIR 에서 시작', () => {
  it('디렉토리를 만들고 마이그레이션을 모두 적용한다', () => {
    const { cfg, db } = setup()
    expect(existsSync(cfg.audioDir)).toBe(true)
    expect(existsSync(cfg.backupDir)).toBe(true)
    expect(schemaVersion(db)).toBe(listMigrations().at(-1)!.version)
  })
  it('다시 열어도 마이그레이션을 중복 적용하지 않는다', () => {
    const { cfg, db } = setup()
    db.close()
    expect(() => openDb(cfg.dbPath)).not.toThrow()
  })
  it('백업 사본을 다른 곳에서 열 수 있다 (이전 절차)', () => {
    const { cfg, db, dir } = setup()
    db.prepare("INSERT INTO users(name, password_hash, created_at) VALUES ('a', 'x', 0)").run()
    const file = join(cfg.backupDir, 'b.sqlite')
    backupTo(db, file)
    const moved = openDb(file)
    expect(moved.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 })
    void dir
  })
})

describe('HTTP', () => {
  it('/api/health', async () => {
    const { cfg, db } = setup()
    const res = await createApp(cfg, db).request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })
  it('BASE_PATH 아래에서 API 와 웹 파일을 낸다', async () => {
    const { cfg, db } = setup({ BASE_PATH: '/lang/' })
    mkdirSync(cfg.webDist, { recursive: true })
    writeFileSync(join(cfg.webDist, 'index.html'), '<!doctype html><title>t</title>')
    const app = createApp(cfg, db)
    expect((await app.request('/lang/api/health')).status).toBe(200)
    expect((await app.request('/api/health')).status).toBe(404)
    expect(await (await app.request('/lang/study/kana')).text()).toContain('<title>t</title>')
    expect((await app.request('/lang/api/nope')).status).toBe(404)
  })
})
