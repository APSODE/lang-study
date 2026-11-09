import { randomBytes } from 'node:crypto'
import { hashPassword } from '../auth/password.ts'
import { checkName, findUserByName, insertUser } from '../auth/users.ts'
import type { CommandContext } from './types.ts'

export const help = '<이름>  관리자 만들기 (비밀번호는 한 번만 출력). 이미 있는 사용자면 관리자로 지정'

export const run = async ({ db }: CommandContext, args: string[]) => {
  const name = args[0]
  if (!name) throw new Error('사용: create-admin <이름>')
  const existing = findUserByName(db, name)
  if (existing) {
    if (existing.isAdmin) {
      console.log(`${existing.name} 은(는) 이미 관리자입니다`)
      return
    }
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id)
    console.log(`${existing.name} 을(를) 관리자로 지정했습니다 (비밀번호는 그대로)`)
    return
  }
  const problem = checkName(name)
  if (problem) throw new Error(problem)
  const password = randomBytes(12).toString('base64url')
  insertUser(db, name, await hashPassword(password), true)
  console.log(`관리자 ${name} 을(를) 만들었습니다`)
  console.log(`비밀번호: ${password}`)
  console.log('이 비밀번호는 다시 보여 주지 않습니다. 지금 기록해 두세요.')
}
