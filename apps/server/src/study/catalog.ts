// 트랙별 공개 노트 목록 (학습 순서로 정렬, 연습 방식까지 계산해 둔다).
// 큐 · 요약 · 보기 만들기가 요청마다 쓰므로 DB 별로 캐시하고, 공개 노트의 개수 · 수정 시각이 바뀌면 다시 읽는다.
import type { DatabaseSync } from 'node:sqlite'
import { drillsFor, type Drill, type KanaFields, type KanjiFields, type Note, type Track } from '@nakamura/core'

export interface CatalogNote {
  note: Note
  /** 이 노트로 만들 수 있는 연습 방식 (레지스트리 순서. 첫 번째가 처음 소개하는 연습 방식) */
  drills: Drill[]
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

const cache = new WeakMap<DatabaseSync, Map<Track, { key: string; catalog: Catalog }>>()

export const publishedCatalog = (db: DatabaseSync, track: Track): Catalog => {
  const stamp = db
    .prepare(
      "SELECT count(*) AS n, max(updated_at) AS mx, total(updated_at) AS sm FROM notes WHERE track = ? AND status = 'published'",
    )
    .get(track) as { n: number; mx: number | null; sm: number }
  const key = `${stamp.n}|${stamp.mx}|${stamp.sm}`
  let perDb = cache.get(db)
  if (!perDb) {
    perDb = new Map()
    cache.set(db, perDb)
  }
  const hit = perDb.get(track)
  if (hit && hit.key === key) return hit.catalog

  const rows = db
    .prepare("SELECT id, fields FROM notes WHERE track = ? AND status = 'published'")
    .all(track) as { id: string; fields: string }[]
  const notes = rows.map(r => ({ id: r.id, track, fields: JSON.parse(r.fields) }) as Note).sort(compare(track))
  const list = notes.map(note => ({ note, drills: drillsFor(note) }))
  const catalog: Catalog = { notes: list, byId: new Map(list.map(c => [c.note.id, c])) }
  perDb.set(track, { key, catalog })
  return catalog
}
