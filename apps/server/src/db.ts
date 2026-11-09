// SQLite(node:sqlite). 시작할 때 migrations/NNN_*.sql 을 순서대로 적용한다 (PRAGMA user_version).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

export const listMigrations = (): { version: number; file: string }[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map(f => ({ version: Number(f.slice(0, 3)), file: f }))

export const schemaVersion = (db: DatabaseSync): number =>
  Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)

export const migrate = (db: DatabaseSync): number[] => {
  const applied: number[] = []
  for (const m of listMigrations()) {
    if (m.version <= schemaVersion(db)) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, m.file), 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`마이그레이션 ${m.file} 실패: ${(err as Error).message}`)
    }
    applied.push(m.version)
  }
  return applied
}

export const openDb = (path: string): DatabaseSync => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

/** 일관된 사본 (실행 중에도 안전). 이전 · 백업에 쓴다. */
export const backupTo = (db: DatabaseSync, file: string): void => {
  db.prepare('VACUUM INTO ?').run(file)
}
