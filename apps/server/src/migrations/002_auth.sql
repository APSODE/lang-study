-- 로그인 · 초대 가입
-- 이름은 대소문자를 구분하지 않고 고유하다 (Hana 와 hana 는 같은 이름).
CREATE UNIQUE INDEX users_name_nocase ON users(name COLLATE NOCASE);
-- 사용자 삭제 · 로그아웃 정리, 만료 세션 청소
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);
