// 비밀번호 해시: scrypt (node:crypto). 저장 형식이 매개변수를 담고 있어 나중에 값을 올려도 옛 해시를 검증할 수 있다.
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// N=16384, r=8 이면 한 번에 약 16MB 를 쓴다 (서버 상한 256MB).
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const N = 16384
const R = 8
const P = 1
const KEY_LEN = 32
const SALT_LEN = 16
/** 검증할 때 받아들이는 최대 메모리. 저장된 값이 터무니없이 크면 계산하지 않는다. */
const MAX_MEM = 64 * 1024 * 1024

const derive = (password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password.normalize('NFC'), salt, keyLen, { ...opts, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  )

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LEN)
  const hash = await derive(password, salt, KEY_LEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number]
  if (![n, r, p].every(Number.isSafeInteger) || 128 * n * r > MAX_MEM) return false
  const salt = Buffer.from(parts[4]!, 'base64')
  const expected = Buffer.from(parts[5]!, 'base64')
  if (salt.length === 0 || expected.length === 0) return false
  try {
    const actual = await derive(password, salt, expected.length, { N: n, r, p })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** 없는 사용자로 로그인할 때도 시간이 비슷하게 걸리도록 쓰는 해시 */
let dummy: Promise<string> | undefined
export const dummyVerify = async (password: string): Promise<void> => {
  dummy ??= hashPassword('nakamura-dummy-password')
  await verifyPassword(password, await dummy)
}
