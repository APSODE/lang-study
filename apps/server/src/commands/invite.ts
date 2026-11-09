import { checkInviteOptions, createInvite, INVITE_DAYS_DEFAULT, INVITE_USES_DEFAULT } from '../auth/invites.ts'
import type { CommandContext } from './types.ts'

export const help = `[일수=${INVITE_DAYS_DEFAULT}] [횟수=${INVITE_USES_DEFAULT}]  초대 링크 발급 (첫 관리자 이름으로). 웹 화면 없이 시작할 때`

export const run = ({ cfg, db }: CommandContext, args: string[]) => {
  const days = args[0] === undefined ? undefined : Number(args[0])
  const maxUses = args[1] === undefined ? undefined : Number(args[1])
  const problem = checkInviteOptions(days, maxUses)
  if (problem) throw new Error(problem)
  const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get() as { id: number } | undefined
  if (!admin) throw new Error('관리자가 없습니다. 먼저 create-admin <이름> 을 실행하세요')
  const invite = createInvite(db, cfg, admin.id, days, maxUses)
  console.log(invite.url)
  console.log(`만료: ${new Date(invite.expiresAt).toISOString()} · 사용 가능 ${invite.maxUses}회`)
}
