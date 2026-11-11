// 관리자: 친구가 만든 문제(초안 · 공개된 것)의 칸 고치기 (PATCH admin/notes/:id). 검토 대기 · 신고 화면에서 "수정"을 누르면 열린다.
// 칸 모양은 문제 만들기(CreateNote)와 같다. 대표 칸(한자 · 단어 · 항목 이름 · 앞면)은 노트 id 라 고칠 수 없어 읽기 전용으로 보인다.
// 서버가 만들기와 같은 검사를 하고, 문제가 있으면 목록을 보여 준다. 저장하면 고친 노트를 onSaved 로 넘긴다.
import { type FormEvent, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { readable, splitList } from '../pages/CreateNote.tsx'
import type { NoteTrack } from '@nakamura/core'
import type { UploadedNote } from '../types.ts'

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const list = (v: unknown): string => (Array.isArray(v) ? v.filter(x => typeof x === 'string').join(', ') : str(v))

interface Props {
  id: string
  track: NoteTrack
  fields: Record<string, unknown>
  onSaved: (note: UploadedNote) => void
  onCancel: () => void
}

export function NoteEditForm({ id, track, fields: initial, onSaved, onCancel }: Props) {
  const [kanji, setKanji] = useState({
    on: list(initial.on),
    kun: list(initial.kun),
    meanings: list(initial.meanings_ko),
    hunum: str(initial.hunum_ko),
    jlpt: str(initial.jlpt),
  })
  const [word, setWord] = useState({
    pos: str(initial.pos),
    meaning: str(initial.meaning_ko),
    exampleEn: str(initial.example_en),
    exampleKo: str(initial.example_ko),
  })
  const [card, setCard] = useState({ back: str(initial.back), note: str(initial.note) })
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const fields = (): Record<string, unknown> => {
    if (track === 'kanji') {
      return {
        kanji: initial.kanji,
        on: splitList(kanji.on),
        kun: splitList(kanji.kun),
        meanings_ko: splitList(kanji.meanings),
        ...(kanji.hunum.trim() ? { hunum_ko: kanji.hunum.trim() } : {}),
        ...(kanji.jlpt ? { jlpt: Number(kanji.jlpt) } : {}),
      }
    }
    if (track === 'deck') {
      return { front: initial.front, back: card.back, ...(card.note.trim() ? { note: card.note } : {}) }
    }
    return {
      word: initial.word,
      ...(word.pos.trim() ? { pos: word.pos.trim() } : {}),
      meaning_ko: splitList(word.meaning).join(', '),
      example_en: word.exampleEn.trim(),
      example_ko: word.exampleKo.trim(),
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors([])
    try {
      const note = await api<UploadedNote>(`admin/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { fields: fields() } })
      onSaved(note)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      setErrors(msg.split('\n').map(readable))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={e => void submit(e)}>
      {track === 'kanji' ? (
        <>
          <label>
            한자 (고칠 수 없음)
            <input lang="ja" value={str(initial.kanji)} readOnly disabled />
          </label>
          <label>
            음독 (가타카나, 쉼표로 구분)
            <input lang="ja" value={kanji.on} onChange={e => setKanji({ ...kanji, on: e.target.value })} autoComplete="off" />
          </label>
          <label>
            훈독 (히라가나, 쉼표로 구분)
            <input lang="ja" value={kanji.kun} onChange={e => setKanji({ ...kanji, kun: e.target.value })} autoComplete="off" />
          </label>
          <label>
            뜻 (쉼표로 구분)
            <input value={kanji.meanings} onChange={e => setKanji({ ...kanji, meanings: e.target.value })} required />
          </label>
          <div className="row">
            <label>
              훈음 (선택)
              <input value={kanji.hunum} onChange={e => setKanji({ ...kanji, hunum: e.target.value })} />
            </label>
            <label>
              JLPT (선택)
              <select value={kanji.jlpt} onChange={e => setKanji({ ...kanji, jlpt: e.target.value })}>
                <option value="">없음</option>
                {[5, 4, 3, 2, 1].map(n => (
                  <option key={n} value={n}>
                    N{n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : track === 'deck' ? (
        <>
          <label>
            항목 이름 (고칠 수 없음)
            <input value={str(initial.deck)} readOnly disabled />
          </label>
          <label>
            앞면 (고칠 수 없음)
            <input value={str(initial.front)} readOnly disabled />
          </label>
          <label>
            뒷면
            <textarea rows={2} value={card.back} onChange={e => setCard({ ...card, back: e.target.value })} required />
          </label>
          <label>
            설명 (선택)
            <textarea rows={2} value={card.note} onChange={e => setCard({ ...card, note: e.target.value })} />
          </label>
        </>
      ) : (
        <>
          <div className="row">
            <label>
              단어 (고칠 수 없음)
              <input lang="en" value={str(initial.word)} readOnly disabled />
            </label>
            <label>
              품사 (선택)
              <input lang="en" value={word.pos} onChange={e => setWord({ ...word, pos: e.target.value })} autoComplete="off" autoCapitalize="none" />
            </label>
          </div>
          <label>
            뜻 (쉼표로 구분)
            <input value={word.meaning} onChange={e => setWord({ ...word, meaning: e.target.value })} required />
          </label>
          <label>
            예문 (영어, 단어 포함)
            <textarea lang="en" rows={2} value={word.exampleEn} onChange={e => setWord({ ...word, exampleEn: e.target.value })} required />
          </label>
          <label>
            예문 해석
            <textarea rows={2} value={word.exampleKo} onChange={e => setWord({ ...word, exampleKo: e.target.value })} required />
          </label>
        </>
      )}
      {errors.length > 0 && (
        <ul className="error form-errors" role="alert">
          {errors.map(m => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  )
}
