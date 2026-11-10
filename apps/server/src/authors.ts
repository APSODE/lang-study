// 만든 사람: 친구가 만든 노트는 notes.source = 'upload:<user id>'. 보이는 이름은 닉네임 ?? 로그인 이름.
import type { DatabaseSync } from 'node:sqlite'

export const uploadSource = (userId: number) => `upload:${userId}`

/** source 가 'upload:<id>' 면 사용자 id, 아니면 null */
export const uploaderIdOf = (source: string): number | null => {
  const m = /^upload:(\d+)$/.exec(source)
  return m ? Number(m[1]) : null
}

/** 사용자 id → 보이는 이름 (사용자가 몇 명뿐이라 한 번에 읽는다) */
export const displayNames = (db: DatabaseSync): Map<number, string> =>
  new Map(
    (db.prepare('SELECT id, coalesce(display_name, name) AS name FROM users').all() as { id: number; name: string }[]).map(r => [
      r.id,
      r.name,
    ]),
  )
