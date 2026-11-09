// 사용자 이름 · 비밀번호 규칙과 조회. 웹 가입과 CLI(create-admin)가 같이 쓴다.
import type { DatabaseSync } from 'node:sqlite'

export const NAME_RE = /^[A-Za-z0-9가-힣_-]{2,20}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

/** 문제가 있으면 오류 문구, 없으면 null */
export const checkName = (name: unknown): string | null =>
  typeof name === 'string' && NAME_RE.test(name)
    ? null
    : '이름은 2~20자의 한글 · 영문 · 숫자 · _ · - 만 쓸 수 있습니다'

export const checkPassword = (password: unknown): string | null =>
  typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX
    ? null
    : `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자여야 합니다`

export interface UserRow {
  id: number
  name: string
  passwordHash: string
  isAdmin: boolean
}

/** 이름으로 찾는다 (대소문자 구분 없음) */
export const findUserByName = (db: DatabaseSync, name: string): UserRow | null => {
  const row = db
    .prepare('SELECT id, name, password_hash AS passwordHash, is_admin AS isAdmin FROM users WHERE name = ? COLLATE NOCASE')
    .get(name) as { id: number; name: string; passwordHash: string; isAdmin: number } | undefined
  return row ? { ...row, isAdmin: row.isAdmin === 1 } : null
}

export const insertUser = (
  db: DatabaseSync,
  name: string,
  passwordHash: string,
  isAdmin = false,
  now = Date.now(),
): number =>
  Number(
    db
      .prepare('INSERT INTO users(name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)')
      .run(name, passwordHash, isAdmin ? 1 : 0, now).lastInsertRowid,
  )
