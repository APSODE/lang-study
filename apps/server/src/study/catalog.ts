// 학습 키(고정 트랙 또는 항목 'deck:<키>')별 공개 노트 목록 (학습 순서로 정렬, 연습 방식까지 계산해 둔다).
// 큐 · 요약 · 보기 만들기가 요청마다 쓰므로 DB 별로 캐시하고, 공개 노트의 개수 · 수정 시각이 바뀌면 다시 읽는다.
import type { DatabaseSync } from 'node:sqlite'
import {
  deckKeyOfNoteId,
  deckKeyOfStudyKey,
  drillsFor,
  isDeckStudyKey,
  type Drill,
  type KanaFields,
  type KanjiFields,
  type Note,
  type StudyKey,
  type Track,
} from '@nakamura/core'
import { uploaderIdOf } from '../authors.ts'

export interface CatalogNote {
  note: Note
  /** 이 노트로 만들 수 있는 연습 방식 (레지스트리 순서. 첫 번째가 처음 소개하는 연습 방식) */
  drills: Drill[]
  /** 친구가 만든 노트면 만든 사람의 사용자 id */
  uploaderId: number | null
}

export interface Catalog {
  /** 학습 순서 */
  notes: CatalogNote[]
  byId: Map<string, CatalogNote>
}

/**
 * 새 카드 순서.
 * 가나: 히라가나를 모두 배운 뒤 가타카나 (섞으면 초보자가 헷갈린다) → 50음도 자리(order) → id.
 * 한자: JLPT 쉬운 레벨(N5) 먼저 → 자주 쓰는 순(freq) → id. 다른 트랙: id 순.
 * 항목: 만든 순서 (파일의 카드 순서).
 */
const MAX = Number.MAX_SAFE_INTEGER
const compare = (track: Track) => (a: Note, b: Note): number => {
  if (track === 'kana') {
    const fa = a.fields as KanaFields
    const fb = b.fields as KanaFields
    const sa = fa.script === 'hiragana' ? 0 : 1
    const sb = fb.script === 'hiragana' ? 0 : 1
    if (sa !== sb) return sa - sb
    const oa = fa.order ?? MAX
    const ob = fb.order ?? MAX
    if (oa !== ob) return oa - ob
  }
  if (track === 'kanji') {
    const fa = a.fields as KanjiFields
    const fb = b.fields as KanjiFields
    const ja = fa.jlpt ?? 0
    const jb = fb.jlpt ?? 0
    if (ja !== jb) return jb - ja
    const qa = fa.freq ?? MAX
    const qb = fb.freq ?? MAX
    if (qa !== qb) return qa - qb
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 학습 키 → SQL 조건. 항목은 id 범위(deck-<키>- 로 시작)로 고른다 ('.' 은 '-' 바로 다음 글자) */
const keyWhere = (key: StudyKey): { sql: string; params: string[] } => {
  if (isDeckStudyKey(key)) {
    const prefix = `deck-${deckKeyOfStudyKey(key)}-`
    return { sql: "track = 'deck' AND id >= ? AND id < ?", params: [prefix, `${prefix.slice(0, -1)}.`] }
  }
  return { sql: 'track = ?', params: [key] }
}

const cache = new WeakMap<DatabaseSync, Map<StudyKey, { key: string; catalog: Catalog }>>()

export const publishedCatalog = (db: DatabaseSync, key: StudyKey): Catalog => {
  const where = keyWhere(key)
  const stamp = db
    .prepare(
      `SELECT count(*) AS n, max(updated_at) AS mx, total(updated_at) AS sm FROM notes WHERE ${where.sql} AND status = 'published'`,
    )
    .get(...where.params) as { n: number; mx: number | null; sm: number }
  const stampKey = `${stamp.n}|${stamp.mx}|${stamp.sm}`
  let perDb = cache.get(db)
  if (!perDb) {
    perDb = new Map()
    cache.set(db, perDb)
  }
  const hit = perDb.get(key)
  if (hit && hit.key === stampKey) return hit.catalog

  const rows = db
    .prepare(
      `SELECT id, track, fields, source FROM notes WHERE ${where.sql} AND status = 'published' ORDER BY created_at, rowid`,
    )
    .all(...where.params) as { id: string; track: Note['track']; fields: string; source: string }[]
  const notes = rows.map(r => ({
    note: { id: r.id, track: r.track, fields: JSON.parse(r.fields) } as Note,
    uploaderId: uploaderIdOf(r.source),
  }))
  if (!isDeckStudyKey(key)) {
    const cmp = compare(key)
    notes.sort((a, b) => cmp(a.note, b.note))
  }
  const list = notes.map(n => ({ ...n, drills: drillsFor(n.note) }))
  const catalog: Catalog = { notes: list, byId: new Map(list.map(c => [c.note.id, c])) }
  perDb.set(key, { key: stampKey, catalog })
  return catalog
}

export interface PublishedDeck {
  /** 항목 키 (학습 키는 deck:<key>) */
  key: string
  /** 항목 이름 (가장 먼저 만든 카드의 이름) */
  name: string
  /** 공개된 카드 수 */
  notes: number
  /** 카드를 만든 사용자 id (먼저 만든 순, 중복 없음) */
  uploaderIds: number[]
  /** 가장 먼저 만든 카드의 시각 */
  createdAt: number
}

/** 공개된 카드가 있는 항목 (만든 순서) */
export const publishedDecks = (db: DatabaseSync): PublishedDeck[] => {
  const rows = db
    .prepare(
      `SELECT id, json_extract(fields, '$.deck') AS name, source, created_at AS createdAt
         FROM notes WHERE track = 'deck' AND status = 'published' ORDER BY created_at, rowid`,
    )
    .all() as { id: string; name: string; source: string; createdAt: number }[]
  const byKey = new Map<string, PublishedDeck>()
  for (const r of rows) {
    const key = deckKeyOfNoteId(r.id)
    if (!key) continue
    const d = byKey.get(key) ?? { key, name: r.name, notes: 0, uploaderIds: [], createdAt: r.createdAt }
    d.notes++
    const uid = uploaderIdOf(r.source)
    if (uid !== null && !d.uploaderIds.includes(uid)) d.uploaderIds.push(uid)
    byKey.set(key, d)
  }
  return [...byKey.values()]
}
