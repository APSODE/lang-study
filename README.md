# NakamuraProject

친구들과 쓰는 일본어(가나 · 한자 · JLPT) · 영어(토익 · 토플) 복습 사이트. FSRS 간격 반복 + PWA.
설계와 결정 사항: [docs/논의_정리.md](docs/논의_정리.md)

## 구조

```
packages/core   노트 타입, 연습 방식(drill) 레지스트리와 채점, FSRS 래퍼 — 서버와 웹이 같이 쓴다
apps/server     Hono API + 웹 정적 파일, SQLite(node:sqlite), 시작 시 자동 마이그레이션
apps/web        React + Vite PWA
deploy/         저사양 서버용 compose · 이미지 전송 · 백업, 이전 절차(move.md)
```

## 개발 (호스트에 Node 불필요)

모든 명령은 `./nd` 로 node:26 컨테이너 안에서 실행한다.

```sh
./nd npm install
./nd npm test
./nd npm run typecheck
./nd npm run dev:server     # http://127.0.0.1:8081  (데이터: ./data)
./nd npm run dev:web        # http://127.0.0.1:5173  (/api 는 8081 로 프록시)
```

## 실행 · 배포

```sh
cp .env.example .env        # 값 채우기
docker compose up -d --build
```

- 상태는 `DATA_DIR`(기본 `./data`) 하나: `db/app.sqlite`, `audio/`, `backups/`. 설정은 `.env` 만.
- 빈 DB 로 처음 띄우면 `CONTENT_DIR`(기본 저장소의 `content/`, 이미지에는 `/app/content`)의 `*.json` 을 공개 상태로 넣는다. 노트가 하나라도 있으면 건드리지 않는다.
- 1GB 서버(퀴즈 v2 와 같이): `deploy/server/compose.yml` + `deploy/server/push-image.sh <호스트>` — 서버에서 빌드하지 않는다.
- 백업: `node apps/server/src/cli.ts backup` (실행 중에도 일관된 사본)
- 이전: [deploy/move.md](deploy/move.md)
