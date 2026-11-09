import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureDataDirs, loadConfig } from '../src/config.ts'
import { exportContent, importNotes, loadContentFiles } from '../src/content.ts'
import { openDb } from '../src/db.ts'

const KANA = join(import.meta.dirname, '../../../content/kana.json')

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nakamura-content-'))
  const cfg = loadConfig({ DATA_DIR: join(dir, 'data'), WEB_DIST: join(dir, 'web') })
  ensureDataDirs(cfg)
  return { dir, db: openDb(cfg.dbPath) }
}

const count = (db: ReturnType<typeof openDb>, table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('import-content', () => {
  it('kana.json 을 넣고, 다시 넣으면 바뀌는 것이 없다', () => {
    const { db } = setup()
    expect(importNotes(db, loadContentFiles([KANA]))).toEqual({ added: 208, updated: 0, unchanged: 0 })
    expect(count(db, 'notes')).toBe(208)
    expect(count(db, 'note_revisions')).toBe(208)
    const row = db.prepare("SELECT status, source FROM notes WHERE id = 'kana-hira-ka'").get()
    expect(row).toEqual({ status: 'published', source: 'import:kana.json' })

    expect(importNotes(db, loadContentFiles([KANA]))).toEqual({ added: 0, updated: 0, unchanged: 208 })
    expect(count(db, 'note_revisions')).toBe(208)
  })

  it('--status 없이 다시 넣어도 퇴출한 노트를 되살리지 않는다', () => {
    const { db } = setup()
    importNotes(db, loadContentFiles([KANA]))
    db.prepare("UPDATE notes SET status = 'retired' WHERE id = 'kana-hira-ka'").run()
    expect(importNotes(db, loadContentFiles([KANA]))).toEqual({ added: 0, updated: 0, unchanged: 208 })
    expect(db.prepare("SELECT status FROM notes WHERE id = 'kana-hira-ka'").get()).toEqual({ status: 'retired' })
    // 명시하면 바꾼다
    importNotes(db, loadContentFiles([KANA]), { status: 'published' })
    expect(db.prepare("SELECT status FROM notes WHERE id = 'kana-hira-ka'").get()).toEqual({ status: 'published' })
  })

  it('바뀐 노트는 갱신하고 이력을 남긴다', () => {
    const { db, dir } = setup()
    importNotes(db, loadContentFiles([KANA]))
    const notes = JSON.parse(readFileSync(KANA, 'utf8'))
    notes[0].fields.hint = '모음'
    const file = join(dir, 'kana.json')
    writeFileSync(file, JSON.stringify(notes))
    expect(importNotes(db, loadContentFiles([file]))).toEqual({ added: 0, updated: 1, unchanged: 207 })
    const revs = db.prepare('SELECT fields, reason FROM note_revisions WHERE note_id = ? ORDER BY id').all(notes[0].id) as {
      fields: string
      reason: string
    }[]
    expect(revs).toHaveLength(2)
    expect(JSON.parse(revs[1]!.fields).hint).toBe('모음')
    expect(revs[1]!.reason).toBe('import')
  })

  it('dry-run 은 세기만 한다', () => {
    const { db } = setup()
    expect(importNotes(db, loadContentFiles([KANA]), { dryRun: true })).toEqual({ added: 208, updated: 0, unchanged: 0 })
    expect(count(db, 'notes')).toBe(0)
    expect(count(db, 'note_revisions')).toBe(0)
  })

  it('잘못된 노트가 하나라도 있으면 아무것도 쓰지 않는다', () => {
    const { dir } = setup()
    const notes = JSON.parse(readFileSync(KANA, 'utf8'))
    notes[5].fields.romaji = ''
    notes.push({ ...notes[0] }) // id 중복
    const file = join(dir, 'bad.json')
    writeFileSync(file, JSON.stringify(notes))
    expect(() => loadContentFiles([file])).toThrow(/검사 실패 2건/)
  })
})

describe('export-content', () => {
  it('kana.json 과 바이트 단위로 같고, 같으면 다시 쓰지 않는다', () => {
    const { db, dir } = setup()
    importNotes(db, loadContentFiles([KANA]))
    const out = join(dir, 'out')
    const res = exportContent(db, out)
    expect(res).toEqual([{ track: 'kana', file: join(out, 'kana.json'), count: 208, written: true }])
    expect(readFileSync(join(out, 'kana.json'))).toEqual(readFileSync(KANA))
    const mtime = statSync(join(out, 'kana.json')).mtimeMs
    expect(exportContent(db, out)[0]!.written).toBe(false)
    expect(statSync(join(out, 'kana.json')).mtimeMs).toBe(mtime)
  })

  it('초안은 내보내지 않고, 공개 노트가 없는 트랙은 건드리지 않는다', () => {
    const { db, dir } = setup()
    const draft = join(dir, 'toeic.json')
    writeFileSync(draft, JSON.stringify([{ id: 'toeic-invoice', track: 'toeic', fields: { word: 'invoice', meaning_ko: '송장' } }]))
    importNotes(db, loadContentFiles([draft]), { status: 'draft' })
    importNotes(db, loadContentFiles([KANA]))
    db.prepare("UPDATE notes SET status = 'draft' WHERE id = 'kana-hira-ka'").run()
    const out = join(dir, 'out')
    expect(exportContent(db, out).map(r => r.track)).toEqual(['kana'])
    expect(existsSync(join(out, 'toeic.json'))).toBe(false)
    const ids = (JSON.parse(readFileSync(join(out, 'kana.json'), 'utf8')) as { id: string }[]).map(n => n.id)
    expect(ids).toHaveLength(207)
    expect(ids).not.toContain('kana-hira-ka')
  })
})
