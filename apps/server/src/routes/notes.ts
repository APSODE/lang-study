// 노트 조회 · 친구 문제 만들기 (로그인 필요).
//   GET  /notes?track=kana   { notes: { id, fields }[] } 공개 노트 (학습 순서). 가나 표 같은 화면이 쓴다.
//   POST /notes              { track: 'kanji' | 'toeic', fields } → 201 UploadedNote (status draft, 관리자가 공개하면 학습에 들어간다)
//                            400 { error, errors: string[] } 검사 실패 · 409 같은 id 의 노트가 이미 있음 · 429 하루 제한(20개, 04:00 기준)
//   POST /notes/file         파일 올리기. 본문 = 파일 내용 그대로:
//                              { track: 'kanji' | 'toeic', notes: fields[] }   (fields 는 POST /notes 와 같다)
//                              { deck: '항목 이름', cards: { front, back, note? }[] }
//                            → 200 { batch, track, deck?: { key, name, isNew }, created, results: { no, status, label, id?, errors? }[] }
//                              status: created(초안으로 만듦) · invalid(검사 실패) · duplicate(파일 안 중복 · 이미 있음) · limit(하루 제한 넘음)
//                            400 { error } 파일 형식 · 항목 이름 · 개수(파일 하나 200개) 문제 · 429 오늘 파일로 더 만들 수 없음(하루 200개)
//   GET  /notes/mine         { notes: UploadedNote[] } 내가 만든 문제 (최근 것부터 200개, 상태 포함)
//   GET  /notes/mine/summary { draft, published, retired, today: { single, singleMax, file, fileMax } }
//                            내가 만든 문제의 상태별 개수(전체) · 오늘(04:00 기준) 만든 수와 하루 제한 (직접 20 · 파일 200)
// UploadedNote = { id, track, fields, status: 'draft' | 'published' | 'retired', createdAt, updatedAt }. 규칙은 uploads.ts.
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { isTrack } from '@nakamura/core'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { publishedCatalog } from '../study/catalog.ts'
import { createFromFile, createUpload, myUploadSummary, myUploads } from '../uploads.ts'
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

  r.post('/notes/file', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '파일은 { … } 객체 하나여야 합니다' }, 400)
    const res = createFromFile(db, c.get('user')!.id, body, now())
    if (!res.ok) return c.json({ error: res.error }, res.status)
    return c.json(res.result)
  })

  r.get('/notes/mine', c => c.json({ notes: myUploads(db, c.get('user')!.id) }))
  r.get('/notes/mine/summary', c => c.json(myUploadSummary(db, c.get('user')!.id, now())))
  return r
}
