# 실습 2: 백엔드 DB를 SQLite → Docker Compose MySQL로 바꾸기

`exercise.md`에서 만든 FastAPI 백엔드는 SQLite 파일(`backend/data/tetris.db`)을 DB로 씁니다. 이번 실습에서는 **Docker Compose로 MySQL 8.4 컨테이너**를 띄우고, 백엔드가 그 MySQL을 쓰도록 바꿉니다.

바꾸는 것과 바꾸지 않는 것

| 구분 | 내용 |
|---|---|
| 새로 추가 | `docker-compose.yml`, `.env.example`, `mysql-init/01-test-db.sql`, `scripts/sqlite_to_mysql.py` |
| 수정 | `requirements.txt` (MySQL 드라이버), `app/db.py` (연결 옵션), `tests/test_api.py` (MySQL 테스트 지원) |
| **그대로** | `models.py`, `schemas.py`, `security.py`, `main.py`, 프론트엔드 전체 |

SQLAlchemy ORM을 쓰고 있기 때문에 **DB 주소(URL)만 바꾸면** 같은 코드가 MySQL에서도 동작합니다. 이미 `db.py`가 `TETRIS_DATABASE_URL` 환경변수를 읽도록 만들어 두었으므로, 핵심은 "MySQL을 띄우고 → 주소를 넘기는 것"입니다.

```
브라우저 ──► FastAPI (WSL에서 uvicorn, 127.0.0.1:8000)
                 │  mysql+pymysql://tetris:****@127.0.0.1:3306/tetris
                 ▼
          Docker 컨테이너 tetris-mysql (MySQL 8.4, 포트 3306)
                 │
                 ▼
          Docker 볼륨 mysql-data  ← 컨테이너를 지워도 데이터 유지
```

이번 실습은 **DB만 컨테이너**로 옮기고 FastAPI는 지금처럼 WSL에서 실행합니다(코드 수정 → 자동 재시작이 편함). 백엔드까지 컨테이너로 올리는 방법은 마지막 부록에 있습니다.

> 이 문서의 절차는 이 PC(WSL2 Ubuntu 22.04, Docker 29.9, Compose v5.6, MySQL 8.4.13)에서 그대로 실행해 확인했습니다: MySQL 컨테이너 healthy, `tetris`·`tetris_test` DB 생성, pytest 23개 통과(SQLite·MySQL 각각), 기존 SQLite 데이터 이전(회원 1명·기록 2건), MySQL로 서버 실행 후 가입·기록 저장·랭킹 조회, `docker compose down` → `up -d` 후 데이터 유지와 서버 자동 재연결.

---

## 0. Docker 사용 준비 (WSL)

```bash
docker --version          # Docker version 29.x
docker compose version    # Docker Compose version v5.x
docker info               # 서버 정보가 나오면 OK
```

`docker info`에서 아래 오류가 나면 현재 사용자가 `docker` 그룹에 없는 것입니다(이 PC의 현재 상태).

```
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

```bash
sudo usermod -aG docker $USER
# 적용: 터미널을 완전히 닫았다 다시 열기 (또는 PowerShell에서 wsl --shutdown 후 재접속)
groups        # 목록에 docker 가 보여야 함
docker info
```

Docker 데몬이 꺼져 있다는 오류(`Cannot connect to the Docker daemon`)라면:

- WSL 안에 Docker Engine을 설치한 경우: `sudo service docker start`
- Docker Desktop(Windows)을 쓰는 경우: Docker Desktop 실행 → Settings → Resources → WSL integration 에서 Ubuntu 켜기

---

## 1. Docker Compose로 MySQL 띄우기

모든 파일은 `~/work/tetris/backend/` 에 만듭니다.

### 1-1. `backend/.env.example` → `backend/.env`

비밀번호를 compose 파일에 직접 쓰지 않고 `.env`에 둡니다. `docker compose`는 같은 폴더의 `.env`를 자동으로 읽고, uvicorn도 `--env-file`로 같은 파일을 읽게 할 것입니다.

```bash
# 복사해서 사용: cp .env.example .env  (.env 는 git에 올리지 않음)
MYSQL_ROOT_PASSWORD=change-me-root
MYSQL_DATABASE=tetris
MYSQL_USER=tetris
MYSQL_PASSWORD=change-me
MYSQL_PORT=3306

# FastAPI 가 읽는 DB 주소 (비밀번호에 @ : / # 등이 있으면 URL 인코딩 필요)
TETRIS_DATABASE_URL=mysql+pymysql://tetris:change-me@127.0.0.1:3306/tetris?charset=utf8mb4
# pytest 를 MySQL로 돌릴 때만 사용
TEST_DATABASE_URL=mysql+pymysql://tetris:change-me@127.0.0.1:3306/tetris_test?charset=utf8mb4
```

```bash
cd ~/work/tetris/backend
cp .env.example .env
# .env 를 열어 change-me 부분을 원하는 비밀번호로 변경 (TETRIS_DATABASE_URL 안의 비밀번호도 같이!)
```

- `.env`는 이미 `.gitignore`에 들어 있어 커밋되지 않습니다. `.env.example`만 커밋합니다.
- 비밀번호에 `@ : / # ?` 같은 문자가 있으면 URL이 깨집니다. 영문·숫자 위주로 쓰거나 URL 인코딩하세요(`@` → `%40`).
  ```bash
  python3 -c 'import urllib.parse; print(urllib.parse.quote("p@ss:word", safe=""))'   # p%40ss%3Aword
  ```

### 1-2. `backend/docker-compose.yml`

```yaml
services:
  mysql:
    image: mysql:8.4
    container_name: tetris-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?.env 에 MYSQL_ROOT_PASSWORD 를 설정하세요}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-tetris}
      MYSQL_USER: ${MYSQL_USER:-tetris}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?.env 에 MYSQL_PASSWORD 를 설정하세요}
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_0900_ai_ci
    ports:
      - "127.0.0.1:${MYSQL_PORT:-3306}:3306"   # 이 PC에서만 접속 가능
    volumes:
      - mysql-data:/var/lib/mysql               # 컨테이너를 지워도 데이터 유지
      - ./mysql-init:/docker-entrypoint-initdb.d:ro   # 최초 1회 실행되는 SQL
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -p\"$$MYSQL_ROOT_PASSWORD\" --silent"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 30s

volumes:
  mysql-data:
```

| 설정 | 의미 |
|---|---|
| `image: mysql:8.4` | MySQL 8.4 LTS. 랭킹 쿼리의 윈도 함수(`ROW_NUMBER() OVER`)는 MySQL 8.0 이상 필요 |
| `MYSQL_DATABASE/USER/PASSWORD` | 컨테이너 **최초 실행 시** DB `tetris`와 사용자 `tetris`를 만들어 줌 |
| `${VAR:?메시지}` | `.env`에 값이 없으면 실행을 멈추고 메시지 출력 |
| `utf8mb4` | 한글·이모지까지 저장 가능한 문자셋 |
| `127.0.0.1:3306:3306` | 이 PC에서만 접속 가능 (같은 네트워크의 다른 기기에 DB 포트 노출 안 함) |
| `mysql-data` 볼륨 | 데이터가 컨테이너 밖에 저장 → `docker compose down` 해도 유지 |
| `docker-entrypoint-initdb.d` | 볼륨이 **비어 있을 때 최초 1회** 이 폴더의 `.sql` 실행 |
| `healthcheck` | MySQL이 접속 가능해질 때까지 상태를 `starting` → `healthy`로 표시 |

### 1-3. `backend/mysql-init/01-test-db.sql` — 테스트 전용 DB

pytest는 테스트가 끝날 때마다 테이블을 지웁니다. 실제 데이터가 있는 `tetris` DB를 건드리지 않도록 테스트용 DB를 따로 만듭니다.

```sql
-- pytest 전용 DB (실제 데이터가 있는 tetris DB와 분리)
CREATE DATABASE IF NOT EXISTS tetris_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON tetris_test.* TO 'tetris'@'%';
```

### 1-4. 실행과 확인

```bash
cd ~/work/tetris/backend
docker compose up -d                 # 이미지 다운로드 후 백그라운드 실행
docker compose ps                    # STATUS 가 (healthy) 가 될 때까지 기다림 (처음엔 30초~1분)
docker compose logs -f mysql         # "ready for connections" 확인 후 Ctrl+C
```

MySQL 콘솔로 접속해 보기 (컨테이너 안의 mysql 클라이언트 사용, WSL에 설치 불필요):

```bash
docker compose exec mysql mysql -utetris -p tetris
# 비밀번호 입력 후
SHOW DATABASES;        -- tetris, tetris_test 가 보이면 OK
EXIT;
```

자주 쓰는 명령

| 명령 | 동작 |
|---|---|
| `docker compose up -d` | 시작 |
| `docker compose stop` | 멈춤 (데이터 유지) |
| `docker compose down` | 컨테이너 삭제 (볼륨의 데이터는 유지) |
| `docker compose down -v` | **볼륨까지 삭제 = DB 데이터 전부 삭제**, 다음 `up` 때 init SQL 다시 실행 |

---

## 2. 백엔드 코드 수정

### 2-1. MySQL 드라이버 추가 — `backend/requirements.txt`

```text
fastapi
uvicorn[standard]
sqlalchemy>=2.0
pydantic[email]>=2.0
pyjwt
pymysql
cryptography
```

- `pymysql` : 순수 Python MySQL 드라이버 (컴파일·시스템 라이브러리 불필요). URL의 `mysql+pymysql://` 부분이 이 드라이버를 가리킵니다.
- `cryptography` : MySQL 8의 기본 인증 방식(`caching_sha2_password`)에 필요. 없으면 접속 시 `RuntimeError: 'cryptography' package is required for sha256_password or caching_sha2_password auth methods` 오류가 납니다.

```bash
cd ~/work/tetris/backend
uv pip install -p .venv/bin/python -r requirements-dev.txt
```

### 2-2. 연결 옵션 — `backend/app/db.py`

`check_same_thread`는 SQLite 전용 옵션이라 MySQL 드라이버에 넘기면 오류가 납니다. DB 종류에 따라 옵션을 나눕니다.

```python
"""SQLite 연결과 세션 관리."""
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"


class Base(DeclarativeBase):
    pass


def default_database_url() -> str:
    url = os.environ.get("TETRIS_DATABASE_URL")
    if url:
        return url
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{DATA_DIR / 'tetris.db'}"


def make_session_factory(database_url: str):
    is_sqlite = database_url.startswith("sqlite")
    engine = create_engine(
        database_url,
        # SQLite: 여러 스레드에서 연결 사용 허용 / MySQL: 끊긴 연결 자동 감지·재연결
        connect_args={"check_same_thread": False} if is_sqlite else {},
        pool_pre_ping=not is_sqlite,
        pool_recycle=-1 if is_sqlite else 3600,
    )
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
```

| 옵션 | 이유 |
|---|---|
| `check_same_thread=False` (SQLite만) | 그대로 유지 — SQLite로 돌아가거나 테스트할 때 필요 |
| `pool_pre_ping=True` (MySQL) | 커넥션 풀에서 꺼낸 연결이 끊겼는지 먼저 확인하고 재연결. MySQL 재시작 후 첫 요청이 `MySQL server has gone away`로 실패하는 것 방지 |
| `pool_recycle=3600` (MySQL) | MySQL은 오래 놀고 있는 연결을 끊음(`wait_timeout`) → 1시간마다 연결 교체 |

**`models.py`는 수정할 필요가 없습니다.** 처음부터 MySQL을 고려해 두었기 때문입니다.

- `String(254)`, `String(255)`처럼 **길이를 지정**해 두었음 → MySQL은 `VARCHAR`에 길이가 필수 (SQLite는 무시)
- `lines` 컬럼은 MySQL **예약어**지만 SQLAlchemy가 자동으로 `` `lines` ``로 감싸서 SQL을 만듦
- 실제로 MySQL용으로 만들어지는 테이블 SQL (검증 결과):

```sql
CREATE TABLE users (
	id INTEGER NOT NULL AUTO_INCREMENT,
	email VARCHAR(254) NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
CREATE TABLE scores (
	id INTEGER NOT NULL AUTO_INCREMENT,
	user_id INTEGER NOT NULL,
	score INTEGER NOT NULL,
	level INTEGER NOT NULL,
	`lines` INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
)
```

> 참고: MySQL `DATETIME`은 기본적으로 초 단위까지만 저장합니다(SQLite는 마이크로초까지). 같은 초에 끝난 게임의 순서는 `id`로 정렬되므로 동작에는 문제가 없습니다. 밀리초까지 남기고 싶다면 `DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")` 형태로 바꿀 수 있습니다(테이블을 다시 만들어야 함).

### 2-3. 테스트를 MySQL에서도 돌릴 수 있게 — `backend/tests/test_api.py` 앞부분

`TEST_DATABASE_URL`이 있으면 MySQL 테스트 DB를, 없으면 지금처럼 임시 SQLite를 씁니다. 테스트가 끝날 때마다 테이블을 지워 다음 테스트에 영향이 없게 합니다.

```python
import os

import pytest
from fastapi.testclient import TestClient

from app.db import Base
from app.main import create_app, mask_email


@pytest.fixture()
def client(tmp_path):
    # TEST_DATABASE_URL 이 있으면 그 DB(MySQL 테스트 DB), 없으면 테스트마다 새 SQLite 파일
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}"
    app = create_app(database_url=url, secret_key="test-secret-key-for-pytest-0123456789abcdef")
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(app.state.engine)   # 다음 테스트를 위해 테이블 비우기
    app.state.engine.dispose()


def signup(client, email="player@example.com", password="password123"):
    res = client.post("/api/auth/signup", json={"email": email, "password": password})
...
```

---

## 3. FastAPI를 MySQL로 실행

```bash
cd ~/work/tetris/backend
docker compose ps                                   # (healthy) 확인
.venv/bin/uvicorn app.main:app --reload --env-file .env
```

- `--env-file .env` : uvicorn이 `.env`의 `TETRIS_DATABASE_URL`을 읽어 MySQL에 연결합니다(`uvicorn[standard]`에 포함된 `python-dotenv` 사용).
- `--env-file` 없이 실행하면 `TETRIS_DATABASE_URL`이 없으므로 예전처럼 **SQLite**를 씁니다. 두 DB를 쉽게 오갈 수 있습니다.
- 서버가 시작될 때 `create_all`이 `tetris` DB에 `users`, `scores` 테이블을 자동으로 만듭니다.

확인:

```bash
curl -s localhost:8000/api/health
# 회원가입 → 기록 저장 → 랭킹 (exercise.md 5단계의 curl 명령 그대로 사용)

docker compose exec mysql mysql -utetris -p tetris -e "SHOW TABLES; SELECT id, email, LEFT(password_hash,20) FROM users; SELECT * FROM scores ORDER BY id DESC LIMIT 5;"
```

브라우저에서 http://127.0.0.1:8000/ 에 접속해 가입·플레이하고, 위 SQL로 MySQL에 기록이 들어가는지 확인합니다. **컨테이너를 `docker compose down` → `up -d` 해도 기록이 남아 있으면** 볼륨이 제대로 동작하는 것입니다.

---

## 4. 기존 SQLite 데이터를 MySQL로 옮기기 (선택)

지금까지 SQLite에 쌓인 회원·기록을 그대로 가져가려면 아래 스크립트를 씁니다. **빈 MySQL DB**에만 넣고, 이미 데이터가 있으면 중단합니다. 비밀번호는 해시 그대로 옮겨지므로 기존 계정으로 그대로 로그인됩니다.

`backend/scripts/__init__.py` (빈 파일)과 `backend/scripts/sqlite_to_mysql.py`:

```python
"""SQLite 데이터를 MySQL로 옮기기 (users → scores 순서, id 유지).

사용법 (backend 폴더에서):
  .venv/bin/python -m scripts.sqlite_to_mysql sqlite:///data/tetris.db "$TETRIS_DATABASE_URL"
"""
import sys

from sqlalchemy import create_engine, func, select

from app import models  # noqa: F401  (테이블 정의 등록)
from app.db import Base


def migrate(source_url: str, target_url: str) -> None:
    source = create_engine(source_url)
    target = create_engine(target_url)
    Base.metadata.create_all(target)

    with source.connect() as src, target.begin() as dst:
        for table in Base.metadata.sorted_tables:          # 외래키 순서: users → scores
            if dst.execute(select(func.count()).select_from(table)).scalar():
                raise SystemExit(f"대상 DB의 {table.name} 테이블이 비어 있지 않습니다. 중단합니다.")
            rows = [dict(r) for r in src.execute(table.select()).mappings()]
            if rows:
                dst.execute(table.insert(), rows)
            print(f"{table.name}: {len(rows)}건 이전")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    migrate(sys.argv[1], sys.argv[2])
```

```bash
cd ~/work/tetris/backend
docker compose up -d && docker compose ps            # healthy 확인
set -a; source .env; set +a                          # .env 값을 현재 셸에 불러오기
.venv/bin/python -m scripts.sqlite_to_mysql sqlite:///data/tetris.db "$TETRIS_DATABASE_URL"
# users: N건 이전
# scores: M건 이전
```

- 테이블을 외래키 순서(`users` → `scores`)로 옮기고 `id`를 그대로 유지합니다. MySQL의 `AUTO_INCREMENT`는 넣은 id의 최댓값 다음부터 자동으로 이어집니다.
- 서버(uvicorn)가 MySQL로 먼저 실행돼 테이블만 생긴 상태여도 비어 있으면 이전할 수 있습니다. 이미 가입·플레이를 했다면 `docker compose down -v`로 초기화한 뒤 다시 하세요.
- 옮긴 뒤에도 `data/tetris.db`는 지우지 말고 백업으로 두세요.

---

## 5. 테스트

```bash
cd ~/work/tetris/backend

# 1) 평소: SQLite로 빠르게 (AGENTS.md 규칙의 기본 테스트, CI도 이 방식)
.venv/bin/python -m pytest -q
# 23 passed

# 2) MySQL로 한 번 더: 실제 DB와 동작이 같은지 확인
docker compose up -d
set -a; source .env; set +a
.venv/bin/python -m pytest -q          # TEST_DATABASE_URL 이 설정되어 tetris_test DB 사용
```

`tetris_test` DB가 없다는 오류(`Unknown database 'tetris_test'`)가 나면 볼륨이 이미 만들어진 뒤에 init SQL을 추가한 경우입니다. 수동으로 만듭니다.

```bash
docker compose exec mysql mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS tetris_test CHARACTER SET utf8mb4; GRANT ALL PRIVILEGES ON tetris_test.* TO 'tetris'@'%';"
```

> `set -a; source .env` 를 한 터미널에서는 `TETRIS_DATABASE_URL`도 설정되어 있습니다. 이 상태에서 uvicorn을 `--env-file` 없이 실행해도 MySQL을 씁니다. SQLite로 돌아가려면 새 터미널을 여세요.

---

## 6. 정리: 바뀐 파일과 git

```
backend/
├── docker-compose.yml          # 신규 (커밋)
├── .env.example                # 신규 (커밋)
├── .env                        # 신규 (커밋 금지 — .gitignore 에 이미 있음)
├── mysql-init/01-test-db.sql   # 신규 (커밋)
├── scripts/__init__.py         # 신규 (커밋)
├── scripts/sqlite_to_mysql.py  # 신규 (커밋)
├── requirements.txt            # 수정: pymysql, cryptography
├── app/db.py                   # 수정: DB별 연결 옵션
└── tests/test_api.py           # 수정: TEST_DATABASE_URL 지원
```

```bash
cd ~/work/tetris
git status --short                     # .env 가 목록에 없어야 함
npm test && (cd backend && .venv/bin/python -m pytest -q)   # AGENTS.md 규칙
```

README의 실행 방법에 `docker compose up -d`와 `--env-file .env`도 추가해 두세요.

---

## 7. 문제 해결

| 증상 | 원인 · 해결 |
|---|---|
| `permission denied ... /var/run/docker.sock` | 0단계: `sudo usermod -aG docker $USER` 후 터미널 재시작 |
| `required variable MYSQL_ROOT_PASSWORD is missing a value` | `backend/.env` 없음 → `cp .env.example .env`, `backend` 폴더에서 실행했는지 확인 |
| `Bind for 127.0.0.1:3306 failed: port is already allocated` | 3306을 다른 MySQL이 사용 중 → `.env`에서 `MYSQL_PORT=3307`, `TETRIS_DATABASE_URL`의 포트도 3307로 |
| `(2003, "Can't connect to MySQL server on '127.0.0.1'")` | 컨테이너가 아직 시작 중이거나 꺼짐 → `docker compose ps`에서 `(healthy)` 확인 |
| `(1045, "Access denied for user 'tetris'...")` | `.env`의 `MYSQL_PASSWORD`와 URL 속 비밀번호가 다름. **볼륨이 이미 만들어진 뒤 비밀번호를 바꾸면 반영 안 됨** → `docker compose down -v` 후 다시 `up -d` (데이터 삭제됨) |
| `'cryptography' package is required for ... caching_sha2_password` | `cryptography` 설치 누락 → 2-1단계 |
| `TypeError: 'check_same_thread' is an invalid keyword argument` | `db.py`를 2-2단계처럼 수정하지 않음 |
| `(1049, "Unknown database 'tetris_test'")` | 5단계 아래의 수동 생성 명령 실행 |
| 한글이 `???`로 저장됨 | URL 끝 `?charset=utf8mb4` 누락 |
| 서버를 띄웠는데 여전히 SQLite를 씀 | `--env-file .env` 누락. `backend/data/tetris.db` 수정 시각이 바뀌면 SQLite를 쓰는 중 |
| 컨테이너를 지웠더니 데이터가 사라짐 | `down -v`를 쓴 경우(볼륨 삭제). 평소에는 `stop` 또는 `down`(볼륨 유지) |

---

## 부록: FastAPI까지 컨테이너로 실행하기

DB와 백엔드를 한 번에 `docker compose up`으로 띄우고 싶을 때의 구성입니다. 이 경우 백엔드 컨테이너에서 MySQL 주소는 `127.0.0.1`이 아니라 **서비스 이름 `mysql`** 입니다.

`backend/Dockerfile`

```dockerfile
FROM python:3.12-slim
WORKDIR /srv/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY index.html /srv/index.html
COPY src /srv/src
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`main.py`는 `FRONTEND_DIR = Path(__file__).resolve().parents[2]` 로 `index.html`을 찾습니다. 위처럼 `/srv/backend/app/main.py` 구조로 넣으면 `parents[2]`가 `/srv`가 되어 그대로 동작합니다. 이미지에 `index.html`과 `src/`가 함께 들어가야 하므로 빌드 컨텍스트는 프로젝트 루트(`..`)로 잡습니다.

`docker-compose.yml`의 `services:` 아래에 추가:

```yaml
  api:
    build:
      context: ..
      dockerfile: backend/Dockerfile
    container_name: tetris-api
    environment:
      TETRIS_DATABASE_URL: mysql+pymysql://${MYSQL_USER:-tetris}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE:-tetris}?charset=utf8mb4
      TETRIS_SECRET_KEY: ${TETRIS_SECRET_KEY:?.env 에 TETRIS_SECRET_KEY 를 설정하세요}
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      mysql:
        condition: service_healthy     # MySQL이 healthy 가 된 뒤에 시작
```

- 컨테이너는 다시 만들어질 때마다 파일이 초기화되므로 `secret.key` 파일 방식 대신 `.env`에 `TETRIS_SECRET_KEY`를 꼭 넣습니다(`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`로 생성).
- 실행: `docker compose up -d --build` → http://127.0.0.1:8000/
- 이 경우 코드를 고칠 때마다 `--build`로 이미지를 다시 만들어야 하므로, 개발 중에는 본문처럼 DB만 컨테이너로 쓰는 편이 편합니다.
