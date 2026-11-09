import { schemaVersion } from '../db.ts'
import type { CommandContext } from './types.ts'

export const help = '마이그레이션 적용 후 현재 스키마 버전 출력'

export const run = ({ db }: CommandContext) => console.log(`schema ${schemaVersion(db)}`)
