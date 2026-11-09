// 관리 명령. 사용: npm run cli -w @nakamura/server -- <명령>
//   backup            DATA_DIR/backups/app-YYYYmmdd-HHMM.sqlite 로 일관된 사본
//   migrate           마이그레이션만 적용하고 현재 버전 출력
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDataDirs, loadConfig } from './config.ts'
import { backupTo, openDb, schemaVersion } from './db.ts'

if (existsSync('.env')) process.loadEnvFile('.env')
const cfg = loadConfig()
ensureDataDirs(cfg)
const [cmd] = process.argv.slice(2)
const db = openDb(cfg.dbPath)

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')

switch (cmd) {
  case 'backup': {
    const file = join(cfg.backupDir, `app-${stamp()}.sqlite`)
    backupTo(db, file)
    console.log(file)
    break
  }
  case 'migrate':
    console.log(`schema ${schemaVersion(db)}`)
    break
  default:
    console.error('명령: backup | migrate')
    process.exitCode = 1
}
db.close()
