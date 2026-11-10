// 기록 (#/stats): 최근 12주 학습 히트맵 · 합계 · 트랙별 카드 단계 (친구가 만든 항목도 이어서).
// stats/activity · stats/tracks 가 아직 없으면(404) 각 카드에 "준비 중"을 보여 준다.
import { type ReactNode, useState } from 'react'
import { Card } from '../components/Card.tsx'
import { LoadError } from '../components/EmptyState.tsx'
import { useSummary } from '../components/Shell.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { Stat } from '../components/Stat.tsx'
import { addDays, dayLabel, fmtNum, fmtPct, weekdayMon0 } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import type { ActivityDay, ActivityResponse, DeckStats, TrackStats, TrackStatsResponse } from '../types.ts'

const DAYS = 84
const WEEKS = 12
const ROW_LABELS = ['월', '', '수', '', '금', '', '일'] as const

/** 0 = 기록 없음, 1–4 = 그 기간 최대값에 대한 비율 사분위 */
const level = (n: number, max: number): number => {
  if (n <= 0 || max <= 0) return 0
  const r = n / max
  return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4
}

const cellText = (d: ActivityDay) =>
  `${dayLabel(d.day)} · ${d.reviews > 0 ? `${fmtNum(d.reviews)}장 복습, 정답 ${fmtNum(d.correct)}` : '학습 없음'}`

/**
 * 7줄(월–일) × 12칸(주). 마지막 칸이 이번 주, 오늘 뒤의 날은 비워 둔다.
 * 시작은 11주 전 월요일이라 84일 중 앞의 며칠은 표에 들어가지 않을 수 있다(합계에는 들어간다).
 */
function Heatmap({ days }: { days: ActivityDay[] }) {
  const [sel, setSel] = useState<ActivityDay | null>(null)
  const today = days[days.length - 1]?.day
  if (!today) return null
  const byDay = new Map(days.map(d => [d.day, d]))
  const start = addDays(today, 6 - weekdayMon0(today) - (WEEKS * 7 - 1))
  const max = Math.max(0, ...days.map(d => d.reviews))
  const dateAt = (col: number, row: number) => addDays(start, col * 7 + row)

  const months = Array.from({ length: WEEKS }, (_, c) => {
    const first = dateAt(c, 0)
    const prev = c > 0 ? dateAt(c - 1, 0) : null
    return !prev || prev.slice(5, 7) !== first.slice(5, 7) ? `${Number(first.slice(5, 7))}월` : ''
  })

  return (
    <div className="heatmap-wrap">
      <div className="heatmap" role="group" aria-label={`최근 ${WEEKS}주 학습 기록`}>
        <span />
        {months.map((m, c) => (
          <span key={`m${c}`} className="hm-month" aria-hidden="true">
            {m}
          </span>
        ))}
        {ROW_LABELS.map((label, r) => (
          <HeatRow key={r} label={label}>
            {Array.from({ length: WEEKS }, (_, c) => {
              const date = dateAt(c, r)
              const d = byDay.get(date)
              if (date > today || !d) return <span key={c} className="hm-cell future" aria-hidden="true" />
              const text = cellText(d)
              return (
                <span
                  key={c}
                  className={`hm-cell l${level(d.reviews, max)}${sel?.day === d.day ? ' sel' : ''}${d.day === today ? ' today' : ''}`}
                  role="img"
                  aria-label={text}
                  title={text}
                  onClick={() => setSel(s => (s?.day === d.day ? null : d))}
                />
              )
            })}
          </HeatRow>
        ))}
      </div>
      <div className="hm-foot">
        <p className="hm-detail small" aria-live="polite">
          {sel ? cellText(sel) : <span className="muted">칸을 누르면 그날 기록을 봅니다</span>}
        </p>
        <div className="hm-legend small muted" aria-hidden="true">
          적음
          {[0, 1, 2, 3, 4].map(l => (
            <span key={l} className={`hm-cell l${l}`} />
          ))}
          많음
        </div>
      </div>
    </div>
  )
}

function HeatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="hm-wd" aria-hidden="true">
        {label}
      </span>
      {children}
    </>
  )
}

function Totals({ days, streak }: { days: ActivityDay[]; streak: number | null }) {
  const today = days[days.length - 1]?.day ?? ''
  const weekStart = today ? addDays(today, -weekdayMon0(today)) : ''
  const month = today.slice(0, 7)
  const sum = (list: ActivityDay[], k: 'reviews' | 'correct') => list.reduce((n, d) => n + d[k], 0)
  const week = days.filter(d => d.day >= weekStart)
  const monthDays = days.filter(d => d.day.startsWith(month))
  const monthReviews = sum(monthDays, 'reviews')
  const active = days.filter(d => d.reviews > 0).length
  return (
    <div className="stats-row">
      <Stat value={fmtNum(sum(week, 'reviews'))} label="이번 주 복습" />
      <Stat value={fmtNum(monthReviews)} label="이번 달 복습" />
      <Stat value={fmtPct(monthReviews ? sum(monthDays, 'correct') / monthReviews : null)} label="이번 달 정답률" />
      <Stat
        value={streak === null ? fmtNum(active) : `${streak}일`}
        label={streak === null ? '학습한 날' : '연속 학습'}
        sub={`최근 ${WEEKS}주 중 ${active}일`}
      />
    </div>
  )
}

const STAGES = [
  ['mature', '장기 기억'],
  ['young', '익히는 중'],
  ['learning', '배우는 중'],
  ['unseen', '안 본 카드'],
] as const

function TrackBreakdown({ t, label }: { t: TrackStats | DeckStats; label: string }) {
  if (t.notes === 0 || t.cards === 0) {
    return (
      <li className="breakdown">
        <div className="breakdown-head">
          <strong>{label}</strong>
          <span className="muted small">준비 중</span>
        </div>
      </li>
    )
  }
  return (
    <li className="breakdown">
      <div className="breakdown-head">
        <strong>{label}</strong>
        <span className="muted small">
          카드 {fmtNum(t.cards)}장 · 7일 정답률 {fmtPct(t.accuracy7d)}
        </span>
      </div>
      <div className="stack" role="img" aria-label={STAGES.map(([k, l]) => `${l} ${t[k]}장`).join(', ')}>
        {STAGES.map(([k, l]) =>
          t[k] > 0 ? (
            <span key={k} className={`seg seg-${k}`} style={{ flexGrow: t[k] }} title={`${l} ${fmtNum(t[k])}장`} />
          ) : null,
        )}
      </div>
      <ul className="legend small">
        {STAGES.map(([k, l]) => (
          <li key={k}>
            <span className={`swatch seg-${k}`} aria-hidden="true" />
            {l} <strong>{fmtNum(t[k])}</strong>
          </li>
        ))}
      </ul>
    </li>
  )
}

export function Stats() {
  const activity = useApi<ActivityResponse>(`stats/activity?days=${DAYS}`)
  const tracks = useApi<TrackStatsResponse>('stats/tracks')
  const summary = useSummary()
  const streak = summary.data?.streak ?? null

  return (
    <div className="page stats-page">
      <Card title="학습 기록" className="span-2">
        {activity.data ? (
          <>
            <Totals days={activity.data.days} streak={streak} />
            <Heatmap days={activity.data.days} />
          </>
        ) : activity.error ? (
          <LoadError error={activity.error} notReady={activity.notReady} onRetry={activity.reload} />
        ) : (
          <Skeleton height={180} />
        )}
      </Card>

      <Card title="트랙별 카드" className="span-2">
        {tracks.data ? (
          <ul className="breakdowns">
            {tracks.data.tracks.map(t => (
              <TrackBreakdown key={t.track} t={t} label={TRACK_LABEL[t.track]} />
            ))}
            {tracks.data.decks?.map(d => (
              <TrackBreakdown key={d.key} t={d} label={d.name} />
            ))}
          </ul>
        ) : tracks.error ? (
          <LoadError error={tracks.error} notReady={tracks.notReady} onRetry={tracks.reload} />
        ) : (
          <Skeleton lines={4} />
        )}
      </Card>
    </div>
  )
}
