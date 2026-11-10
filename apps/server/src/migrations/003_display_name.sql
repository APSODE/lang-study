-- 닉네임(표시 이름). 로그인 이름(name)은 그대로 두고, 다른 사람과 나에게 보이는 이름은 display_name ?? name.
-- 비어 있으면(NULL) 로그인 이름을 보여 준다. 대소문자를 구분하지 않고 고유하다 (로그인 이름과의 충돌은 앱이 막는다).
ALTER TABLE users ADD COLUMN display_name TEXT;
CREATE UNIQUE INDEX users_display_name_nocase ON users(lower(display_name)) WHERE display_name IS NOT NULL;
