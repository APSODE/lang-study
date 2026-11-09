// CSRF 방어.
// 상태를 바꾸는 /api 요청(GET · HEAD · OPTIONS 외)은 Content-Type: application/json 이어야 한다 (아니면 415).
// 브라우저는 다른 사이트의 <form> 이나 단순 fetch 로 application/json 을 보낼 수 없고(보내려면 CORS
// 사전 요청이 필요한데 서버는 CORS 를 허용하지 않는다), 세션 쿠키는 SameSite=Lax 라 다른 사이트에서
// 보낸 POST · DELETE 에는 실리지 않는다. 이 둘을 합쳐 CSRF 토큰 없이 막는다.
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from './middleware.ts'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export const requireJsonForMutations = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE.has(c.req.method)) {
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (type !== 'application/json') return c.json({ error: 'Content-Type 은 application/json 이어야 합니다' }, 415)
  }
  await next()
})
