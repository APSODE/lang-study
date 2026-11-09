// 통계 · 같이 쓰는 기능 · 내 정보 · 관리자 테스트가 같이 쓰는 준비 코드.
// study.test.ts 의 setup 과 같은 방식: 임시 DATA_DIR, 가나 콘텐츠, 바꿀 수 있는 시계.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { KanaFields, Note } from '@nakamura/core'
import { createApp } from '../src/app.ts'
import { hashPassword } from '../src/auth/password.ts'
import { insertUser } from '../src/auth/users.ts'
import { ensureDataDirs, loadConfig } from '../src/config.ts'
import { importNotes, loadContentFiles } from '../src/content.ts'
import { openDb } from '../src/db.ts'

export const KANA = join(import.meta.dirname, '../../../content/kana.json')
export const HOUR = 3600 * 1000
export const DAY = 24 * HOUR
/** 서울 벽시계 → ms */
export const kst = (iso: string) => Date.parse(`${iso}+09:00`)
/** 2026-11-09 은 월요일 */
export const T0 = kst('2026-11-09T10:00:00')
export const PASSWORD = 'password1'

let hashed: Promise<string> | undefined
const passwordHash = () => (hashed ??= hashPassword(PASSWORD))

export const setup = (opts: { kana?: boolean; extra?: Note[] } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'nakamura-social-'))
  const cfg = loadConfig({ DATA_DIR: join(dir, 'data'), WEB_DIST: join(dir, 'web') })
  ensureDataDirs(cfg)
  const db = openDb(cfg.dbPath)
  if (opts.kana !== false) importNotes(db, loadContentFiles([KANA]))
  if (opts.extra) importNotes(db, opts.extra.map(note => ({ note, source: 'test' })))
  const clock = { now: T0 }
  const app = createApp(cfg, db, { now: () => clock.now })

  const req = (method: string, path: string, body?: unknown, cookie?: string) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  /** 로그인해서 쿠키를 얻는다 */
  const signIn = async (name: string, password = PASSWORD) => {
    const res = await req('POST', '/auth/login', { name, password })
    if (res.status !== 200) throw new Error(`로그인 실패 ${res.status}`)
    return res.headers
      .getSetCookie()
      .find(s => s.startsWith('nk_session='))!
      .split(';')[0]!
  }

  const as = (cookie: string, id: number, name: string) => {
    const get = async (path: string): Promise<any> => (await req('GET', path, undefined, cookie)).json()
    const send = (method: string, path: string, body: unknown) => req(method, path, body, cookie)
    const answer = (cardId: string, response: string) => send('POST', '/study/answer', { cardId, response })
    return { id, name, cookie, get, send, answer }
  }

  /** 사용자를 만들고 로그인한다 */
  const user = async (name: string, o: { admin?: boolean; hidden?: boolean; tz?: string } = {}) => {
    const id = insertUser(db, name, await passwordHash(), o.admin ?? false)
    if (o.hidden) db.prepare('UPDATE users SET show_progress = 0 WHERE id = ?').run(id)
    if (o.tz) db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(o.tz, id)
    return as(await signIn(name), id, name)
  }

  return { cfg, db, clock, req, signIn, as, user }
}

/** 카드의 정답 (가나 테스트용) */
export const right = (db: DatabaseSync, cardId: string): string => {
  const [noteId, drillId] = cardId.split(':') as [string, string]
  const f = JSON.parse((db.prepare('SELECT fields FROM notes WHERE id = ?').get(noteId) as { fields: string }).fields)
  if (drillId === 'kana-to-romaji') return (f as KanaFields).romaji
  return (f as KanaFields).char
}

/** 복습 기록을 직접 넣는다 (리더보드 · 연속 학습일 테스트용, 카드 상태는 건드리지 않는다) */
export const log = (db: DatabaseSync, userId: number, at: number, correct = true, cardId = 'kana-hira-a:kana-to-romaji') =>
  db
    .prepare('INSERT INTO review_logs(user_id, card_id, rating, correct, response, duration_ms, reviewed_at) VALUES (?, ?, ?, ?, ?, NULL, ?)')
    .run(userId, cardId, correct ? 3 : 1, correct ? 1 : 0, '', at)
