// 작문 문제 고르기 (#/write/<트랙>): JLPT 레벨(여러 개) · "공부한 한자만" 을 고르고 작문 학습(#/study/<트랙>?mode=write…)을 시작한다.
// 수는 study/write/options 로 받는다. 복습할 작문 문제는 고른 레벨과 상관없이 먼저 나온다 (서버 큐).
// 마지막 선택은 이 기기의 localStorage 에 둔다 (못 쓰면 기본값: N5 만, 공부한 한자만 끔).
import { useState } from 'react'
import type { Track } from '@nakamura/core'
import { Card } from '../components/Card.tsx'
import { LoadError } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtNum } from '../format.ts'
import { useApi } from '../hooks.ts'
import { navigate } from '../router.ts'
import { type WriteOptions, writeStudyPath } from '../study.ts'

interface Choice {
  levels: number[]
  learnedOnly: boolean
}

const DEFAULT_CHOICE: Choice = { levels: [5], learnedOnly: false }
const storageKey = (track: Track) => `nk.write.${track}`

const loadChoice = (track: Track): Choice => {
  try {
    const raw = window.localStorage.getItem(storageKey(track))
    if (!raw) return DEFAULT_CHOICE
    const v = JSON.parse(raw) as Partial<Choice>
    const levels = Array.isArray(v.levels) ? v.levels.filter(n => Number.isInteger(n) && n >= 1 && n <= 5) : []
    return { levels: levels.length ? levels : DEFAULT_CHOICE.levels, learnedOnly: v.learnedOnly === true }
  } catch {
    return DEFAULT_CHOICE
  }
}

const saveChoice = (track: Track, c: Choice) => {
  try {
    window.localStorage.setItem(storageKey(track), JSON.stringify(c))
  } catch {
    // 저장하지 못해도 고르기는 된다
  }
}

export function WriteSelect({ track }: { track: Track }) {
  const options = useApi<WriteOptions>(`study/write/options?track=${track}`)
  const [choice, setChoice] = useState<Choice>(() => loadChoice(track))
  const o = options.data

  const update = (next: Choice) => {
    setChoice(next)
    saveChoice(track, next)
  }
  const toggleLevel = (jlpt: number) => {
    const has = choice.levels.includes(jlpt)
    update({ ...choice, levels: has ? choice.levels.filter(l => l !== jlpt) : [...choice.levels, jlpt] })
  }

  if (!o) {
    return (
      <div className="page write-select">
        <Card>
          {options.error ? (
            <LoadError error={options.error} notReady={options.notReady} onRetry={options.reload} />
          ) : (
            <Skeleton lines={4} />
          )}
        </Card>
      </div>
    )
  }

  // 서버에 없는 레벨(문제가 없는 레벨)은 고른 것에서 뺀다
  const picked = o.levels.filter(l => choice.levels.includes(l.jlpt))
  const available = picked.reduce((n, l) => n + (choice.learnedOnly ? l.learnedFresh : l.total - l.introduced), 0)
  const newToday = Math.min(o.newLeft, available)
  const canStart = picked.length > 0 && (newToday > 0 || o.due > 0)

  const start = () => {
    if (!canStart) return
    navigate(writeStudyPath(track, { levels: picked.map(l => l.jlpt).sort((a, b) => b - a), learnedOnly: choice.learnedOnly }))
  }

  const hint =
    picked.length === 0
      ? '레벨을 하나 이상 고르세요.'
      : newToday === 0 && o.due === 0
        ? o.newLeft === 0
          ? `오늘 새 문제(하루 ${fmtNum(o.newPerDay)}개)를 모두 봤어요. 설정에서 바꿀 수 있어요.`
          : choice.learnedOnly
            ? '고른 레벨에 공부한 한자의 새 문제가 없습니다.'
            : '고른 레벨에 남은 새 문제가 없습니다.'
        : ''

  return (
    <div className="page write-select">
      <Card title="일본어 일작">
        <p className="muted small">한국어 문장을 보고 일본어로 써 봅니다. 쓴 답은 모범 답안과 비교해 스스로 채점합니다.</p>
      </Card>

      <Card title="JLPT 레벨">
        <ul className="level-chips">
          {o.levels.map(l => {
            const on = choice.levels.includes(l.jlpt)
            return (
              <li key={l.jlpt}>
                <button type="button" className="level-chip" aria-pressed={on} onClick={() => toggleLevel(l.jlpt)}>
                  <span className="level-name">
                    N{l.jlpt}
                    {on && <Icon name="check" size={18} />}
                  </span>
                  <span className="small">새 문제 {fmtNum(l.total - l.introduced)}개</span>
                  <span className="muted small">공부한 한자 {fmtNum(l.learned)}자</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="form">
          <label className="switch-row">
            <span>
              공부한 한자만
              <span className="muted small block">한자 학습에서 한 번이라도 본 한자의 문장만 새 문제로 냅니다.</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={choice.learnedOnly}
              onChange={e => update({ ...choice, learnedOnly: e.target.checked })}
            />
          </label>
        </div>
      </Card>

      <div className="write-start">
        <p className="write-summary" role="status">
          오늘 새 문제 <strong>{fmtNum(newToday)}</strong>개 · 복습 <strong>{fmtNum(o.due)}</strong>개
        </p>
        {o.due > 0 && <p className="muted small">복습할 문제는 고른 레벨과 상관없이 먼저 나옵니다.</p>}
        <button type="button" className="big" disabled={!canStart} onClick={start}>
          <Icon name="play" size={20} />
          시작
        </button>
        {hint && <p className="muted small">{hint}</p>}
      </div>
    </div>
  )
}
