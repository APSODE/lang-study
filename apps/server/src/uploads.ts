// 친구가 만든 문제 (docs/논의_정리.md "친구 문제 만들기" · "파일 올리기").
// - 사용자가 칸을 채워 보내면 초안(status draft, source upload:<user id>)으로 저장하고 수정 이력을 남긴다.
// - 파일 올리기: { track, notes } (한자 · 토익) 또는 { deck, cards } (항목 = 앞면 · 뒷면 카드). 항목마다 검사해
//   통과한 것만 초안으로 넣고 나머지는 항목별 사유(검사 실패 · 중복 · 하루 제한)를 돌려준다. 한 번에 올린 것은 같은 묶음(upload_batch).
// - 관리자가 공개하면 status published 가 되어 catalog 캐시(공개 노트 개수 · 수정 시각)가 바뀌고 모두의 학습에 들어간다.
//   파일로 올린 것은 묶음째 공개 · 반려할 수 있다.
// - 반려하면 retired. 같은 id 의 노트는 상태와 상관없이 다시 만들 수 없다 (같은 파일을 다시 올리면 이미 있는 것은 건너뛴다).
import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { DECK_NAME_MAX, deckKey, deckNoteId, normAnswer, normDeckName, validateNote, type NoteTrack } from '@nakamura/core'
import { uploadSource } from './authors.ts'
import { canonicalJson, type NoteStatus } from './content.ts'
import { dayStart } from './study/day.ts'
import { userTz } from './study/service.ts'

export { uploadSource }

/** 만들 수 있는 트랙 */
export const UPLOAD_TRACKS = ['kanji', 'toeic'] as const
export type UploadTrack = (typeof UPLOAD_TRACKS)[number]
export const isUploadTrack = (v: unknown): v is UploadTrack => (UPLOAD_TRACKS as readonly unknown[]).includes(v)

/** 한 사람이 하루(04:00 기준)에 직접 만들 수 있는 문제 수 */
export const UPLOAD_PER_DAY = 20
/** 한 사람이 하루(04:00 기준)에 파일로 만들 수 있는 문제 수 (직접 만들기와 따로 센다) */
export const FILE_PER_DAY = 200
/** 파일 하나에 넣을 수 있는 문제 수 */
export const FILE_MAX_ITEMS = 200
const STR_MAX = 300
const ARR_MAX = 20
const LIST_MAX = 200
/** 검토 대기 목록 최대 (파일 몇 개 분량) */
const DRAFT_LIST_MAX = 1000
/** 항목 카드: 앞면 · 뒷면 · 설명 최대 길이 */
const CARD_TEXT_MAX = 300
const CARD_NOTE_MAX = 500

/** 트랙별로 만들기에서 받는 필드 (나머지 필드는 사전 · 가져오기용이라 받지 않는다) */
const UPLOAD_FIELDS: Record<UploadTrack, { required: string[]; optional: string[] }> = {
  kanji: { required: ['kanji', 'on', 'kun', 'meanings_ko'], optional: ['hunum_ko', 'jlpt'] },
  toeic: { required: ['word', 'meaning_ko', 'example_en', 'example_ko'], optional: ['pos'] },
}

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
  track: NoteTrack
  fields: Record<string, unknown>
  status: NoteStatus
  createdAt: number
  updatedAt: number
}

export type CreateResult =
  | { ok: true; note: UploadedNote }
  | { ok: false; status: 400 | 409 | 429; error: string; errors?: string[] }

/** 하루 만들기 수 (사용자 시간대 04:00 기준). 직접 만들기(single)와 파일 올리기(file)는 따로 센다 */
export const uploadsToday = (db: DatabaseSync, userId: number, now: number, kind: 'single' | 'file' = 'single'): number =>
  (
    db
      .prepare(
        `SELECT count(*) AS n FROM notes WHERE source = ? AND created_at >= ? AND upload_batch IS ${kind === 'file' ? 'NOT ' : ''}NULL`,
      )
      .get(uploadSource(userId), dayStart(now, userTz(db, userId))) as { n: number }
  ).n

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 노트의 대표 글자 (한자 · 단어 · 앞면). 결과 · 목록 표시용 */
const labelOf = (fields: Record<string, unknown>): string => {
  const v = fields.kanji ?? fields.word ?? fields.front
  return typeof v === 'string' ? v : ''
}

interface Prepared {
  id: string
  fields: Record<string, unknown>
  label: string
  errors: string[]
}

/** 한자 · 토익 노트 하나: 정리 → id → 검사 */
const prepareTrackNote = (track: UploadTrack, raw: Record<string, unknown>): Prepared => {
  const fields = normalize(track, raw)
  const id = uploadNoteId(track, fields)
  const errors = [...new Set([...validateNote({ id, track, fields }), ...uploadChecks(track, fields)])]
  return { id, fields, label: labelOf(fields), errors }
}

export const createUpload = (db: DatabaseSync, userId: number, track: unknown, rawFields: unknown, now: number): CreateResult => {
  if (!isUploadTrack(track)) return { ok: false, status: 400, error: `track 은 ${UPLOAD_TRACKS.join(' | ')} 중 하나여야 합니다` }
  if (typeof rawFields !== 'object' || rawFields === null || Array.isArray(rawFields)) {
    return { ok: false, status: 400, error: 'fields 는 객체여야 합니다' }
  }
  if (uploadsToday(db, userId, now) >= UPLOAD_PER_DAY) {
    return { ok: false, status: 429, error: `하루에 ${UPLOAD_PER_DAY}개까지 만들 수 있습니다. 내일 다시 해 주세요` }
  }
  const { id, fields, errors: errs } = prepareTrackNote(track, rawFields as Record<string, unknown>)
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

// --- 파일 올리기 ---

/** 항목 카드 하나: { front, back, note? } → 정리 · 검사. deck 은 이미 정리한 항목 이름 */
const prepareDeckCard = (deck: string, raw: Record<string, unknown>): Prepared => {
  const errors: string[] = []
  for (const k of Object.keys(raw)) if (!['front', 'back', 'note'].includes(k)) errors.push(`알 수 없는 칸: fields.${k}`)
  const text = (k: string, max: number, required: boolean): string | undefined => {
    const v = raw[k]
    if (v === undefined || v === null || v === '') {
      if (required) errors.push(`fields.${k} 가 없습니다`)
      return undefined
    }
    if (typeof v !== 'string') {
      errors.push(`fields.${k}: 문자열이어야 합니다`)
      return undefined
    }
    const t = v.normalize('NFC').trim().replace(/\s+/g, ' ')
    if (t === '') {
      if (required) errors.push(`fields.${k} 가 비어 있습니다`)
      return undefined
    }
    if (t.length > max) errors.push(`fields.${k}: ${max}자 이하여야 합니다`)
    return t
  }
  const front = text('front', CARD_TEXT_MAX, true)
  const back = text('back', CARD_TEXT_MAX, true)
  const note = text('note', CARD_NOTE_MAX, false)
  if (front !== undefined && normAnswer(front) === '') errors.push('fields.front: 글자가 있어야 합니다 (문장 부호만으로는 안 됩니다)')
  const fields: Record<string, unknown> = { deck, front, back, ...(note !== undefined ? { note } : {}) }
  const id = front !== undefined ? deckNoteId(deck, front) : ''
  if (errors.length === 0) errors.push(...validateNote({ id, track: 'deck', fields }))
  return { id, fields, label: front ?? '', errors }
}

export type FileItemStatus = 'created' | 'duplicate' | 'invalid' | 'limit'

export interface FileItemResult {
  /** 파일 안 순서 (1부터) */
  no: number
  status: FileItemStatus
  /** 대표 글자 (한자 · 단어 · 앞면). 읽지 못했으면 '' */
  label: string
  /** 노트 id (검사를 통과했을 때) */
  id?: string
  /** 만들지 않은 사유 (검사 실패면 문제 목록) */
  errors?: string[]
}

export interface FileUploadResult {
  /** 이번에 만든 묶음 id. 하나도 만들지 않았으면 null */
  batch: string | null
  track: NoteTrack
  /** 항목 파일: 항목 이름(기존 항목이면 그 이름으로 맞춘다) · 새 항목인지 */
  deck?: { key: string; name: string; isNew: boolean }
  created: number
  results: FileItemResult[]
}

export type FileOutcome = { ok: true; result: FileUploadResult } | { ok: false; status: 400 | 429; error: string }

const FILE_FORMAT = '파일은 { "track": "kanji" | "toeic", "notes": [...] } 또는 { "deck": "항목 이름", "cards": [...] } 형식이어야 합니다'

/** 항목 키가 같은 노트가 있으면 그 항목 이름 (가장 먼저 만든 것) */
const existingDeckName = (db: DatabaseSync, key: string): string | null => {
  const prefix = `deck-${key}-`
  const row = db
    .prepare(
      "SELECT json_extract(fields, '$.deck') AS name FROM notes WHERE track = 'deck' AND id >= ? AND id < ? ORDER BY created_at, rowid LIMIT 1",
    )
    .get(prefix, `deck-${key}.`) as { name: string } | undefined
  return row?.name ?? null
}

/**
 * 파일 하나를 올린다. 파일 형식이 틀리면 400, 오늘 더 만들 수 없으면 429.
 * 항목마다: 검사 실패(invalid) · 파일 안 중복 또는 이미 있는 문제(duplicate) · 하루 제한 초과(limit)는 건너뛰고, 나머지를 초안으로 넣는다.
 */
export const createFromFile = (db: DatabaseSync, userId: number, body: unknown, now: number): FileOutcome => {
  const bad = (error: string): FileOutcome => ({ ok: false, status: 400, error })
  if (!isObj(body)) return bad(FILE_FORMAT)
  const isDeck = 'deck' in body || 'cards' in body
  const isTrackFile = 'track' in body || 'notes' in body
  if (isDeck && isTrackFile) return bad('track · notes 와 deck · cards 는 함께 쓸 수 없습니다')
  if (!isDeck && !isTrackFile) return bad(FILE_FORMAT)
  const allowed = isDeck ? ['deck', 'cards'] : ['track', 'notes']
  const unknown = Object.keys(body).filter(k => !allowed.includes(k))
  if (unknown.length) return bad(`알 수 없는 키: ${unknown.join(', ')}`)

  const listKey = isDeck ? 'cards' : 'notes'
  const items = body[listKey]
  if (!Array.isArray(items) || items.length === 0) return bad(`${listKey} 는 비어 있지 않은 배열이어야 합니다`)
  if (items.length > FILE_MAX_ITEMS) return bad(`파일 하나에 ${FILE_MAX_ITEMS}개까지 올릴 수 있습니다 (지금 ${items.length}개)`)

  let track: NoteTrack
  let deck: FileUploadResult['deck']
  let prepare: (raw: Record<string, unknown>) => Prepared
  if (isDeck) {
    if (typeof body.deck !== 'string') return bad('deck(항목 이름)은 문자열이어야 합니다')
    const name = normDeckName(body.deck)
    if (name === '') return bad('항목 이름(deck)이 비어 있습니다')
    if (name.length > DECK_NAME_MAX) return bad(`항목 이름(deck)은 ${DECK_NAME_MAX}자 이하여야 합니다`)
    const key = deckKey(name)
    const existing = existingDeckName(db, key)
    deck = { key, name: existing ?? name, isNew: existing === null }
    track = 'deck'
    const deckName = deck.name
    prepare = raw => prepareDeckCard(deckName, raw)
  } else {
    if (!isUploadTrack(body.track)) return bad(`track 은 ${UPLOAD_TRACKS.join(' | ')} 중 하나여야 합니다`)
    const t = body.track
    track = t
    prepare = raw => prepareTrackNote(t, raw)
  }

  const room = FILE_PER_DAY - uploadsToday(db, userId, now, 'file')
  if (room <= 0) {
    return { ok: false, status: 429, error: `파일로는 하루에 ${FILE_PER_DAY}개까지 만들 수 있습니다. 내일 다시 해 주세요` }
  }

  const exists = db.prepare('SELECT 1 FROM notes WHERE id = ?')
  const seen = new Map<string, number>()
  const results: FileItemResult[] = []
  const rows: { id: string; json: string }[] = []
  items.forEach((raw: unknown, i) => {
    const no = i + 1
    if (!isObj(raw)) {
      results.push({ no, status: 'invalid', label: '', errors: ['객체({ … })여야 합니다'] })
      return
    }
    const p = prepare(raw)
    if (p.errors.length) {
      results.push({ no, status: 'invalid', label: p.label, errors: p.errors })
      return
    }
    const prev = seen.get(p.id)
    if (prev !== undefined) {
      results.push({ no, status: 'duplicate', label: p.label, id: p.id, errors: [`파일 안의 ${prev}번과 겹칩니다`] })
      return
    }
    seen.set(p.id, no)
    if (exists.get(p.id)) {
      results.push({ no, status: 'duplicate', label: p.label, id: p.id, errors: ['이미 있는 문제입니다'] })
      return
    }
    if (rows.length >= room) {
      results.push({ no, status: 'limit', label: p.label, id: p.id, errors: [`하루 ${FILE_PER_DAY}개를 넘어 건너뛰었습니다`] })
      return
    }
    rows.push({ id: p.id, json: canonicalJson(p.fields) })
    results.push({ no, status: 'created', label: p.label, id: p.id })
  })

  let batch: string | null = null
  if (rows.length) {
    batch = `${now.toString(36)}${randomBytes(4).toString('hex')}`
    const ins = db.prepare(
      "INSERT INTO notes(id, track, fields, status, source, upload_batch, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)",
    )
    const rev = db.prepare(
      "INSERT INTO note_revisions(note_id, fields, status, edited_by, reason, created_at) VALUES (?, ?, 'draft', ?, 'upload', ?)",
    )
    db.exec('BEGIN')
    try {
      for (const r of rows) {
        ins.run(r.id, track, r.json, uploadSource(userId), batch, now, now)
        rev.run(r.id, r.json, userId, now)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return { ok: true, result: { batch, track, ...(deck ? { deck } : {}), created: rows.length, results } }
}

interface NoteRow {
  id: string
  track: NoteTrack
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
  track: NoteTrack
  fields: Record<string, unknown>
  createdAt: number
  /** 만든 사람의 보이는 이름 (사용자가 지워졌으면 null) */
  uploader: string | null
  uploaderId: number | null
  /** 파일로 올렸으면 묶음 id, 직접 만들었으면 null */
  batch: string | null
}

/** 검토 대기 (사용자가 만든 초안, 최근 것부터. 같은 묶음은 파일 순서) */
export const listDrafts = (db: DatabaseSync): Draft[] =>
  (
    db
      .prepare(
        `SELECT n.id, n.track, n.fields, n.created_at AS createdAt, coalesce(u.display_name, u.name) AS uploader, u.id AS uploaderId,
                n.upload_batch AS batch
           FROM notes n
           LEFT JOIN users u ON n.source = 'upload:' || u.id
          WHERE n.status = 'draft' AND n.source LIKE 'upload:%'
          ORDER BY n.created_at DESC, n.upload_batch, n.rowid LIMIT ?`,
      )
      .all(DRAFT_LIST_MAX) as unknown as (Omit<Draft, 'fields'> & { fields: string })[]
  ).map(({ fields, ...r }) => ({ ...r, fields: JSON.parse(fields) }))

export interface DraftBatch {
  id: string
  track: NoteTrack
  /** 항목 파일이면 항목 이름 */
  deck: string | null
  /** 아직 검토 대기인 문제 수 */
  count: number
  createdAt: number
  uploader: string | null
  uploaderId: number | null
}

/** 검토 대기 중인 문제가 남은 파일 묶음 (최근 것부터) */
export const listDraftBatches = (db: DatabaseSync): DraftBatch[] =>
  db
    .prepare(
      `SELECT n.upload_batch AS id, max(n.track) AS track, max(json_extract(n.fields, '$.deck')) AS deck, count(*) AS count,
              min(n.created_at) AS createdAt, max(coalesce(u.display_name, u.name)) AS uploader, max(u.id) AS uploaderId
         FROM notes n
         LEFT JOIN users u ON n.source = 'upload:' || u.id
        WHERE n.status = 'draft' AND n.source LIKE 'upload:%' AND n.upload_batch IS NOT NULL
        GROUP BY n.upload_batch
        ORDER BY createdAt DESC, id DESC`,
    )
    .all() as unknown as DraftBatch[]

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

/** 파일 묶음에서 아직 검토 대기인 초안을 모두 공개 또는 반려한다. 바꾼 수 (0 이면 그런 묶음이 없다). */
export const reviewBatch = (
  db: DatabaseSync,
  batch: string,
  action: 'publish' | 'reject',
  adminId: number,
  now: number,
): number => {
  const next: NoteStatus = action === 'publish' ? 'published' : 'retired'
  db.exec('BEGIN')
  try {
    const ids = (
      db
        .prepare("SELECT id FROM notes WHERE upload_batch = ? AND status = 'draft' AND source LIKE 'upload:%' ORDER BY rowid")
        .all(batch) as { id: string }[]
    ).map(r => r.id)
    const upd = db.prepare('UPDATE notes SET status = ?, updated_at = ? WHERE id = ?')
    const rev = db.prepare(
      'INSERT INTO note_revisions(note_id, fields, status, edited_by, reason, created_at) SELECT id, fields, status, ?, ?, ? FROM notes WHERE id = ?',
    )
    for (const id of ids) {
      upd.run(next, now, id)
      rev.run(adminId, action, now, id)
    }
    db.exec('COMMIT')
    return ids.length
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
