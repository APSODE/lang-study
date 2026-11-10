// 노트 조회 · 친구 문제 만들기 (로그인 필요).
//   GET  /notes?track=kana   { notes: { id, fields }[] } 공개 노트 (학습 순서). 가나 표 같은 화면이 쓴다.
//   POST /notes              { track: 'kanji' | 'toeic', fields } → 201 UploadedNote (status draft, 관리자가 공개하면 학습에 들어간다)
//                            400 { error, errors: string[] } 검사 실패 · 409 같은 id 의 노트가 이미 있음 · 429 하루 제한(20개, 04:00 기준)
//   GET  /notes/mine         { notes: UploadedNote[] } 내가 만든 문제 (최근 것부터, 상태 포함)
// UploadedNote = { id, track, fields, status: 'draft' | 'published' | 'retired', createdAt, updatedAt }. 규칙은 uploads.ts.
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { isTrack } from '@nakamura/core'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { publishedCatalog } from '../study/catalog.ts'
import { createUpload, myUploads } from '../uploads.ts'
import { readBody } from './auth.ts'

export const noteRoutes = (db: DatabaseSync, opts: { now?: () => number } = {}) => {
  const now = opts.now ?? Date.now
  const r = new Hono<AppEnv>()
  r.use('/notes', requireUser)
  r.use('/notes/*', requireUser)
  r.get('/notes', c => {
    const track = c.req.query('track')
    if (!isTrack(track)) return c.json({ error: '알 수 없는 트랙입니다' }, 400)
    return c.json({ notes: publishedCatalog(db, track).notes.map(({ note }) => ({ id: note.id, fields: note.fields })) })
  })

  r.post('/notes', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '요청 형식이 올바르지 않습니다' }, 400)
    const res = createUpload(db, c.get('user')!.id, body.track, body.fields, now())
    if (!res.ok) return c.json({ error: res.error, ...(res.errors ? { errors: res.errors } : {}) }, res.status)
    return c.json(res.note, 201)
  })

  r.get('/notes/mine', c => c.json({ notes: myUploads(db, c.get('user')!.id) }))
  return r
}
