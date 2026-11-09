import { exportContent } from '../content.ts'
import type { CommandContext } from './types.ts'

export const help = '[디렉토리]  공개된 노트를 <디렉토리>/<트랙>.json 으로 내보내기 (기본 content)'

export const run = ({ db }: CommandContext, args: string[]) => {
  const dir = args[0] ?? 'content'
  const res = exportContent(db, dir)
  if (res.length === 0) console.log('공개된 노트가 없습니다')
  for (const r of res) console.log(`${r.file}  ${r.count}개  ${r.written ? '씀' : '그대로'}`)
}
