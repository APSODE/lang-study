import { importNotes, loadContentFiles, type NoteStatus } from '../content.ts'
import type { CommandContext } from './types.ts'

export const help = '[--dry-run] [--status=published|draft] <파일.json...>  노트 JSON 을 검사 후 DB 에 넣기 (기본 published)'

export const run = ({ db }: CommandContext, args: string[]) => {
  let dryRun = false
  let status: NoteStatus = 'published'
  const files: string[] = []
  for (const a of args) {
    if (a === '--dry-run') dryRun = true
    else if (a.startsWith('--status=')) {
      const s = a.slice('--status='.length)
      if (s !== 'published' && s !== 'draft') throw new Error(`--status 는 published 또는 draft: ${s}`)
      status = s
    } else if (a.startsWith('--')) throw new Error(`알 수 없는 옵션: ${a}`)
    else files.push(a)
  }
  if (files.length === 0) throw new Error(`사용: import-content ${help}`)
  const notes = loadContentFiles(files)
  const r = importNotes(db, notes, { status, dryRun })
  console.log(`${dryRun ? '(dry-run) ' : ''}추가 ${r.added} · 갱신 ${r.updated} · 그대로 ${r.unchanged}`)
}
