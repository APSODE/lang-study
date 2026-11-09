// 관리 명령. 사용: node apps/server/src/cli.ts <명령> [인자...]
// 명령은 src/commands/<명령>.ts 하나씩. 각 파일은 `run(ctx, args)` 와 `help` 를 export 한다.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDataDirs, loadConfig } from './config.ts'
import { openDb } from './db.ts'
import type { Command } from './commands/types.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const dir = join(import.meta.dirname, 'commands')
const names = readdirSync(dir)
  .filter(f => f.endsWith('.ts') && f !== 'types.ts' && !f.endsWith('.test.ts'))
  .map(f => f.slice(0, -3))
  .sort()

const [name, ...args] = process.argv.slice(2)
if (!name || !names.includes(name)) {
  console.error('명령:')
  for (const n of names) {
    const cmd = (await import(join(dir, `${n}.ts`))) as Command
    console.error(`  ${n.padEnd(14)} ${cmd.help}`)
  }
  process.exit(name ? 1 : 0)
}

const cfg = loadConfig()
ensureDataDirs(cfg)
const db = openDb(cfg.dbPath)
try {
  const cmd = (await import(join(dir, `${name}.ts`))) as Command
  await cmd.run({ cfg, db }, args)
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  db.close()
}
