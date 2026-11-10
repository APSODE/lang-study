// 문제 만들기 (#/create, 아래 탭 "만들기". 예전 #/library/create 도 여기로): 한자 · 토익 문제를 만들어 보내면 관리자가 검토한 뒤 모두의 학습에 들어간다.
// 서버가 검사하고(문제가 있으면 목록을 돌려준다) 초안으로 저장한다. 하루 20개까지. 아래에 내가 만든 문제와 상태.
// #/create?mine=1 (홈의 "올린 문제 현황"에서): 목록을 불러오면 "내가 만든 문제"로 스크롤한다.
// "파일 올리기" 탭: JSON 파일로 새 항목(앞면 · 뒷면 카드)이나 한자 · 토익 문제를 한 번에 올린다 (UploadFile.tsx).
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { EmptyState, LoadError } from '../components/EmptyState.tsx'
import { NotePreview, noteLang, noteMain } from '../components/NotePreview.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtDateTime } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import { type MyNotesResponse, type NoteStatus, UPLOAD_STATUS_LABEL, type UploadedNote } from '../types.ts'
import { UploadFile } from './UploadFile.tsx'

type CreateTrack = 'kanji' | 'toeic'
type CreateMode = 'form' | 'file'

const MODE_ITEMS: { value: CreateMode; label: string }[] = [
  { value: 'form', label: '직접 만들기' },
  { value: 'file', label: '파일 올리기' },
]

const TRACK_ITEMS: { value: CreateTrack; label: string }[] = [
  { value: 'kanji', label: '한자' },
  { value: 'toeic', label: '토익' },
]

/** 상태 배지 색: 관리 · 신고의 열림 / 해결 / 반려와 같은 모양을 쓴다 */
const STATUS_CLASS: Record<NoteStatus, string> = { draft: 'status-open', published: 'status-resolved', retired: 'status-rejected' }

/** 서버 오류의 필드 이름(fields.on 등)을 칸 이름으로 */
const FIELD_LABEL: Record<string, string> = {
  kanji: '한자',
  on: '음독',
  kun: '훈독',
  meanings_ko: '뜻',
  hunum_ko: '훈음',
  jlpt: 'JLPT',
  word: '단어',
  pos: '품사',
  meaning_ko: '뜻',
  example_en: '예문',
  example_ko: '예문 해석',
  deck: '항목 이름',
  front: '앞면',
  back: '뒷면',
  note: '설명',
}
const readable = (msg: string) => msg.replace(/fields\.([a-z_]+)/g, (m, k: string) => FIELD_LABEL[k] ?? m)

/** 쉼표(, 、 ，)로 나눈 목록 */
const splitList = (s: string): string[] =>
  s
    .split(/[,、，]/)
    .map(x => x.trim())
    .filter(Boolean)

const EMPTY_KANJI = { kanji: '', on: '', kun: '', meanings: '', hunum: '', jlpt: '' }
const EMPTY_TOEIC = { word: '', pos: '', meaning: '', exampleEn: '', exampleKo: '' }

export function CreateNote({ showMine = false }: { showMine?: boolean }) {
  const [mode, setMode] = useState<CreateMode>('form')
  const [track, setTrack] = useState<CreateTrack>('kanji')
  const [kanji, setKanji] = useState(EMPTY_KANJI)
  const [toeic, setToeic] = useState(EMPTY_TOEIC)
  const [errors, setErrors] = useState<string[]>([])
  const [sent, setSent] = useState('')
  const [busy, setBusy] = useState(false)
  const mine = useApi<MyNotesResponse>('notes/mine')
  const mineRef = useRef<HTMLHeadingElement>(null)
  const loaded = mine.data !== null
  useEffect(() => {
    if (showMine && loaded) mineRef.current?.scrollIntoView({ block: 'start' })
  }, [showMine, loaded])

  const fields = (): Record<string, unknown> =>
    track === 'kanji'
      ? {
          kanji: kanji.kanji.trim(),
          on: splitList(kanji.on),
          kun: splitList(kanji.kun),
          meanings_ko: splitList(kanji.meanings),
          ...(kanji.hunum.trim() ? { hunum_ko: kanji.hunum.trim() } : {}),
          ...(kanji.jlpt ? { jlpt: Number(kanji.jlpt) } : {}),
        }
      : {
          word: toeic.word.trim(),
          ...(toeic.pos.trim() ? { pos: toeic.pos.trim() } : {}),
          meaning_ko: splitList(toeic.meaning).join(', '),
          example_en: toeic.exampleEn.trim(),
          example_ko: toeic.exampleKo.trim(),
        }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors([])
    setSent('')
    try {
      const note = await api<UploadedNote>('notes', { method: 'POST', body: { track, fields: fields() } })
      setSent(`「${noteMain(note.fields)}」 보냈어요. 검토 대기 중입니다.`)
      if (track === 'kanji') setKanji(EMPTY_KANJI)
      else setToeic(EMPTY_TOEIC)
      const list = mine.data?.notes ?? []
      mine.setData({ notes: [note, ...list] })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      setErrors(msg.split('\n').map(readable))
    } finally {
      setBusy(false)
    }
  }

  const changeTrack = (t: CreateTrack) => {
    setTrack(t)
    setErrors([])
    setSent('')
  }

  return (
    <div className="page create-note">
      <Segmented label="만드는 방법" value={mode} onChange={setMode} items={MODE_ITEMS} />
      {mode === 'file' ? (
        <UploadFile readable={readable} onUploaded={mine.reload} />
      ) : (
        <>
          <p className="muted small">만든 문제는 관리자가 확인한 뒤 모두의 학습에 들어가요. 하루 20개까지 만들 수 있어요.</p>
          <Segmented label="트랙" value={track} onChange={changeTrack} items={TRACK_ITEMS} />

          <form className="form card" onSubmit={e => void submit(e)}>
            {track === 'kanji' ? (
              <>
                <label>
                  한자 (1자)
                  <input
                    lang="ja"
                    value={kanji.kanji}
                    onChange={e => setKanji({ ...kanji, kanji: e.target.value })}
                    placeholder="円"
                    autoComplete="off"
                    required
                  />
                </label>
                <label>
                  음독 (가타카나, 쉼표로 구분)
                  <input lang="ja" value={kanji.on} onChange={e => setKanji({ ...kanji, on: e.target.value })} placeholder="エン" autoComplete="off" />
                </label>
                <label>
                  훈독 (히라가나, 쉼표로 구분)
                  <input lang="ja" value={kanji.kun} onChange={e => setKanji({ ...kanji, kun: e.target.value })} placeholder="まる.い" autoComplete="off" />
                </label>
                <label>
                  뜻 (쉼표로 구분)
                  <input value={kanji.meanings} onChange={e => setKanji({ ...kanji, meanings: e.target.value })} placeholder="둥글다, 엔" required />
                </label>
                <div className="row">
                  <label>
                    훈음 (선택)
                    <input value={kanji.hunum} onChange={e => setKanji({ ...kanji, hunum: e.target.value })} placeholder="둥글 원" />
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
            ) : (
              <>
                <div className="row">
                  <label>
                    단어
                    <input
                      lang="en"
                      value={toeic.word}
                      onChange={e => setToeic({ ...toeic, word: e.target.value })}
                      placeholder="invoice"
                      autoComplete="off"
                      autoCapitalize="none"
                      required
                    />
                  </label>
                  <label>
                    품사 (선택)
                    <input lang="en" value={toeic.pos} onChange={e => setToeic({ ...toeic, pos: e.target.value })} placeholder="n" autoComplete="off" autoCapitalize="none" />
                  </label>
                </div>
                <label>
                  뜻 (쉼표로 구분)
                  <input value={toeic.meaning} onChange={e => setToeic({ ...toeic, meaning: e.target.value })} placeholder="송장, 청구서" required />
                </label>
                <label>
                  예문 (영어, 단어 포함)
                  <textarea
                    lang="en"
                    rows={2}
                    value={toeic.exampleEn}
                    onChange={e => setToeic({ ...toeic, exampleEn: e.target.value })}
                    placeholder="Please send the invoice by Friday."
                    required
                  />
                </label>
                <label>
                  예문 해석
                  <textarea
                    rows={2}
                    value={toeic.exampleKo}
                    onChange={e => setToeic({ ...toeic, exampleKo: e.target.value })}
                    placeholder="금요일까지 송장을 보내 주세요."
                    required
                  />
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
            {sent && (
              <p className="ok-text" role="status">
                {sent}
              </p>
            )}
            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? '보내는 중…' : '보내기'}
              </button>
            </div>
          </form>
        </>
      )}

      <h2 ref={mineRef} className="scroll-target">
        내가 만든 문제
      </h2>
      {mine.data ? (
        mine.data.notes.length === 0 ? (
          <EmptyState title="아직 만든 문제가 없습니다">위에서 첫 문제를 만들어 보세요.</EmptyState>
        ) : (
          <ul className="report-list">
            {mine.data.notes.map(n => (
              <li key={n.id} className="card report">
                <div className="report-head">
                  <span className="badge">{TRACK_LABEL[n.track] ?? n.track}</span>
                  <strong className="report-main" lang={noteLang(n.track, n.fields)}>
                    {noteMain(n.fields) || n.id}
                  </strong>
                  <span className={`status ${STATUS_CLASS[n.status] ?? ''}`}>{UPLOAD_STATUS_LABEL[n.status] ?? n.status}</span>
                </div>
                <NotePreview track={n.track} fields={n.fields} />
                <p className="muted small">{fmtDateTime(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        )
      ) : mine.error ? (
        <LoadError error={mine.error} notReady={mine.notReady} onRetry={mine.reload} />
      ) : (
        <Skeleton lines={3} />
      )}
    </div>
  )
}
