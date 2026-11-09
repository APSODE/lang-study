import type { DatabaseSync } from 'node:sqlite'
import type { Config } from '../config.ts'

export interface CommandContext {
  cfg: Config
  db: DatabaseSync
}

export interface Command {
  help: string
  run(ctx: CommandContext, args: string[]): void | Promise<void>
}
