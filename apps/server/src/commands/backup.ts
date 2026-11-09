import { join } from 'node:path'
import { backupTo } from '../db.ts'
import type { CommandContext } from './types.ts'

export const help = 'DATA_DIR/backups/app-YYYYmmdd-HHMM.sqlite 로 일관된 사본 (실행 중에도 안전)'

export const run = ({ cfg, db }: CommandContext) => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  const file = join(cfg.backupDir, `app-${stamp}.sqlite`)
  backupTo(db, file)
  console.log(file)
}
