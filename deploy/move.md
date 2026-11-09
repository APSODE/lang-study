# 서버 이전 절차

상태는 `DATA_DIR`(compose 에서는 `./data`) 하나와 `.env` 뿐이다.

1. 기존 호스트: `docker exec nakamura node apps/server/src/cli.ts backup` (실행 중에도 일관된 사본)
2. `docker compose stop` 후 `data/`(또는 방금 만든 `data/backups/app-*.sqlite`를 `data/db/app.sqlite`로) 와 `.env` 를 새 호스트로 복사
3. 새 호스트: 이미지 준비(`docker compose up -d --build` 또는 `deploy/server/push-image.sh <호스트>`) → 실행
4. 리버스 프록시 · tailscale serve · cloudflared 대상을 새 호스트로 바꾸고, `.env` 의 `PUBLIC_URL` 확인
