// 학습 화면 (#/study/<트랙>). 큐를 받아 한 장씩 낸다.
// 흐름: 답 제출 → 화면에서 core check 로 바로 채점해 ✓/✗ 와 정답을 보여 준다
//   - 맞힘: 어려움 / 좋음 / 쉬움 중 하나를 누르면(Enter = 좋음) 그 평가로 서버에 보낸다.
//   - 틀림: 바로 서버에 보낸다(평가는 서버가 '다시'로 정한다). "다음"(Enter)으로 넘어간다.
//   - 자기 평가 연습 방식(일작, core 의 selfGraded)이 틀리면: 아직 보내지 않고 모범 답안을 보여 준다.
//     "틀렸어요" → 그대로 보낸다(다시). "맞았어요" → 어려움 / 좋음 / 쉬움을 고르면 selfCorrect 와 함께 보낸다.
// 서버가 같은 check 로 다시 채점하므로 화면의 채점은 빠른 표시용일 뿐이다. 큐를 다 풀면 다시 받아 온다.
// 한자 카드는 답한 뒤 첫 예시 낱말 · 예문을 도움말로 보여 준다.
// 작문 모드(#/study/<트랙>?mode=write&levels=…&learned=1, write 속성): 같은 화면 · 자기 평가 흐름으로 작문 큐만 푼다.
//   큐를 다 풀면 같은 조건으로 다시 받고, ✕ 는 문제 고르기(#/write/<트랙>)로 돌아간다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDrill, type KanaFields, type KanjiFields, type Note, type ToeicFields, type Track } from '@nakamura/core'
import { api, ApiError } from '../api.ts'
import { Icon } from '../components/Icon.tsx'
import { ExampleSentences, ExampleWords } from '../components/KanjiExamples.tsx'
import { ProgressBar } from '../components/ProgressBar.tsx'
import { ReportDialog } from '../components/ReportDialog.tsx'
import { DRILL_VIEWS } from '../drills/index.ts'
import { speak } from '../speech.ts'
import { type AnswerResult, type QueueItem, TRACK_LABEL, type WriteParams } from '../study.ts'

const BATCH = 20

interface Graded {
  correct: boolean
  expected: string
  response: string
  /** 서버에 기록했는지 */
  sent: boolean
  /** 자기 평가 기다리는 중 (자동 채점은 틀렸고 아직 보내지 않았다) */
  selfPending?: boolean
  /** 사용자가 "맞았어요" 를 골랐다 (보낼 때 selfCorrect: true) */
  selfCorrect?: boolean
}

/** 일작 카드의 예문 (모범 답안 · 가나 · 듣기에 쓴다) */
const writeSentence = (item: QueueItem) =>
  item.drillId === 'kanji-write' ? (item.fields as KanjiFields).sentences?.[0] : undefined

/** 답한 뒤 들려줄 텍스트 */
const listenText = (item: QueueItem): [string, 'ja-JP' | 'en-US'] | null => {
  if (item.track === 'kana') return [(item.fields as KanaFields).char, 'ja-JP']
  if (item.track === 'toeic') return [(item.fields as ToeicFields).word, 'en-US']
  const s = writeSentence(item)
  if (s) return [s.kana, 'ja-JP']
  return null
}

/** 큐 요청 경로 */
const queuePath = (track: Track, write: WriteParams | undefined): string => {
  let p = `study/queue?track=${track}&limit=${BATCH}`
  if (write) {
    p += '&mode=write'
    if (write.levels) p += `&levels=${write.levels.join(',')}`
    if (write.learnedOnly) p += '&learnedOnly=1'
  }
  return p
}

export function Study({ track, write }: { track: Track; write?: WriteParams }) {
  const path = queuePath(track, write)
  const exitHref = write ? `#/write/${track}` : '#/'
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
      const r = await api<{ items: QueueItem[] }>(path)
      setItems(r.items)
      setIdx(0)
      setGraded(null)
      shownAt.current = Date.now()
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [path])

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
  const send = async (
    it: QueueItem,
    response: string,
    rating?: 2 | 3 | 4,
    selfCorrect?: boolean,
  ): Promise<AnswerResult | 'skip' | null> => {
    try {
      const r = await api<AnswerResult>('study/answer', {
        method: 'POST',
        body: { cardId: it.cardId, response, durationMs: durationMs.current, rating, ...(selfCorrect ? { selfCorrect } : {}) },
      })
      setAnswered(n => n + 1)
      return r
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        setNotice(
          err.status === 409
            ? write
              ? '오늘 볼 새 작문 문제를 모두 봤습니다. 그 문제는 건너뜁니다.'
              : '오늘 볼 새 카드를 모두 봤습니다. 그 카드는 건너뜁니다.'
            : '없어진 카드라 건너뜁니다.',
        )
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
    const drill = getDrill(item.drillId)
    const local = drill?.check(note, response)
    if (local?.correct) {
      setGraded({ correct: true, expected: local.expected, response, sent: false })
      return
    }
    // 자기 평가: 모범 답안을 보여 주고 사용자가 고를 때까지 보내지 않는다
    if (local && drill?.selfGraded) {
      setGraded({ correct: false, expected: local.expected, response, sent: false, selfPending: true })
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
      const r = await send(item, graded.response, graded.correct ? rating : undefined, graded.selfCorrect)
      setBusy(false)
      if (r === null) return
    }
    next()
  }

  // 집중 모드 머리글: ✕(홈으로) · 트랙 · 진행 · 신고. 탭 막대 · 사이드바는 App 이 그리지 않는다.
  const header = (
    <header className="focus-bar">
      <a className="icon-btn" href={exitHref} aria-label="학습 끝내기">
        <Icon name="close" />
      </a>
      <h1 className="focus-title">
        {write ? `작문 · ${TRACK_LABEL[track]}` : TRACK_LABEL[track]}
        {items && items[idx] && (
          <span className="muted small">
            {' '}
            {idx + 1} / {items.length}
            {items[idx].isNew && (write ? ' · 새 문제' : ' · 새 카드')}
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
            <strong>{write ? '지금 할 작문 문제가 없습니다.' : '지금 할 카드가 없습니다.'}</strong>
          </p>
          <p className="muted">
            {answered > 0
              ? `이번에 ${answered}${write ? '문제' : '장'} 답했습니다. 수고했어요!`
              : write
                ? '복습할 문제와 고른 조건의 오늘 새 문제를 모두 봤습니다.'
                : '복습할 카드와 오늘의 새 카드를 모두 봤습니다.'}
          </p>
        </div>
        <div className="actions">
          {write && (
            <a className="button" href={exitHref}>
              문제 고르기
            </a>
          )}
          <a className={write ? 'button secondary' : 'button'} href="#/">
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
  const sentence = writeSentence(item)
  const kf = item.track === 'kanji' ? (item.fields as KanjiFields) : null
  const aidWord = kf?.examples?.[0]
  // 일작은 예문 자체가 문제라 예문 도움말은 빼고 낱말만
  const aidSentence = item.drillId === 'kanji-write' ? undefined : kf?.sentences?.[0]
  const verdict = graded?.selfPending
    ? '모범 답안과 비교해 보세요'
    : graded?.correct
      ? graded.selfCorrect
        ? '✓ 맞았어요'
        : '✓ 정답'
      : '✗ 오답'

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
        <section className={`result ${graded.selfPending ? 'self' : graded.correct ? 'ok' : 'bad'}`} role="status">
          <p className="verdict">{verdict}</p>
          {sentence ? (
            <>
              <div className="model-answer">
                <p className="model-ja" lang="ja">
                  {graded.expected}
                </p>
                <p className="muted small" lang="ja">
                  {sentence.kana}
                </p>
              </div>
              {(graded.selfPending || graded.selfCorrect || !graded.correct) && (
                <p className="small">
                  <span className="muted">내 답: </span>
                  <span lang="ja">{graded.response}</span>
                </p>
              )}
            </>
          ) : (
            <p>
              정답: <strong lang={item.track === 'toeic' ? 'en' : 'ja'}>{graded.expected}</strong>
              {!graded.correct && <span className="muted"> · 내 답: {graded.response}</span>}
            </p>
          )}
          {listen && (
            <button type="button" className="secondary" onClick={() => speak(listen[0], listen[1])}>
              🔊 듣기
            </button>
          )}
        </section>
      )}
      {graded && (aidWord || aidSentence) && (
        <details className="aid" open>
          <summary className="small muted">예시</summary>
          {aidWord && <ExampleWords list={[aidWord]} />}
          {aidSentence && <ExampleSentences list={[aidSentence]} />}
        </details>
      )}
      {error && <p className="error">{error}</p>}

      {graded &&
        (graded.selfPending ? (
          <div className="ratings two">
            <button type="button" className="secondary" disabled={busy} onClick={() => void finish()}>
              틀렸어요
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setGraded({ ...graded, correct: true, selfPending: false, selfCorrect: true })}
            >
              맞았어요
            </button>
          </div>
        ) : graded.correct && !graded.sent ? (
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
