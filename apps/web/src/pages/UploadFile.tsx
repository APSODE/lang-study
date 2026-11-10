// 문제 만들기 · 파일 올리기: JSON 파일 하나로 문제를 여러 개 올린다 (서버 POST notes/file, 규칙은 apps/server/src/uploads.ts).
//   새 항목(덱):  { "deck": "항목 이름", "cards": [{ "front", "back", "note"? }] }  이름이 같은 항목이 있으면 그 항목에 더한다.
//   한자 · 토익 · 토플: { "track": "kanji" | "toeic" | "toefl", "notes": [ 직접 만들기와 같은 칸 ] }
// 파일을 고르면 브라우저에서 읽어 종류 · 개수를 먼저 보여 주고, 올리면 항목마다 결과(만듦 · 오류 · 중복 · 하루 제한)를 보여 준다.
import { type ChangeEvent, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { fmtNum } from '../format.ts'
import { TRACK_LABEL } from '../study.ts'
import type { FileItemResult, FileItemStatus, FileUploadResult } from '../types.ts'

/** 서버와 같은 한도 (uploads.ts FILE_MAX_ITEMS · FILE_PER_DAY, app.ts 파일 크기) */
const FILE_MAX_ITEMS = 200
const FILE_PER_DAY = 200
const FILE_MAX_BYTES = 1024 * 1024

const SAMPLES = [
  {
    key: 'deck',
    title: '새 항목 (앞면 · 뒷면 카드)',
    file: '항목-예시.json',
    data: {
      deck: '일본어 회화 표현',
      cards: [
        { front: '잘 먹겠습니다', back: 'いただきます', note: '식사 전 인사' },
        { front: '잘 먹었습니다', back: 'ごちそうさまでした' },
        { front: '크다', back: '大きい / おおきい' },
      ],
    },
  },
  {
    key: 'kanji',
    title: '한자',
    file: '한자-예시.json',
    data: {
      track: 'kanji',
      notes: [{ kanji: '円', on: ['エン'], kun: ['まる.い'], meanings_ko: ['둥글다', '엔'], hunum_ko: '둥글 원', jlpt: 5 }],
    },
  },
  {
    key: 'toeic',
    title: '토익',
    file: '토익-예시.json',
    data: {
      track: 'toeic',
      notes: [
        {
          word: 'invoice',
          pos: 'n',
          meaning_ko: '송장, 청구서',
          example_en: 'Please send the invoice by Friday.',
          example_ko: '금요일까지 송장을 보내 주세요.',
        },
      ],
    },
  },
  {
    key: 'toefl',
    title: '토플',
    file: '토플-예시.json',
    data: {
      track: 'toefl',
      notes: [
        {
          word: 'hypothesis',
          pos: 'n',
          meaning_ko: '가설',
          example_en: 'The results support the hypothesis.',
          example_ko: '결과가 그 가설을 뒷받침한다.',
        },
      ],
    },
  },
] as const

const sampleHref = (data: unknown) => `data:application/json;charset=utf-8,${encodeURIComponent(`${JSON.stringify(data, null, 2)}\n`)}`

const STATUS_LABEL: Record<FileItemStatus, string> = {
  created: '만듦',
  invalid: '오류',
  duplicate: '중복',
  limit: '하루 제한',
}

interface Preview {
  /** '항목 「이름」' · '한자' · '토익' · '토플' */
  title: string
  count: number
  /** 앞쪽 몇 개의 대표 글자 */
  heads: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 파일 내용 → 미리보기. 형식이 틀리면 안내 문구 */
const describe = (data: unknown): Preview | string => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return '파일은 { "deck", "cards" } 또는 { "track", "notes" } 객체여야 해요.'
  }
  const o = data as Record<string, unknown>
  let title: string
  let list: unknown
  let head: (x: Record<string, unknown>) => string
  if ('deck' in o || 'cards' in o) {
    if (typeof o.deck !== 'string' || o.deck.trim() === '') return 'deck 에 항목 이름을 적어 주세요.'
    title = `항목 「${o.deck.trim()}」`
    list = o.cards
    head = x => str(x.front)
    if (!Array.isArray(list)) return 'cards 는 카드 배열이어야 해요.'
  } else if ('track' in o || 'notes' in o) {
    if (o.track !== 'kanji' && o.track !== 'toeic' && o.track !== 'toefl') return 'track 은 "kanji" · "toeic" · "toefl" 중 하나여야 해요.'
    title = TRACK_LABEL[o.track]
    list = o.notes
    head = x => str(x.kanji ?? x.word)
    if (!Array.isArray(list)) return 'notes 는 문제 배열이어야 해요.'
  } else {
    return '파일은 { "deck", "cards" } 또는 { "track", "notes" } 형식이어야 해요.'
  }
  const items = list as unknown[]
  if (items.length === 0) return '문제가 하나도 없어요.'
  if (items.length > FILE_MAX_ITEMS) return `파일 하나에 ${FILE_MAX_ITEMS}개까지 올릴 수 있어요 (지금 ${items.length}개). 나눠서 올려 주세요.`
  const heads = items
    .slice(0, 5)
    .map(x => (typeof x === 'object' && x !== null ? head(x as Record<string, unknown>) : ''))
    .filter(Boolean)
  return { title, count: items.length, heads }
}

/** 결과 한 줄 */
const itemLine = (r: FileItemResult, readable: (m: string) => string): string =>
  `${r.no}번${r.label ? ` 「${r.label}」` : ''} · ${STATUS_LABEL[r.status]}${r.errors?.length ? `: ${r.errors.map(readable).join(' / ')}` : ''}`

export function UploadFile({ readable, onUploaded }: { readable: (m: string) => string; onUploaded: () => void }) {
  const [file, setFile] = useState<{ name: string; data: unknown; preview: Preview } | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<FileUploadResult | null>(null)
  const [busy, setBusy] = useState(false)
  /** 파일 입력을 비우려고 key 를 바꾼다 */
  const [inputKey, setInputKey] = useState(0)

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    setFile(null)
    setError('')
    setResult(null)
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > FILE_MAX_BYTES) return setError('파일이 너무 커요 (1MB 까지).')
    let text: string
    try {
      text = await f.text()
    } catch {
      return setError('파일을 읽을 수 없어요.')
    }
    let data: unknown
    try {
      data = JSON.parse(text.replace(/^﻿/, ''))
    } catch (err) {
      return setError(`JSON 형식이 아니에요. 따옴표 · 쉼표 · 괄호를 확인해 주세요. (${(err as Error).message})`)
    }
    const p = describe(data)
    if (typeof p === 'string') return setError(p)
    setFile({ name: f.name, data, preview: p })
  }

  const upload = async () => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await api<FileUploadResult>('notes/file', { method: 'POST', body: file.data })
      setResult(r)
      setFile(null)
      setInputKey(k => k + 1)
      if (r.created > 0) onUploaded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const skipped = result?.results.filter(r => r.status !== 'created') ?? []

  return (
    <div className="form card">
      <p className="muted small">
        JSON 파일 하나로 문제를 여러 개 올려요. 파일 하나에 {FILE_MAX_ITEMS}개, 하루 {FILE_PER_DAY}개까지 (직접 만들기와 따로 세요). 올린 문제는
        관리자가 확인한 뒤 모두의 학습에 들어가요.
      </p>
      <details className="aid">
        <summary className="small muted">파일 형식 · 예시</summary>
        <ul className="small upload-help">
          <li>
            <strong>새 항목</strong>: <code>deck</code> 에 항목 이름(40자까지), <code>cards</code> 에 카드 목록. 카드는 <code>front</code>(앞면) ·{' '}
            <code>back</code>(뒷면) · <code>note</code>(설명, 선택). 앞면을 보고 뒷면을 쓰는 카드가 되고, 항목마다 홈에 따로 나와요. 이름이 같은
            항목이 이미 있으면 거기에 카드가 더해져요. 답이 여러 개면 <code>/</code> 로 나눠 적어요.
          </li>
          <li>
            <strong>한자 · 토익 · 토플</strong>: <code>track</code> 에 <code>"kanji"</code> · <code>"toeic"</code> · <code>"toefl"</code> 중 하나, <code>notes</code> 에 직접 만들기와 같은
            칸. 한자는 <code>kanji</code> · <code>on</code>(가타카나 배열) · <code>kun</code>(히라가나 배열) · <code>meanings_ko</code>(뜻 배열) ·{' '}
            <code>hunum_ko</code>(선택) · <code>jlpt</code>(1–5, 선택), 토익 · 토플은 <code>word</code> · <code>meaning_ko</code> · <code>example_en</code>(단어
            포함) · <code>example_ko</code> · <code>pos</code>(선택).
          </li>
          <li>이미 있는 문제 · 파일 안에서 겹치는 문제는 건너뛰어요. 잘못된 문제만 빠지고 나머지는 올라가니, 고친 뒤 같은 파일을 다시 올려도 돼요.</li>
        </ul>
        {SAMPLES.map(s => (
          <div key={s.key} className="upload-sample">
            <div className="actions">
              <strong className="small">{s.title}</strong>
              <a className="small" href={sampleHref(s.data)} download={s.file}>
                예시 파일 받기
              </a>
            </div>
            <pre className="json-sample">{JSON.stringify(s.data, null, 2)}</pre>
          </div>
        ))}
      </details>

      <label>
        JSON 파일
        <input key={inputKey} type="file" accept=".json,application/json" onChange={e => void pick(e)} />
      </label>

      {file && (
        <div className="notice" role="status">
          <p>
            <strong>{file.preview.title}</strong> · {fmtNum(file.preview.count)}개
          </p>
          {file.preview.heads.length > 0 && (
            <p className="muted small">
              {file.preview.heads.join(' · ')}
              {file.preview.count > file.preview.heads.length ? ' …' : ''}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <p className={result.created > 0 ? 'ok-text' : ''}>
            {result.deck
              ? result.deck.isNew
                ? `새 항목 「${result.deck.name}」에 `
                : `항목 「${result.deck.name}」에 `
              : `${TRACK_LABEL[result.track]} `}
            {fmtNum(result.created)}개 보냈어요.{result.created > 0 ? ' 검토 대기 중입니다.' : ''}
            {skipped.length > 0 && ` 건너뛴 문제 ${fmtNum(skipped.length)}개.`}
          </p>
          {skipped.length > 0 && (
            <ul className="form-errors small">
              {skipped.map(r => (
                <li key={r.no} className={r.status === 'invalid' ? 'error' : undefined}>
                  {itemLine(r, readable)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="actions">
        <button type="button" disabled={!file || busy} onClick={() => void upload()}>
          {busy ? '올리는 중…' : file ? `${fmtNum(file.preview.count)}개 올리기` : '올리기'}
        </button>
      </div>
    </div>
  )
}
