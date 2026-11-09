// 공개 노트 조회 (로그인 필요). 가나 표 같은 화면이 쓴다.
//   GET /notes?track=kana   { notes: { id, fields }[] } (학습 순서)
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { isTrack } from '@nakamura/core'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { publishedCatalog } from '../study/catalog.ts'

export const noteRoutes = (db: DatabaseSync) => {
  const r = new Hono<AppEnv>()
  r.use('/notes', requireUser)
  r.get('/notes', c => {
    const track = c.req.query('track')
    if (!isTrack(track)) return c.json({ error: '알 수 없는 트랙입니다' }, 400)
    return c.json({ notes: publishedCatalog(db, track).notes.map(({ note }) => ({ id: note.id, fields: note.fields })) })
  })
  return r
}
