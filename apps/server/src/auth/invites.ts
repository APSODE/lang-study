// 초대 링크: 관리자가 발급, 만료 · 사용 횟수 제한. 웹(관리자 화면)과 CLI(invite)가 같이 쓴다.
import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Config } from '../config.ts'

export const INVITE_DAYS_DEFAULT = 7
export const INVITE_DAYS_MAX = 30
export const INVITE_USES_DEFAULT = 1
export const INVITE_USES_MAX = 20
const DAY_MS = 24 * 60 * 60 * 1000

export interface Invite {
  code: string
  url: string
  expiresAt: number
  maxUses: number
  uses: number
  createdAt: number
}

/** 웹은 해시 라우팅이라 #/join/<code> */
export const inviteUrl = (cfg: Config, code: string): string => `${cfg.publicUrl}${cfg.basePath}/#/join/${code}`

/** days · maxUses 를 검사한다. 문제가 있으면 오류 문구. */
export const checkInviteOptions = (days: unknown, maxUses: unknown): string | null => {
  const ok = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max)
  if (!ok(days, INVITE_DAYS_MAX)) return `유효 기간은 1~${INVITE_DAYS_MAX}일 사이의 정수여야 합니다`
  if (!ok(maxUses, INVITE_USES_MAX)) return `사용 횟수는 1~${INVITE_USES_MAX}회 사이의 정수여야 합니다`
  return null
}

export const createInvite = (
  db: DatabaseSync,
  cfg: Config,
  createdBy: number,
  days = INVITE_DAYS_DEFAULT,
  maxUses = INVITE_USES_DEFAULT,
  now = Date.now(),
): Invite => {
  const code = randomBytes(18).toString('base64url')
  const expiresAt = now + days * DAY_MS
  db.prepare('INSERT INTO invites(code, created_by, expires_at, max_uses, uses, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
    code,
    createdBy,
    expiresAt,
    maxUses,
    now,
  )
  return { code, url: inviteUrl(cfg, code), expiresAt, maxUses, uses: 0, createdAt: now }
}

const ACTIVE = 'expires_at > ? AND uses < max_uses'

/** 아직 쓸 수 있는 초대인지. 쓸 수 없으면 null. */
export const findActiveInvite = (db: DatabaseSync, code: string, now = Date.now()): { expiresAt: number } | null =>
  (db.prepare(`SELECT expires_at AS expiresAt FROM invites WHERE code = ? AND ${ACTIVE}`).get(code, now) as
    | { expiresAt: number }
    | undefined) ?? null

export const listActiveInvites = (db: DatabaseSync, cfg: Config, now = Date.now()): Invite[] =>
  (
    db
      .prepare(
        `SELECT code, expires_at AS expiresAt, max_uses AS maxUses, uses, created_at AS createdAt
           FROM invites WHERE ${ACTIVE} ORDER BY created_at DESC`,
      )
      .all(now) as Omit<Invite, 'url'>[]
  ).map(i => ({ ...i, url: inviteUrl(cfg, i.code) }))

/**
 * 초대를 한 번 사용한다. 조건 검사와 증가를 UPDATE 한 문장으로 해서 동시에 써도 초과하지 않는다.
 * 트랜잭션 안에서 부른다. 쓸 수 없는 초대면 false.
 */
export const consumeInvite = (db: DatabaseSync, code: string, now = Date.now()): boolean =>
  Number(db.prepare(`UPDATE invites SET uses = uses + 1 WHERE code = ? AND ${ACTIVE}`).run(code, now).changes) === 1

export const deleteInvite = (db: DatabaseSync, code: string): boolean =>
  Number(db.prepare('DELETE FROM invites WHERE code = ?').run(code).changes) === 1
