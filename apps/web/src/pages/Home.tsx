// 홈 (#/): 인사 · 오늘 진행 고리 · 연속 학습일과 최근 7일 · 이어서 학습 · 트랙 카드 · 이번 주 순위.
// 요약(study/summary)은 App 이 불러와 SummaryContext 로 준다. 통계 · 순위 API 가 아직 없으면(404) 그 부분만 숨긴다.
import { TRACKS, type Track } from '@nakamura/core'
import type { SessionUser } from '../api.ts'
import { Card } from '../components/Card.tsx'
import { LoadError } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { ProgressBar } from '../components/ProgressBar.tsx'
import { Ring } from '../components/Ring.tsx'
import { useSummary } from '../components/Shell.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { dayLabel, fmtNum, localToday, weekdayLabel } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import type { ActivityResponse, LeaderboardResponse, TrackStats, TrackStatsResponse, TrackSummary } from '../types.ts'

const greeting = (): string => {
  const h = new Date().getHours()
  if (h < 5) return '늦은 밤이에요'
  if (h < 12) return '좋은 아침이에요'
  if (h < 18) return '좋은 오후예요'
  return '좋은 저녁이에요'
}

const MEDAL = ['🥇', '🥈', '🥉'] as const

function TodayCard({ tracks, reviewsToday, streak }: { tracks: TrackSummary[]; reviewsToday: number; streak: number }) {
  const activity = useApi<ActivityResponse>('stats/activity?days=7')
  const left = tracks.reduce((n, t) => n + (t.notes > 0 ? t.due + t.newLeft : 0), 0)
  const planned = reviewsToday + left
  const ratio = planned === 0 ? 0 : reviewsToday / planned

  return (
    <Card className="today">
      <div className="today-grid">
        <Ring value={ratio} label={`오늘 ${planned}장 중 ${reviewsToday}장 완료`}>
          <span className="ring-num">{fmtNum(reviewsToday)}</span>
          <span className="ring-sub">/ {fmtNum(planned)}장</span>
        </Ring>
        <div className="today-side">
          <p className="today-title">오늘</p>
          <p className="muted small">
            {planned === 0 ? '오늘 할 카드가 없습니다' : left === 0 ? '오늘 할 카드를 모두 끝냈어요!' : `남은 카드 ${fmtNum(left)}장`}
          </p>
          <p className="today-streak">
            <span aria-hidden="true">🔥</span> 연속 <strong>{streak}</strong>일
          </p>
          {activity.data && (
            <ol className="week-dots" aria-label="최근 7일 학습">
              {activity.data.days.map(d => (
                <li key={d.day} className={d.reviews > 0 ? 'on' : ''} title={`${dayLabel(d.day)} · ${d.reviews}장`}>
                  <span className="dot" aria-hidden="true" />
                  <span className="dot-label">{weekdayLabel(d.day)}</span>
                  <span className="sr-only">
                    {dayLabel(d.day)} {d.reviews > 0 ? `${d.reviews}장` : '쉼'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Card>
  )
}

function TrackCard({ t, stats }: { t: TrackSummary; stats: TrackStats | undefined }) {
  const ready = t.notes > 0
  const todo = t.due + t.newLeft
  return (
    <li className="card track-card">
      <div className="track-head">
        <span className={`track-badge track-${t.track}`} aria-hidden="true" lang="ja">
          {t.track === 'kana' ? 'あ' : t.track === 'kanji' ? '字' : 'A'}
        </span>
        <strong>{TRACK_LABEL[t.track]}</strong>
        {ready && <span className="muted small push">배운 카드 {fmtNum(t.learned)}장</span>}
      </div>
      {!ready ? (
        <p className="muted">준비 중</p>
      ) : (
        <>
          <div className="track-stats">
            <span>
              <strong>{fmtNum(t.due)}</strong>
              <span className="muted small">복습</span>
            </span>
            <span>
              <strong>{fmtNum(t.newLeft)}</strong>
              <span className="muted small">새 카드</span>
            </span>
            <span>
              <strong>{fmtNum(t.reviewsToday)}</strong>
              <span className="muted small">오늘</span>
            </span>
          </div>
          {stats && stats.cards > 0 && (
            <div className="track-progress">
              <ProgressBar
                value={(stats.cards - stats.unseen) / stats.cards}
                label={`${TRACK_LABEL[t.track]} 진도 ${stats.cards - stats.unseen} / ${stats.cards}`}
              />
              <span className="muted small">
                {fmtNum(stats.cards - stats.unseen)} / {fmtNum(stats.cards)}장
              </span>
            </div>
          )}
          <a className={`button${todo > 0 ? '' : ' secondary'}`} href={`#/study/${t.track}`}>
            {todo > 0 ? '학습 시작' : '오늘 끝 · 더 보기'}
          </a>
        </>
      )}
    </li>
  )
}

function WeekRanking() {
  const board = useApi<LeaderboardResponse>('social/leaderboard?period=week')
  if (board.notReady || board.error) return null
  const entries = board.data?.entries ?? []
  const top = entries.slice(0, 3)
  const mine = entries.find(e => e.isMe)
  const rows = mine && !top.some(e => e.isMe) ? [...top, mine] : top
  return (
    <Card
      title="이번 주 순위"
      className="week-rank"
      action={
        <a className="more" href="#/friends">
          전체 보기 <Icon name="chevron" size={16} />
        </a>
      }
    >
      {!board.data ? (
        <Skeleton lines={3} />
      ) : rows.length === 0 ? (
        <p className="muted small">아직 이번 주 기록이 없습니다.</p>
      ) : (
        <ol className="rank-list compact">
          {rows.map((e, i) => (
            <li key={e.userId} className={`${e.isMe ? 'me' : ''}${i === 3 ? ' gap' : ''}`}>
              <span className="rank">{e.rank <= 3 ? MEDAL[e.rank - 1] : e.rank}</span>
              <span className="rank-name">
                {e.name}
                {e.isMe && <span className="me-tag">나</span>}
              </span>
              <span className="rank-value">{fmtNum(e.reviews)}장</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export function Home({ user }: { user: SessionUser }) {
  const summary = useSummary()
  const stats = useApi<TrackStatsResponse>('stats/tracks')
  const s = summary.data
  const statsOf = (t: Track) => stats.data?.tracks.find(x => x.track === t)

  // 이어서 학습: 지금 할 카드(복습 + 새 카드)가 가장 많은 트랙
  const next = s?.tracks
    .filter(t => t.notes > 0 && t.due + t.newLeft > 0)
    .sort((a, b) => b.due + b.newLeft - (a.due + a.newLeft))[0]

  return (
    <div className="page home">
      <section className="hello">
        <p className="hello-date muted">{dayLabel(s?.day ?? localToday())}</p>
        <p className="hello-text">
          {greeting()}, <strong>{user.display}</strong>님
        </p>
      </section>

      {!s ? (
        summary.error ? (
          <Card>
            <LoadError error={summary.error} notReady={summary.notReady} onRetry={summary.reload} />
          </Card>
        ) : (
          <Card>
            <Skeleton height={120} />
          </Card>
        )
      ) : (
        <>
          <TodayCard tracks={s.tracks} reviewsToday={s.reviewsToday} streak={s.streak} />

          {next ? (
            <a className="button big continue" href={`#/study/${next.track}`}>
              <Icon name="play" size={20} />
              이어서 학습 · {TRACK_LABEL[next.track]} {fmtNum(next.due + next.newLeft)}장
            </a>
          ) : (
            <p className="done-note">오늘 할 카드를 모두 끝냈어요. 내일 또 만나요!</p>
          )}

          <h2 className="section-title">트랙</h2>
          <ul className="track-grid">
            {TRACKS.map(track => {
              const t = s.tracks.find(x => x.track === track)
              return t ? <TrackCard key={track} t={t} stats={statsOf(track)} /> : null
            })}
          </ul>
        </>
      )}

      <WeekRanking />
    </div>
  )
}
