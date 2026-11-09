// 친구 (#/friends): 이번 주 / 이번 달 순위 · 친구별 진도.
// 친구 진도의 막대는 트랙의 전체 카드 수(stats/tracks 의 cards — 모두 같은 공개 노트를 본다)에 대한 비율이다.
// stats/tracks 가 없으면 친구들 중 가장 많이 배운 수를 기준으로 그린다.
import { useState } from 'react'
import { TRACKS, type Track } from '@nakamura/core'
import type { SessionUser } from '../api.ts'
import { Card } from '../components/Card.tsx'
import { EmptyState, LoadError } from '../components/EmptyState.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { useSummary } from '../components/Shell.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtNum, localToday, relativeDay } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import type { Friend, FriendsResponse, LeaderboardPeriod, LeaderboardResponse, TrackStatsResponse } from '../types.ts'

const MEDAL = ['🥇', '🥈', '🥉'] as const

function Leaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week')
  const board = useApi<LeaderboardResponse>(`social/leaderboard?period=${period}`)
  return (
    <Card
      title="순위"
      action={
        <Segmented
          label="순위 기간"
          value={period}
          onChange={setPeriod}
          items={[
            { value: 'week', label: '이번 주' },
            { value: 'month', label: '이번 달' },
          ]}
        />
      }
    >
      {board.data ? (
        board.data.entries.length === 0 ? (
          <p className="muted small">아직 이 기간의 기록이 없습니다.</p>
        ) : (
          <ol className="rank-list">
            {board.data.entries.map(e => (
              <li key={e.userId} className={e.isMe ? 'me' : ''}>
                <span className="rank" aria-label={`${e.rank}위`}>
                  {e.rank <= 3 ? MEDAL[e.rank - 1] : e.rank}
                </span>
                <span className="rank-name">
                  {e.name}
                  {e.isMe && <span className="me-tag">나</span>}
                </span>
                <span className="rank-streak small" title={`연속 ${e.streak}일`}>
                  <span aria-hidden="true">🔥</span>
                  {e.streak}
                </span>
                <span className="rank-value">{fmtNum(e.reviews)}장</span>
              </li>
            ))}
          </ol>
        )
      ) : board.error ? (
        <LoadError error={board.error} notReady={board.notReady} onRetry={board.reload} />
      ) : (
        <Skeleton lines={4} />
      )}
    </Card>
  )
}

function FriendCard({ f, today, totals }: { f: Friend; today: string; totals: Partial<Record<Track, number>> }) {
  return (
    <li className="card friend">
      <div className="friend-head">
        <span className="avatar" aria-hidden="true">
          {f.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="friend-name">
          <strong>{f.name}</strong>
          <span className="muted small">
            마지막 학습 {relativeDay(f.lastStudiedDay, today)} · 이번 주 {fmtNum(f.reviewsWeek)}장
          </span>
        </span>
        <span className="chip" title={`연속 ${f.streak}일`}>
          <span aria-hidden="true">🔥</span>
          {f.streak}
        </span>
      </div>
      <ul className="mini-bars">
        {TRACKS.map(track => {
          const t = f.tracks.find(x => x.track === track)
          const total = totals[track] ?? 0
          if (!t || total === 0) return null
          return (
            <li key={track}>
              <span className="mini-label small">{TRACK_LABEL[track]}</span>
              <span
                className="mini-bar"
                role="img"
                aria-label={`${TRACK_LABEL[track]}: 배운 카드 ${t.learned}장, 장기 기억 ${t.mature}장`}
              >
                <span className="mini-learned" style={{ width: `${Math.min(100, (t.learned / total) * 100)}%` }} />
                <span className="mini-mature" style={{ width: `${Math.min(100, (t.mature / total) * 100)}%` }} />
              </span>
              <span className="mini-value small muted">
                {fmtNum(t.learned)}
                {t.mature > 0 && ` · ${fmtNum(t.mature)}`}
              </span>
            </li>
          )
        })}
      </ul>
    </li>
  )
}

export function Friends({ user }: { user: SessionUser }) {
  const friends = useApi<FriendsResponse>('social/friends')
  const stats = useApi<TrackStatsResponse>('stats/tracks')
  const today = useSummary().data?.day ?? localToday()

  // 막대 기준: 트랙 카드 수, 없으면 친구 중 최대 배운 수
  const totals: Partial<Record<Track, number>> = {}
  for (const track of TRACKS) {
    const cards = stats.data?.tracks.find(t => t.track === track)?.cards
    totals[track] =
      cards ?? Math.max(0, ...(friends.data?.friends ?? []).map(f => f.tracks.find(t => t.track === track)?.learned ?? 0))
  }

  return (
    <div className="page friends-page">
      <Leaderboard />

      <h2 className="section-title">친구 진도</h2>
      {friends.data ? (
        friends.data.friends.length === 0 ? (
          <Card>
            <EmptyState
              icon="friends"
              title="아직 진도를 보여 주는 친구가 없어요"
              action={
                user.isAdmin ? (
                  <a className="button" href="#/admin/invites">
                    초대 링크 만들기
                  </a>
                ) : undefined
              }
            >
              {user.isAdmin
                ? '친구를 초대해 같이 공부해 보세요.'
                : '관리자에게 초대 링크를 부탁해 친구를 불러 보세요. 친구가 설정에서 진도 공개를 켜면 여기에 보입니다.'}
            </EmptyState>
          </Card>
        ) : (
          <>
            <ul className="friend-grid">
              {friends.data.friends.map(f => (
                <FriendCard key={f.userId} f={f} today={today} totals={totals} />
              ))}
            </ul>
            <p className="legend-note small muted">
              <span className="swatch mini-learned" aria-hidden="true" /> 배운 카드
              <span className="swatch mini-mature" aria-hidden="true" /> 장기 기억
            </p>
          </>
        )
      ) : friends.error ? (
        <Card>
          <LoadError error={friends.error} notReady={friends.notReady} onRetry={friends.reload} />
        </Card>
      ) : (
        <Card>
          <Skeleton lines={3} />
        </Card>
      )}
    </div>
  )
}
