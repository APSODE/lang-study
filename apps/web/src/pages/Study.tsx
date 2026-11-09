// 학습 화면 (#/study/<트랙>). 큐를 받아 한 장씩 낸다.
// 흐름: 답 제출 → 화면에서 core check 로 바로 채점해 ✓/✗ 와 정답을 보여 준다
//   - 맞힘: 어려움 / 좋음 / 쉬움 중 하나를 누르면(Enter = 좋음) 그 평가로 서버에 보낸다.
//   - 틀림: 바로 서버에 보낸다(평가는 서버가 '다시'로 정한다). "다음"(Enter)으로 넘어간다.
// 서버가 같은 check 로 다시 채점하므로 화면의 채점은 빠른 표시용일 뿐이다. 큐를 다 풀면 다시 받아 온다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDrill, type KanaFields, type Note, type ToeicFields, type Track } from '@nakamura/core'
import { api, ApiError } from '../api.ts'
import { Icon } from '../components/Icon.tsx'
import { ProgressBar } from '../components/ProgressBar.tsx'
import { ReportDialog } from '../components/ReportDialog.tsx'
import { DRILL_VIEWS } from '../drills/index.ts'
import { speak } from '../speech.ts'
import { type AnswerResult, type QueueItem, TRACK_LABEL } from '../study.ts'

const BATCH = 20

interface Graded {
  correct: boolean
  expected: string
  response: string
  /** 서버에 기록했는지 */
  sent: boolean
}

/** 답한 뒤 들려줄 텍스트 */
const listenText = (item: QueueItem): [string, 'ja-JP' | 'en-US'] | null => {
  if (item.track === 'kana') return [(item.fields as KanaFields).char, 'ja-JP']
  if (item.track === 'toeic') return [(item.fields as ToeicFields).word, 'en-US']
  return null
}

export function Study({ track }: { track: Track }) {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [graded, setGraded] = useState<Graded | null>(null)
  const [answered, setAnswered] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 건너뛴 카드 안내 (다음 답을 내면 지운다) */
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const [reporting, setReporting] = useState(false)
  const shownAt = useRef(Date.now())
  const durationMs = useRef(0)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const r = await api<{ items: QueueItem[] }>(`study/queue?track=${track}&limit=${BATCH}`)
      setItems(r.items)
      setIdx(0)
      setGraded(null)
      shownAt.current = Date.now()
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [track])

  useEffect(() => {
    void load()
  }, [load])

  const item = items?.[idx]

  const next = () => {
    setGraded(null)
    setError('')
    if (items && idx + 1 < items.length) {
      setIdx(idx + 1)
      shownAt.current = Date.now()
    } else {
      setItems(null)
      void load()
    }
  }

  /** 서버에 기록. 'skip' = 이 카드는 더 할 수 없음(새 카드 한도 · 없어진 카드), null = 다시 시도할 수 있는 실패 */
  const send = async (it: QueueItem, response: string, rating?: 2 | 3 | 4): Promise<AnswerResult | 'skip' | null> => {
    try {
      const r = await api<AnswerResult>('study/answer', {
        method: 'POST',
        body: { cardId: it.cardId, response, durationMs: durationMs.current, rating },
      })
      setAnswered(n => n + 1)
      return r
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        setNotice(err.status === 409 ? '오늘 볼 새 카드를 모두 봤습니다. 그 카드는 건너뜁니다.' : '없어진 카드라 건너뜁니다.')
        return 'skip'
      }
      setError((err as Error).message)
      return null
    }
  }

  const submit = async (response: string) => {
    if (!item || graded || busy) return
    durationMs.current = Date.now() - shownAt.current
    setNotice('')
    const note = { id: item.noteId, track: item.track, fields: item.fields } as Note
    const local = getDrill(item.drillId)?.check(note, response)
    if (local?.correct) {
      setGraded({ correct: true, expected: local.expected, response, sent: false })
      return
    }
    // 틀렸거나 화면에서 채점할 수 없으면 바로 보낸다 (서버 채점이 최종)
    setBusy(true)
    const r = await send(item, response)
    setBusy(false)
    if (r === 'skip') return next()
    setGraded(
      r
        ? { correct: r.correct, expected: r.expected, response, sent: true }
        : { correct: false, expected: local?.expected ?? '', response, sent: false },
    )
  }

  const finish = async (rating?: 2 | 3 | 4) => {
    if (!item || !graded || busy) return
    if (!graded.sent) {
      setBusy(true)
      const r = await send(item, graded.response, graded.correct ? rating : undefined)
      setBusy(false)
      if (r === null) return
    }
    next()
  }

  // 집중 모드 머리글: ✕(홈으로) · 트랙 · 진행 · 신고. 탭 막대 · 사이드바는 App 이 그리지 않는다.
  const header = (
    <header className="focus-bar">
      <a className="icon-btn" href="#/" aria-label="학습 끝내기">
        <Icon name="close" />
      </a>
      <h1 className="focus-title">
        {TRACK_LABEL[track]}
        {items && items[idx] && (
          <span className="muted small">
            {' '}
            {idx + 1} / {items.length}
            {items[idx].isNew && ' · 새 카드'}
          </span>
        )}
      </h1>
      {items && items[idx] ? (
        <button type="button" className="icon-btn" aria-label="문항 신고" title="문항 신고" onClick={() => setReporting(true)}>
          <Icon name="flag" size={22} />
        </button>
      ) : (
        <span className="icon-btn-space" aria-hidden="true" />
      )}
    </header>
  )

  if (loadError) {
    return (
      <main className="study">
        {header}
        <p className="error">{loadError}</p>
        <button type="button" onClick={() => void load()}>
          다시 시도
        </button>
      </main>
    )
  }
  if (items === null) {
    return (
      <main className="study">
        {header}
        <p className="muted">불러오는 중…</p>
      </main>
    )
  }
  if (!item) {
    return (
      <main className="study">
        {header}
        <div className="notice">
          <p>
            <strong>지금 할 카드가 없습니다.</strong>
          </p>
          <p className="muted">{answered > 0 ? `이번에 ${answered}장 답했습니다. 수고했어요!` : '복습할 카드와 오늘의 새 카드를 모두 봤습니다.'}</p>
        </div>
        <div className="actions">
          <a className="button" href="#/">
            홈으로
          </a>
          <button type="button" className="secondary" onClick={() => void load()}>
            다시 확인
          </button>
        </div>
      </main>
    )
  }

  const View = DRILL_VIEWS[item.drillId]
  const listen = listenText(item)

  return (
    <main className="study">
      {header}
      <ProgressBar value={idx / items.length} label={`${items.length}장 중 ${idx}장 완료`} />

      {notice && <p className="muted small">{notice}</p>}
      <section className="card study-card">
        {View ? (
          <View
            key={item.cardId}
            item={item}
            result={graded && { correct: graded.correct, expected: graded.expected, response: graded.response }}
            onSubmit={r => void submit(r)}
          />
        ) : (
          <>
            <p className="muted">이 연습 방식({item.drillId})은 아직 화면이 없습니다.</p>
            <button type="button" onClick={next}>
              건너뛰기
            </button>
          </>
        )}
      </section>

      {graded && (
        <section className={`result ${graded.correct ? 'ok' : 'bad'}`} role="status">
          <p className="verdict">{graded.correct ? '✓ 정답' : '✗ 오답'}</p>
          <p>
            정답: <strong lang={item.track === 'toeic' ? 'en' : 'ja'}>{graded.expected}</strong>
            {!graded.correct && <span className="muted"> · 내 답: {graded.response}</span>}
          </p>
          {listen && (
            <button type="button" className="secondary" onClick={() => speak(listen[0], listen[1])}>
              🔊 듣기
            </button>
          )}
        </section>
      )}
      {error && <p className="error">{error}</p>}

      {graded &&
        (graded.correct && !graded.sent ? (
          <div className="ratings">
            <button type="button" className="secondary" disabled={busy} onClick={() => void finish(2)}>
              어려움
            </button>
            <button type="button" disabled={busy} onClick={() => void finish(3)} autoFocus>
              좋음
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void finish(4)}>
              쉬움
            </button>
          </div>
        ) : (
          <div className="ratings single">
            <button type="button" disabled={busy} onClick={() => void finish()} autoFocus>
              다음
            </button>
          </div>
        ))}

      {reporting && <ReportDialog noteId={item.noteId} cardId={item.cardId} onClose={() => setReporting(false)} />}
    </main>
  )
}
