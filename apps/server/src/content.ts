// 콘텐츠 가져오기 · 내보내기 (DB ↔ content/<트랙>.json). docs/논의_정리.md "콘텐츠 흐름"
// - DB 가 원본. git 의 content/ 는 공개된 노트의 검토된 사본이라 복구에도 쓴다.
// - 필드 비교 · 저장은 키를 정렬한 JSON(canonical) 으로 한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { validateNote, type Note } from '@nakamura/core'

export const NOTE_STATUSES = ['draft', 'published', 'retired'] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

/** 객체 키를 재귀적으로 정렬한 값 (배열 순서는 그대로) */
export const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map(k => [k, sortKeys(o[k])]),
    )
  }
  return v
}

export const canonicalJson = (v: unknown): string => JSON.stringify(sortKeys(v))

export interface SourcedNote {
  note: Note
  /** notes.source 에 들어갈 값 (예: import:kana.json) */
  source: string
}

/** 파일들을 읽고 모두 검사한다. 문제가 하나라도 있으면 전체 목록과 함께 throw. */
export const loadContentFiles = (files: string[]): SourcedNote[] => {
  const errs: string[] = []
  const out: SourcedNote[] = []
  const seen = new Map<string, string>()
  for (const file of files) {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      errs.push(`${file}: 읽을 수 없습니다 (${(err as Error).message})`)
      continue
    }
    if (!Array.isArray(data)) {
      errs.push(`${file}: 노트 배열이어야 합니다`)
      continue
    }
    data.forEach((n: unknown, i) => {
      const id = (n as { id?: unknown } | null)?.id
      const where = `${file}[${i}]${typeof id === 'string' ? ` ${id}` : ''}`
      const e = validateNote(n)
      if (e.length) {
        for (const m of e) errs.push(`${where}: ${m}`)
        return
      }
      const note = n as Note
      const prev = seen.get(note.id)
      if (prev) {
        errs.push(`${where}: id 중복 (${prev})`)
        return
      }
      seen.set(note.id, where)
      out.push({ note, source: `import:${basename(file)}` })
    })
  }
  if (errs.length) throw new Error(`검사 실패 ${errs.length}건, 아무것도 쓰지 않았습니다:\n  ${errs.join('\n  ')}`)
  return out
}

export interface ImportResult {
  added: number
  updated: number
  unchanged: number
}

/** 하나의 트랜잭션으로 넣는다: 새 노트는 추가, 필드 · 상태가 다르면 갱신, 같으면 건너뛴다. 추가 · 갱신마다 수정 이력을 남긴다. */
export const importNotes = (
  db: DatabaseSync,
  notes: SourcedNote[],
  opts: { status?: NoteStatus; dryRun?: boolean; now?: number } = {},
): ImportResult => {
  const status = opts.status ?? 'published'
  const now = opts.now ?? Date.now()
  const res: ImportResult = { added: 0, updated: 0, unchanged: 0 }
  const get = db.prepare('SELECT track, fields, status FROM notes WHERE id = ?')
  const ins = db.prepare(
    'INSERT INTO notes(id, track, fields, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const upd = db.prepare('UPDATE notes SET track = ?, fields = ?, status = ?, updated_at = ? WHERE id = ?')
  const rev = db.prepare(
    "INSERT INTO note_revisions(note_id, fields, status, edited_by, reason, created_at) VALUES (?, ?, ?, NULL, 'import', ?)",
  )
  db.exec('BEGIN')
  try {
    for (const { note, source } of notes) {
      const fields = canonicalJson(note.fields)
      const cur = get.get(note.id) as { track: string; fields: string; status: string } | undefined
      // --status 를 주지 않으면 기존 노트의 상태는 그대로 둔다 (퇴출 · 초안을 가져오기로 되살리지 않는다)
      const next = cur && !opts.status ? cur.status : status
      if (!cur) {
        ins.run(note.id, note.track, fields, next, source, now, now)
        res.added++
      } else if (cur.track === note.track && canonicalJson(JSON.parse(cur.fields)) === fields && cur.status === next) {
        res.unchanged++
        continue
      } else {
        upd.run(note.track, fields, next, now, note.id)
        res.updated++
      }
      rev.run(note.id, fields, next, now)
    }
    db.exec(opts.dryRun ? 'ROLLBACK' : 'COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return res
}

/** 내보내기 파일 형식: 노트는 id 순, 키는 id · track · fields 순, fields 키는 정렬 */
export const formatContent = (notes: Note[]): string => {
  const sorted = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const out = sorted.map(n => ({ id: n.id, track: n.track, fields: sortKeys(n.fields) }))
  return `${JSON.stringify(out, null, 2)}\n`
}

export interface ExportResult {
  track: string
  file: string
  count: number
  written: boolean
}

/** 공개된 노트를 <dir>/<트랙>.json 으로. 내용이 같은 파일은 다시 쓰지 않는다. 공개 노트가 없는 트랙은 건드리지 않는다. */
export const exportContent = (db: DatabaseSync, dir: string): ExportResult[] => {
  const rows = db
    .prepare("SELECT id, track, fields FROM notes WHERE status = 'published' ORDER BY track, id")
    .all() as { id: string; track: string; fields: string }[]
  const byTrack = new Map<string, Note[]>()
  for (const r of rows) {
    const list = byTrack.get(r.track) ?? []
    list.push({ id: r.id, track: r.track, fields: JSON.parse(r.fields) } as Note)
    byTrack.set(r.track, list)
  }
  if (byTrack.size && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  const res: ExportResult[] = []
  for (const [track, notes] of byTrack) {
    const file = join(dir, `${track}.json`)
    const text = formatContent(notes)
    const same = existsSync(file) && readFileSync(file, 'utf8') === text
    if (!same) writeFileSync(file, text)
    res.push({ track, file, count: notes.length, written: !same })
  }
  return res
}
