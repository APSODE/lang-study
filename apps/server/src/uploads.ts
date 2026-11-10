// 친구가 만든 문제 (docs/논의_정리.md "친구 문제 만들기").
// - 사용자가 칸을 채워 보내면 초안(status draft, source upload:<user id>)으로 저장하고 수정 이력을 남긴다.
// - 관리자가 공개하면 status published 가 되어 catalog 캐시(공개 노트 개수 · 수정 시각)가 바뀌고 모두의 학습에 들어간다.
// - 반려하면 retired. 같은 id 의 노트는 상태와 상관없이 다시 만들 수 없다.
import type { DatabaseSync } from 'node:sqlite'
import { validateNote, type Track } from '@nakamura/core'
import { canonicalJson, type NoteStatus } from './content.ts'
import { dayStart } from './study/day.ts'
import { userTz } from './study/service.ts'

/** 만들 수 있는 트랙 */
export const UPLOAD_TRACKS = ['kanji', 'toeic'] as const
export type UploadTrack = (typeof UPLOAD_TRACKS)[number]
export const isUploadTrack = (v: unknown): v is UploadTrack => (UPLOAD_TRACKS as readonly unknown[]).includes(v)

/** 한 사람이 하루(04:00 기준)에 만들 수 있는 문제 수 */
export const UPLOAD_PER_DAY = 20
const STR_MAX = 300
const ARR_MAX = 20
const LIST_MAX = 200

/** 트랙별로 만들기에서 받는 필드 (나머지 필드는 사전 · 가져오기용이라 받지 않는다) */
const UPLOAD_FIELDS: Record<UploadTrack, { required: string[]; optional: string[] }> = {
  kanji: { required: ['kanji', 'on', 'kun', 'meanings_ko'], optional: ['hunum_ko', 'jlpt'] },
  toeic: { required: ['word', 'meaning_ko', 'example_en', 'example_ko'], optional: ['pos'] },
}

export const uploadSource = (userId: number) => `upload:${userId}`

/** 노트 id: 한자 kanji-<글자>, 토익 toeic-<단어 소문자, 공백 → '-', 아포스트로피 제거> */
export const uploadNoteId = (track: UploadTrack, fields: Record<string, unknown>): string => {
  if (track === 'kanji') return `kanji-${typeof fields.kanji === 'string' ? fields.kanji : ''}`
  const word = typeof fields.word === 'string' ? fields.word : ''
  return `toeic-${word.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, '-')}`
}

/** 앞뒤 공백 정리. 빈 선택 칸(빈 문자열 · null)은 뺀다. 배열은 항목마다 정리하고 빈 항목을 뺀다. */
const normalize = (track: UploadTrack, raw: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    let x: unknown = v
    if (typeof x === 'string') x = x.trim().replace(/\s+/g, ' ')
    else if (Array.isArray(x)) x = x.map(e => (typeof e === 'string' ? e.trim() : e)).filter(e => e !== '')
    const optional = UPLOAD_FIELDS[track].optional.includes(k)
    if (optional && (x === '' || x === null)) continue
    out[k] = x
  }
  // 훈음의 마지막 낱말이 한국 한자음이다 (예: "먹을 식" → 식)
  if (track === 'kanji' && typeof out.hunum_ko === 'string') {
    const eum = out.hunum_ko.split(' ').pop()
    if (eum && /^[가-힣]$/.test(eum)) out.eum_ko = eum
  }
  return out
}

const KANJI_RE = /^\p{Script=Han}$/u
const ON_RE = /^[\p{Script=Katakana}ー]+$/u
const KUN_RE = /^[\p{Script=Hiragana}ー.\-]+$/u
const WORD_RE = /^[A-Za-z][A-Za-z'’ .\-]*$/

/** 만들기에서만 하는 검사 (core validateNote 에 더해). 문제점 목록. */
const uploadChecks = (track: UploadTrack, f: Record<string, unknown>): string[] => {
  const errs: string[] = []
  const { required, optional } = UPLOAD_FIELDS[track]
  for (const k of Object.keys(f)) {
    if (k === 'eum_ko' && track === 'kanji') continue
    if (!required.includes(k) && !optional.includes(k)) errs.push(`만들기에서 쓸 수 없는 필드: fields.${k}`)
  }
  for (const k of required) if (!(k in f)) errs.push(`fields.${k} 가 없습니다`)
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === 'string' && v.length > STR_MAX) errs.push(`fields.${k}: ${STR_MAX}자 이하여야 합니다`)
    if (Array.isArray(v)) {
      if (v.length > ARR_MAX) errs.push(`fields.${k}: ${ARR_MAX}개 이하여야 합니다`)
      if (v.some(e => typeof e === 'string' && e.length > STR_MAX)) errs.push(`fields.${k}: 항목은 ${STR_MAX}자 이하여야 합니다`)
    }
  }
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : [])
  if (track === 'kanji') {
    if (typeof f.kanji === 'string' && f.kanji !== '' && !KANJI_RE.test(f.kanji)) errs.push('fields.kanji: 한자 한 글자여야 합니다')
    if (arr(f.on).some(x => !ON_RE.test(x))) errs.push('fields.on: 음독은 가타카나로 적어 주세요')
    if (arr(f.kun).some(x => !KUN_RE.test(x))) errs.push('fields.kun: 훈독은 히라가나로 적어 주세요')
    if (Array.isArray(f.on) && Array.isArray(f.kun) && f.on.length + f.kun.length === 0) {
      errs.push('음독 · 훈독 중 하나는 있어야 합니다')
    }
    if (Array.isArray(f.meanings_ko) && f.meanings_ko.length === 0) errs.push('fields.meanings_ko: 뜻을 하나 이상 적어 주세요')
  } else {
    if (typeof f.word === 'string' && f.word !== '' && !WORD_RE.test(f.word)) errs.push('fields.word: 영어 단어여야 합니다')
    if (typeof f.word === 'string' && typeof f.example_en === 'string' && f.word !== '') {
      if (!f.example_en.toLowerCase().includes(f.word.toLowerCase())) errs.push('fields.example_en: 예문에 단어가 들어 있어야 합니다')
    }
  }
  return errs
}

export interface UploadedNote {
  id: string
  track: Track
  fields: Record<string, unknown>
  status: NoteStatus
  createdAt: number
  updatedAt: number
}

export type CreateResult =
  | { ok: true; note: UploadedNote }
  | { ok: false; status: 400 | 409 | 429; error: string; errors?: string[] }

/** 하루 만들기 수 (사용자 시간대 04:00 기준) */
export const uploadsToday = (db: DatabaseSync, userId: number, now: number): number =>
  (
    db
      .prepare('SELECT count(*) AS n FROM notes WHERE source = ? AND created_at >= ?')
      .get(uploadSource(userId), dayStart(now, userTz(db, userId))) as { n: number }
  ).n

export const createUpload = (db: DatabaseSync, userId: number, track: unknown, rawFields: unknown, now: number): CreateResult => {
  if (!isUploadTrack(track)) return { ok: false, status: 400, error: `track 은 ${UPLOAD_TRACKS.join(' | ')} 중 하나여야 합니다` }
  if (typeof rawFields !== 'object' || rawFields === null || Array.isArray(rawFields)) {
    return { ok: false, status: 400, error: 'fields 는 객체여야 합니다' }
  }
  if (uploadsToday(db, userId, now) >= UPLOAD_PER_DAY) {
    return { ok: false, status: 429, error: `하루에 ${UPLOAD_PER_DAY}개까지 만들 수 있습니다. 내일 다시 해 주세요` }
  }
  const fields = normalize(track, rawFields as Record<string, unknown>)
  const id = uploadNoteId(track, fields)
  const note = { id, track, fields }
  const errs = [...new Set([...validateNote(note), ...uploadChecks(track, fields)])]
  if (errs.length) return { ok: false, status: 400, error: errs.join('\n'), errors: errs }

  const exists = db.prepare('SELECT status FROM notes WHERE id = ?').get(id) as { status: string } | undefined
  if (exists) return { ok: false, status: 409, error: '이미 있는 문제입니다' }

  const json = canonicalJson(fields)
  db.exec('BEGIN')
  try {
    db.prepare(
      "INSERT INTO notes(id, track, fields, status, source, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)",
    ).run(id, track, json, uploadSource(userId), now, now)
    db.prepare(
      "INSERT INTO note_revisions(note_id, fields, status, edited_by, reason, created_at) VALUES (?, ?, 'draft', ?, 'upload', ?)",
    ).run(id, json, userId, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { ok: true, note: { id, track, fields: JSON.parse(json), status: 'draft', createdAt: now, updatedAt: now } }
}

interface NoteRow {
  id: string
  track: Track
  fields: string
  status: NoteStatus
  createdAt: number
  updatedAt: number
}

const toUploaded = ({ fields, ...r }: NoteRow): UploadedNote => ({ ...r, fields: JSON.parse(fields) })

/** 내가 만든 문제 (최근 것부터) */
export const myUploads = (db: DatabaseSync, userId: number): UploadedNote[] =>
  (
    db
      .prepare(
        `SELECT id, track, fields, status, created_at AS createdAt, updated_at AS updatedAt
           FROM notes WHERE source = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(uploadSource(userId), LIST_MAX) as unknown as NoteRow[]
  ).map(toUploaded)

export interface Draft {
  id: string
  track: Track
  fields: Record<string, unknown>
  createdAt: number
  /** 만든 사람의 보이는 이름 (사용자가 지워졌으면 null) */
  uploader: string | null
  uploaderId: number | null
}

/** 검토 대기 (사용자가 만든 초안, 최근 것부터) */
export const listDrafts = (db: DatabaseSync): Draft[] =>
  (
    db
      .prepare(
        `SELECT n.id, n.track, n.fields, n.created_at AS createdAt, coalesce(u.display_name, u.name) AS uploader, u.id AS uploaderId
           FROM notes n
           LEFT JOIN users u ON n.source = 'upload:' || u.id
          WHERE n.status = 'draft' AND n.source LIKE 'upload:%'
          ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
      )
      .all(LIST_MAX) as unknown as (Omit<Draft, 'fields'> & { fields: string })[]
  ).map(({ fields, ...r }) => ({ ...r, fields: JSON.parse(fields) }))

/** 초안을 공개(published) 또는 반려(retired)한다. 사용자가 만든 초안이 아니면 false. */
export const reviewDraft = (
  db: DatabaseSync,
  id: string,
  action: 'publish' | 'reject',
  adminId: number,
  now: number,
): boolean => {
  const next: NoteStatus = action === 'publish' ? 'published' : 'retired'
  db.exec('BEGIN')
  try {
    const changed = db
      .prepare("UPDATE notes SET status = ?, updated_at = ? WHERE id = ? AND status = 'draft' AND source LIKE 'upload:%'")
      .run(next, now, id).changes
    if (Number(changed) !== 1) {
      db.exec('ROLLBACK')
      return false
    }
    db.prepare(
      'INSERT INTO note_revisions(note_id, fields, status, edited_by, reason, created_at) SELECT id, fields, status, ?, ?, ? FROM notes WHERE id = ?',
    ).run(adminId, action, now, id)
    db.exec('COMMIT')
    return true
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
