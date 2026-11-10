# 실습: 테트리스에 FastAPI + SQLite 백엔드 붙이기

브라우저 테트리스(`index.html`)에 **FastAPI** 백엔드와 **SQLite** DB를 연결해서 아래 기능을 만드는 과정입니다.

- 이메일 + 비밀번호로 **회원가입**하고, 가입한 회원만 **로그인**할 수 있다
- **로그인해야 게임을 플레이**할 수 있다
- 사용자가 **플레이할 때마다 기록**(점수·레벨·줄 수)을 DB에 남긴다
- **전체 사용자 중 최고 점수**와 TOP 5 랭킹, 내 최고 기록을 화면에 표시한다
- 백엔드가 없는 곳(GitHub Pages, 파일로 직접 열기)에서는 **오프라인 모드**로 게임만 동작한다

작업 폴더: `~/work/tetris` · 실행 환경: WSL2 Ubuntu 22.04, Python 3.10, Node.js(nvm), `uv`

---

## 0. 전체 구조

```
브라우저 (index.html)
  │  fetch("/api/...")  + Authorization: Bearer <JWT>
  ▼
FastAPI (backend/app/main.py)  ── uvicorn 으로 실행, 게임 화면(index.html)도 같이 서빙
  │  SQLAlchemy ORM (Session)
  ▼
SQLite 파일 (backend/data/tetris.db)
  ├─ users  : id, email(unique), password_hash, created_at
  └─ scores : id, user_id → users.id, score, level, lines, created_at
```

FastAPI가 게임 화면과 API를 **같은 주소(http://127.0.0.1:8000)** 에서 제공하므로 CORS 설정이 필요 없습니다.

### API 목록

| 메서드 | 경로 | 로그인 | 설명 |
|---|---|---|---|
| GET | `/api/health` | - | 서버 동작 확인 (프론트가 백엔드 유무 판단에 사용) |
| POST | `/api/auth/signup` | - | 회원가입 → 토큰 발급 |
| POST | `/api/auth/login` | - | 로그인 → 토큰 발급 |
| GET | `/api/auth/me` | 필요 | 내 정보 |
| POST | `/api/scores` | 필요 | 게임 한 판 기록 저장 |
| GET | `/api/scores/me` | 필요 | 내 최고 기록, 플레이 횟수, 최근 기록 |
| GET | `/api/leaderboard` | - | 전체 랭킹 (사용자별 최고 기록, 이메일 일부 가림) |

### 최종 파일 구성

```
~/work/tetris
├── index.html                 # 게임 + 로그인 화면 + 랭킹 표시 (수정)
├── src/
│   ├── tetris-core.js         # 게임 로직 (기존)
│   └── api-client.js          # 백엔드 API 호출 (신규)
├── tests/
│   └── api-client.test.js     # API 클라이언트 Jest 테스트 (신규)
└── backend/                   # (신규)
    ├── requirements.txt
    ├── requirements-dev.txt
    ├── pytest.ini
    ├── app/
    │   ├── __init__.py
    │   ├── db.py              # SQLite 연결 ← FastAPI–SQLite 연동의 핵심
    │   ├── models.py          # 테이블 정의
    │   ├── schemas.py         # 요청/응답 검증
    │   ├── security.py        # 비밀번호 해시, JWT
    │   └── main.py            # API 라우트, 프론트 서빙
    ├── tests/
    │   ├── __init__.py
    │   └── test_api.py
    └── data/                  # 실행 시 자동 생성 (git 제외)
        ├── tetris.db
        └── secret.key
```

---

## 1. Python 가상환경과 패키지 설치

Ubuntu 22.04 기본 Python에는 `ensurepip`이 없어 `python3 -m venv`가 실패할 수 있습니다. 이미 설치된 `uv`로 가상환경을 만듭니다.

```bash
mkdir -p ~/work/tetris/backend/app ~/work/tetris/backend/tests
cd ~/work/tetris/backend
touch app/__init__.py tests/__init__.py
```

`backend/requirements.txt`

```text
fastapi
uvicorn[standard]
sqlalchemy>=2.0
pydantic[email]>=2.0
pyjwt
```

`backend/requirements-dev.txt` (테스트용 추가 패키지)

```text
-r requirements.txt
pytest
httpx
```

```bash
uv venv .venv
uv pip install -p .venv/bin/python -r requirements-dev.txt
.venv/bin/python -c "import fastapi, sqlalchemy; print(fastapi.__version__, sqlalchemy.__version__)"
```

| 패키지 | 역할 |
|---|---|
| `fastapi` | API 서버 프레임워크 |
| `uvicorn[standard]` | FastAPI를 실행하는 ASGI 서버 |
| `sqlalchemy` | Python 객체 ↔ SQLite 테이블 매핑(ORM) |
| `pydantic[email]` | 요청 데이터 검증 (`EmailStr` 이메일 형식 검사 포함) |
| `pyjwt` | 로그인 토큰(JWT) 발급·검증 |
| `pytest`, `httpx` | API 테스트 (`TestClient`가 `httpx` 사용) |

> SQLite는 Python 표준 라이브러리(`sqlite3`)에 들어 있어 따로 설치할 필요가 없습니다. DB 서버도 없이 **파일 하나**(`tetris.db`)가 DB입니다.

`.gitignore`에 추가 (가상환경, DB 파일, 비밀키는 커밋하지 않음):

```text
backend/.venv/
backend/data/
__pycache__/
.pytest_cache/
*.db
.env
```

---

## 2. FastAPI ↔ SQLite 연동 (핵심)

연동은 아래 4단계로 이뤄집니다.

1. **엔진(Engine)** 만들기 — `create_engine("sqlite:///경로/tetris.db")` : 어떤 DB 파일에 연결할지
2. **테이블 생성** — `Base.metadata.create_all(engine)` : 모델 클래스를 보고 테이블이 없으면 생성
3. **세션 팩토리** — `sessionmaker(bind=engine)` : 요청마다 DB 작업 단위(Session)를 만드는 공장
4. **의존성 주입** — FastAPI `Depends(get_db)` : 요청이 들어오면 세션을 열어 라우트 함수에 넘기고, 끝나면 닫기

### 2-1. `backend/app/db.py` — 엔진·세션

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
    engine = create_engine(database_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
```

포인트

- `sqlite:///` 뒤에 **절대 경로**가 붙어 `sqlite:////home/ubuntu/work/tetris/backend/data/tetris.db` 형태가 됩니다(슬래시 4개). 상대 경로를 쓰면 uvicorn을 실행한 위치에 따라 DB 파일이 여러 개 생길 수 있습니다.
- `check_same_thread=False` : FastAPI는 요청을 여러 스레드에서 처리하는데, `sqlite3`는 기본적으로 "연결을 만든 스레드에서만 사용"하도록 막습니다. 요청마다 세션을 따로 쓰므로 이 검사를 끕니다.
- `TETRIS_DATABASE_URL` 환경변수로 DB 위치를 바꿀 수 있어서, 테스트는 임시 DB를 씁니다.
- `create_all`은 **없는 테이블만 생성**합니다. 나중에 컬럼을 추가·변경하려면 DB 파일을 지우고 다시 만들거나 Alembic 같은 마이그레이션 도구가 필요합니다.

### 2-2. `backend/app/models.py` — 테이블 정의

```python
"""DB 테이블 정의: 회원(users)과 게임 기록(scores)."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    scores: Mapped[list["Score"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Score(Base):
    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    score: Mapped[int] = mapped_column(Integer, index=True)
    level: Mapped[int] = mapped_column(Integer)
    lines: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="scores")
```

- 클래스 하나 = 테이블 하나, `Mapped[...]` 속성 하나 = 컬럼 하나입니다.
- `email`의 `unique=True` 덕분에 같은 이메일로 두 번 가입하면 DB가 `IntegrityError`를 냅니다 → API에서 409로 변환합니다.
- `scores.user_id`는 `users.id`를 가리키는 외래키입니다. 한 사용자가 여러 판의 기록을 가집니다(1:N).

### 2-3. 라우트에서 DB 사용하기 (`main.py` 발췌)

```python
engine, SessionLocal = make_session_factory(database_url or default_database_url())

def get_db():
    db = SessionLocal()      # 요청 시작: 세션 열기
    try:
        yield db             # 라우트 함수에 전달
    finally:
        db.close()           # 요청 끝: 세션 닫기 (오류가 나도 실행)

DB = Annotated[Session, Depends(get_db)]

@app.post("/api/scores", ...)
def save_score(body: schemas.ScoreIn, user: CurrentUser, db: DB):
    record = models.Score(user_id=user.id, **body.model_dump())
    db.add(record)           # INSERT 준비
    db.commit()              # 실제로 파일에 기록
    return record            # id, created_at 이 채워진 객체 → JSON 응답
```

조회는 `select()` 문을 만들어 `db.scalar()`(한 건) / `db.scalars().all()`(여러 건) / `db.execute()`(여러 컬럼)로 실행합니다.

```python
user = db.scalar(select(models.User).where(models.User.email == body.email))
```

---

## 3. 회원가입·로그인 (비밀번호와 토큰)

### 3-1. `backend/app/security.py`

```python
"""비밀번호 해시와 JWT 토큰 발급/검증."""
import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from .db import DATA_DIR

ALGORITHM = "HS256"
TOKEN_TTL = timedelta(hours=int(os.environ.get("TETRIS_TOKEN_HOURS", "24")))

# scrypt 파라미터 (표준 라이브러리만 사용)
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return "scrypt${}${}".format(base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_b64, digest_b64 = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    salt = base64.b64decode(salt_b64)
    expected = base64.b64decode(digest_b64)
    actual = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return hmac.compare_digest(actual, expected)


def load_secret_key() -> str:
    """환경변수 TETRIS_SECRET_KEY, 없으면 backend/data/secret.key 를 만들어 재사용."""
    key = os.environ.get("TETRIS_SECRET_KEY")
    if key:
        return key
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "secret.key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48))
        path.chmod(0o600)
    return path.read_text().strip()


def create_access_token(user_id: int, secret: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + TOKEN_TTL}
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> int | None:
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
```

- **비밀번호는 절대 그대로 저장하지 않습니다.** 사용자마다 다른 salt를 붙여 `scrypt`로 해시한 값만 저장합니다(`scrypt$<salt>$<hash>`). 표준 라이브러리 `hashlib`만 쓰므로 추가 설치가 없습니다.
- 비교는 `hmac.compare_digest`로 합니다(비교 시간으로 정보가 새지 않게).
- 로그인에 성공하면 **JWT**를 발급합니다. 토큰 안에 사용자 id(`sub`)와 만료 시각(`exp`, 기본 24시간)이 들어 있고 비밀키로 서명되어 위조할 수 없습니다.
- 비밀키는 `TETRIS_SECRET_KEY` 환경변수, 없으면 처음 실행 때 `backend/data/secret.key`를 만들어 재사용합니다(서버를 재시작해도 로그인 유지). 이 파일은 git에 올리지 않습니다.

### 3-2. `backend/app/schemas.py` — 입력 검증

```python
"""요청/응답 데이터 형식."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ScoreIn(BaseModel):
    score: int = Field(ge=0, le=99_999_999)
    level: int = Field(ge=1, le=999)
    lines: int = Field(ge=0, le=9_999)

    @model_validator(mode="after")
    def level_matches_lines(self):
        # 프론트 규칙과 동일: 10줄마다 레벨 +1
        if self.level != self.lines // 10 + 1:
            raise ValueError("level does not match lines")
        return self


class ScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    score: int
    level: int
    lines: int
    created_at: datetime


class MyScoresOut(BaseModel):
    best: ScoreOut | None
    games_played: int
    recent: list[ScoreOut]


class LeaderboardEntry(BaseModel):
    rank: int
    player: str
    score: int
    level: int
    lines: int
    created_at: datetime
```

- `EmailStr` : 이메일 형식이 아니면 FastAPI가 자동으로 **422** 응답
- `password` 8~128자
- 이메일은 소문자로 정규화 → `Player@Example.com` 과 `player@example.com` 은 같은 회원
- `ScoreIn` : 음수 점수, 줄 수와 맞지 않는 레벨(10줄마다 +1 규칙) 같은 이상한 기록을 거부

---

## 4. API 라우트 — `backend/app/main.py`

```python
"""Tetris 백엔드 (FastAPI + SQLite).

실행:  cd backend && .venv/bin/uvicorn app.main:app --reload
접속:  http://127.0.0.1:8000/   (게임 화면)
문서:  http://127.0.0.1:8000/docs (API 문서)
"""
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, schemas
from .db import default_database_url, make_session_factory
from .security import create_access_token, decode_access_token, hash_password, load_secret_key, verify_password

FRONTEND_DIR = Path(__file__).resolve().parents[2]   # ~/work/tetris
bearer = HTTPBearer(auto_error=False)


def mask_email(email: str) -> str:
    """랭킹에 공개할 때 이메일 일부를 가림: player@example.com -> pl****@example.com"""
    local, _, domain = email.partition("@")
    return f"{local[:2]}{'*' * max(len(local) - 2, 2)}@{domain}"


def create_app(database_url: str | None = None, secret_key: str | None = None) -> FastAPI:
    app = FastAPI(title="BLOCK//DROP Tetris API")
    engine, SessionLocal = make_session_factory(database_url or default_database_url())
    secret = secret_key or load_secret_key()
    app.state.engine = engine

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    DB = Annotated[Session, Depends(get_db)]

    def current_user(
        db: DB,
        creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> models.User:
        user_id = decode_access_token(creds.credentials, secret) if creds else None
        user = db.get(models.User, user_id) if user_id else None
        if user is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다.", headers={"WWW-Authenticate": "Bearer"}
            )
        return user

    CurrentUser = Annotated[models.User, Depends(current_user)]

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    # ---------- 회원 ----------
    @app.post("/api/auth/signup", response_model=schemas.TokenOut, status_code=status.HTTP_201_CREATED)
    def signup(body: schemas.Credentials, db: DB):
        user = models.User(email=body.email, password_hash=hash_password(body.password))
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입된 이메일입니다.")
        return {"access_token": create_access_token(user.id, secret), "user": user}

    @app.post("/api/auth/login", response_model=schemas.TokenOut)
    def login(body: schemas.Credentials, db: DB):
        user = db.scalar(select(models.User).where(models.User.email == body.email))
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "이메일 또는 비밀번호가 올바르지 않습니다.")
        return {"access_token": create_access_token(user.id, secret), "user": user}

    @app.get("/api/auth/me", response_model=schemas.UserOut)
    def me(user: CurrentUser):
        return user

    # ---------- 기록 ----------
    @app.post("/api/scores", response_model=schemas.ScoreOut, status_code=status.HTTP_201_CREATED)
    def save_score(body: schemas.ScoreIn, user: CurrentUser, db: DB):
        record = models.Score(user_id=user.id, **body.model_dump())
        db.add(record)
        db.commit()
        return record

    @app.get("/api/scores/me", response_model=schemas.MyScoresOut)
    def my_scores(user: CurrentUser, db: DB, limit: int = 10):
        limit = max(1, min(limit, 50))
        mine = select(models.Score).where(models.Score.user_id == user.id)
        best = db.scalar(mine.order_by(models.Score.score.desc(), models.Score.created_at).limit(1))
        recent = db.scalars(mine.order_by(models.Score.created_at.desc(), models.Score.id.desc()).limit(limit)).all()
        played = db.scalar(select(func.count()).select_from(models.Score).where(models.Score.user_id == user.id))
        return {"best": best, "games_played": played, "recent": recent}

    @app.get("/api/leaderboard", response_model=list[schemas.LeaderboardEntry])
    def leaderboard(db: DB, limit: int = 10):
        """전체 사용자 랭킹: 사용자별 최고 기록 1개씩, 점수 내림차순."""
        limit = max(1, min(limit, 50))
        ranked = (
            select(
                models.Score,
                func.row_number()
                .over(partition_by=models.Score.user_id, order_by=(models.Score.score.desc(), models.Score.created_at))
                .label("rn"),
            ).subquery()
        )
        best_per_user = (
            select(ranked, models.User.email)
            .join(models.User, models.User.id == ranked.c.user_id)
            .where(ranked.c.rn == 1)
            .order_by(ranked.c.score.desc(), ranked.c.created_at)
            .limit(limit)
        )
        rows = db.execute(best_per_user).mappings().all()
        return [
            {
                "rank": i + 1,
                "player": mask_email(row["email"]),
                "score": row["score"],
                "level": row["level"],
                "lines": row["lines"],
                "created_at": row["created_at"],
            }
            for i, row in enumerate(rows)
        ]

    # ---------- 프론트엔드 서빙 (같은 주소에서 /api 호출 → CORS 불필요) ----------
    # 프로젝트 루트 전체를 공개하지 않고 필요한 파일만 서빙 (backend/data, node_modules 노출 방지)
    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(FRONTEND_DIR / "index.html")

    app.mount("/src", StaticFiles(directory=FRONTEND_DIR / "src"), name="src")
    return app


app = create_app()
```

포인트

- **로그인 필요 API**는 `user: CurrentUser`를 인자로 받기만 하면 됩니다. `current_user`가 `Authorization: Bearer <토큰>` 헤더를 검사해서, 없거나 잘못됐으면 401을 냅니다.
- **"플레이할 때마다 기록"** : `POST /api/scores`는 매번 새 행을 INSERT합니다(덮어쓰지 않음). 그래서 `/api/scores/me`의 `games_played`가 플레이 횟수가 됩니다.
- **"전체 사용자 중 최고 점수"** : `/api/leaderboard`는 윈도 함수 `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC)`로 사용자별 최고 기록 1건만 뽑아 점수순으로 정렬합니다. 한 사람이 랭킹을 독차지하지 않습니다. 첫 번째 항목이 전체 최고 점수입니다.
- 랭킹은 로그인 없이 볼 수 있으므로 이메일을 `pl****@example.com`처럼 가려서 내보냅니다.
- 프론트 서빙: 프로젝트 루트 전체를 `StaticFiles`로 열면 `backend/data/tetris.db`, `secret.key`까지 다운로드될 수 있습니다. 그래서 `/`(index.html)와 `/src`만 엽니다.
- `create_app()` 함수로 앱을 만드는 이유: 테스트에서 임시 DB·비밀키를 넣어 독립된 앱을 만들 수 있게 하기 위해서입니다.

---

## 5. 백엔드 실행과 확인

```bash
cd ~/work/tetris/backend
.venv/bin/uvicorn app.main:app --reload
```

- 게임: http://127.0.0.1:8000/
- 자동 생성 API 문서(Swagger UI): http://127.0.0.1:8000/docs — 화면에서 직접 API를 호출해 볼 수 있습니다.

다른 터미널에서 curl로 확인:

```bash
# 회원가입
curl -s -X POST localhost:8000/api/auth/signup -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"password123"}'

# 로그인 → 토큰 저장
TOKEN=$(curl -s -X POST localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"password123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 기록 저장 (lines 12 → level 2)
curl -s -X POST localhost:8000/api/scores -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"score":1500,"level":2,"lines":12}'

# 내 기록 / 전체 랭킹
curl -s localhost:8000/api/scores/me -H "Authorization: Bearer $TOKEN"
curl -s localhost:8000/api/leaderboard
```

### SQLite 파일 직접 들여다보기

`sqlite3` 명령이 없으면 Python으로 봅니다(또는 `sudo apt install sqlite3`).

```bash
python3 - <<'EOF'
import sqlite3
c = sqlite3.connect("/home/ubuntu/work/tetris/backend/data/tetris.db")
print(c.execute("select name from sqlite_master where type='table'").fetchall())
print(c.execute("select id, email, substr(password_hash,1,20) from users").fetchall())
print(c.execute("select * from scores order by id desc limit 5").fetchall())
EOF
```

`password_hash`가 `scrypt$...`로 시작하고 원래 비밀번호가 보이지 않으면 정상입니다. DB를 초기화하려면 서버를 끄고 `backend/data/tetris.db`를 지우면 됩니다(다음 실행 때 빈 테이블이 다시 생성됨).

---

## 6. 백엔드 테스트 (pytest)

`backend/pytest.ini`

```ini
[pytest]
testpaths = tests
pythonpath = .
```

`backend/tests/test_api.py`

```python
import pytest
from fastapi.testclient import TestClient

from app.main import create_app, mask_email


@pytest.fixture()
def client(tmp_path):
    app = create_app(database_url=f"sqlite:///{tmp_path / 'test.db'}", secret_key="test-secret-key-for-pytest-0123456789abcdef")
    with TestClient(app) as c:
        yield c


def signup(client, email="player@example.com", password="password123"):
    res = client.post("/api/auth/signup", json={"email": email, "password": password})
    assert res.status_code == 201, res.text
    return res.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def play(client, token, score, lines=0):
    res = client.post("/api/scores", json={"score": score, "level": lines // 10 + 1, "lines": lines}, headers=auth(token))
    assert res.status_code == 201, res.text
    return res.json()


# ---------- 회원가입 / 로그인 ----------

def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_signup_returns_token_and_user(client):
    res = client.post("/api/auth/signup", json={"email": "New@Example.com", "password": "password123"})
    assert res.status_code == 201
    body = res.json()
    assert body["access_token"]
    assert body["user"]["email"] == "new@example.com"   # 소문자로 정규화


def test_signup_duplicate_email_rejected(client):
    signup(client)
    res = client.post("/api/auth/signup", json={"email": "PLAYER@example.com", "password": "password123"})
    assert res.status_code == 409


@pytest.mark.parametrize("payload", [
    {"email": "not-an-email", "password": "password123"},
    {"email": "a@example.com", "password": "short"},
    {"email": "a@example.com"},
])
def test_signup_validation(client, payload):
    assert client.post("/api/auth/signup", json=payload).status_code == 422


def test_login_success_and_me(client):
    signup(client)
    res = client.post("/api/auth/login", json={"email": "player@example.com", "password": "password123"})
    assert res.status_code == 200
    token = res.json()["access_token"]
    me = client.get("/api/auth/me", headers=auth(token))
    assert me.status_code == 200
    assert me.json()["email"] == "player@example.com"


def test_login_requires_signup(client):
    res = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "password123"})
    assert res.status_code == 401


def test_login_wrong_password(client):
    signup(client)
    res = client.post("/api/auth/login", json={"email": "player@example.com", "password": "wrongpass1"})
    assert res.status_code == 401


def test_password_is_not_stored_in_plain_text(client):
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from app.models import User

    signup(client)
    with Session(client.app.state.engine) as db:
        user = db.scalar(select(User))
    assert "password123" not in user.password_hash
    assert user.password_hash.startswith("scrypt$")


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid.token.value"}])
def test_protected_endpoints_require_login(client, headers):
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.get("/api/scores/me", headers=headers).status_code == 401
    res = client.post("/api/scores", json={"score": 1, "level": 1, "lines": 0}, headers=headers)
    assert res.status_code == 401


# ---------- 기록 저장 ----------

def test_every_game_is_recorded(client):
    token = signup(client)
    play(client, token, 100, lines=1)
    play(client, token, 500, lines=12)
    play(client, token, 300, lines=4)

    res = client.get("/api/scores/me", headers=auth(token)).json()
    assert res["games_played"] == 3
    assert res["best"]["score"] == 500
    assert [s["score"] for s in res["recent"]] == [300, 500, 100]   # 최신순


def test_my_scores_empty(client):
    token = signup(client)
    res = client.get("/api/scores/me", headers=auth(token)).json()
    assert res == {"best": None, "games_played": 0, "recent": []}


@pytest.mark.parametrize("payload", [
    {"score": -1, "level": 1, "lines": 0},
    {"score": 100, "level": 0, "lines": 0},
    {"score": 100, "level": 5, "lines": 3},    # 레벨과 줄 수가 맞지 않음
])
def test_invalid_score_rejected(client, payload):
    token = signup(client)
    assert client.post("/api/scores", json=payload, headers=auth(token)).status_code == 422


def test_scores_are_per_user(client):
    a = signup(client, "a@example.com")
    b = signup(client, "b@example.com")
    play(client, a, 900)
    assert client.get("/api/scores/me", headers=auth(b)).json()["games_played"] == 0


# ---------- 전체 랭킹 ----------

def test_leaderboard_public_and_empty(client):
    res = client.get("/api/leaderboard")
    assert res.status_code == 200
    assert res.json() == []


def test_leaderboard_best_score_per_user_sorted(client):
    a = signup(client, "alice@example.com")
    b = signup(client, "bob@example.com")
    play(client, a, 300)
    play(client, a, 1200, lines=10)
    play(client, b, 800)

    board = client.get("/api/leaderboard").json()
    assert [(e["rank"], e["score"]) for e in board] == [(1, 1200), (2, 800)]
    assert board[0]["player"] == "al***@example.com"
    assert "alice" not in board[0]["player"]


def test_leaderboard_limit(client):
    for i in range(5):
        play(client, signup(client, f"user{i}@example.com"), i * 100)
    board = client.get("/api/leaderboard?limit=3").json()
    assert [e["score"] for e in board] == [400, 300, 200]


def test_mask_email():
    assert mask_email("player@example.com") == "pl****@example.com"
    assert mask_email("ab@x.io") == "ab**@x.io"
    assert mask_email("a@x.io") == "a**@x.io"


# ---------- 프론트엔드 서빙 ----------

def test_serves_frontend_but_not_backend_files(client):
    assert client.get("/").status_code == 200
    assert client.get("/src/tetris-core.js").status_code == 200
    assert client.get("/backend/data/tetris.db").status_code == 404
    assert client.get("/package.json").status_code == 404
```

- `tmp_path` 픽스처로 **테스트마다 새 SQLite 파일**을 써서 실제 DB(`data/tetris.db`)를 건드리지 않고, 테스트끼리 영향을 주지 않습니다.
- `TestClient`는 서버를 띄우지 않고 앱을 직접 호출합니다.

```bash
cd ~/work/tetris/backend
.venv/bin/python -m pytest -q
# 23 passed
```

---

## 7. 프론트엔드 연동

### 7-1. `src/api-client.js` — API 호출 모듈

화면 코드와 분리해서 Jest로 테스트할 수 있게 만듭니다. `tetris-core.js`와 같은 방식으로 브라우저(`window.TetrisApi`)와 Jest(`require`) 양쪽에서 쓸 수 있습니다.

```js
(function (root) {
  "use strict";

  const TOKEN_KEY = "tetris.token";

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  // FastAPI 오류 응답(detail)을 사람이 읽을 수 있는 메시지로 변환
  function errorMessage(status, body) {
    const detail = body && body.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      const field = detail[0].loc ? detail[0].loc[detail[0].loc.length - 1] : "";
      if (field === "email") return "올바른 이메일 주소를 입력하세요.";
      if (field === "password") return "비밀번호는 8자 이상이어야 합니다.";
      return "입력값을 확인하세요.";
    }
    return `요청에 실패했습니다. (${status})`;
  }

  function safeStorage(storage) {
    return {
      get(key) { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } },
      set(key, value) { try { if (storage) storage.setItem(key, value); } catch (e) { /* 저장 불가 환경 */ } },
      remove(key) { try { if (storage) storage.removeItem(key); } catch (e) { /* 저장 불가 환경 */ } },
    };
  }

  function createApiClient({ baseUrl = "", fetchImpl, storage } = {}) {
    const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    const store = safeStorage(storage);
    let token = store.get(TOKEN_KEY);

    async function request(method, path, body) {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await doFetch(baseUrl + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) setToken(null);
        throw new ApiError(res.status, errorMessage(res.status, data));
      }
      return data;
    }

    function setToken(value) {
      token = value || null;
      if (token) store.set(TOKEN_KEY, token);
      else store.remove(TOKEN_KEY);
    }

    async function authenticate(path, email, password) {
      const data = await request("POST", path, { email, password });
      setToken(data.access_token);
      return data.user;
    }

    return {
      get token() { return token; },
      isLoggedIn: () => Boolean(token),

      // 백엔드가 없으면(GitHub Pages, file://) false → 오프라인 모드
      async isAvailable() {
        try {
          const data = await request("GET", "/api/health");
          return Boolean(data && data.status === "ok");
        } catch (e) {
          return false;
        }
      },

      signup: (email, password) => authenticate("/api/auth/signup", email, password),
      login: (email, password) => authenticate("/api/auth/login", email, password),
      logout: () => setToken(null),
      me: () => request("GET", "/api/auth/me"),

      saveScore: ({ score, level, lines }) => request("POST", "/api/scores", { score, level, lines }),
      myScores: (limit = 10) => request("GET", `/api/scores/me?limit=${limit}`),
      leaderboard: (limit = 5) => request("GET", `/api/leaderboard?limit=${limit}`),
    };
  }

  const api = { createApiClient, ApiError, TOKEN_KEY };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.TetrisApi = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- `baseUrl`이 빈 문자열이라 `/api/...`로 **같은 주소**에 요청합니다.
- 토큰은 `localStorage`에 저장해 새로고침해도 로그인이 유지됩니다. 401을 받으면 만료된 토큰을 지웁니다.
- `isAvailable()` : GitHub Pages에서는 `/api/health`가 404, 파일로 열면 네트워크 오류 → `false` → 오프라인 모드.

### 7-2. `tests/api-client.test.js` — Jest 테스트

`fetch`를 `jest.fn()`으로 바꿔 서버 없이 요청 URL·헤더·본문과 오류 처리를 검사합니다.

```js
const { createApiClient, ApiError, TOKEN_KEY } = require("../src/api-client");

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockFetch(...responses) {
  const fn = jest.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  return fn;
}

describe("인증", () => {
  test("회원가입하면 토큰을 저장하고 사용자 정보를 반환", async () => {
    const storage = memoryStorage();
    const fetchImpl = mockFetch(jsonResponse(201, { access_token: "tok", user: { id: 1, email: "a@b.com" } }));
    const api = createApiClient({ fetchImpl, storage });

    const user = await api.signup("a@b.com", "password123");

    expect(user.email).toBe("a@b.com");
    expect(api.isLoggedIn()).toBe(true);
    expect(storage.data[TOKEN_KEY]).toBe("tok");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/auth/signup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.com", password: "password123" });
  });

  test("로그인 실패 시 서버 메시지로 ApiError, 토큰 없음", async () => {
    const fetchImpl = mockFetch(jsonResponse(401, { detail: "이메일 또는 비밀번호가 올바르지 않습니다." }));
    const api = createApiClient({ fetchImpl, storage: memoryStorage() });

    await expect(api.login("a@b.com", "wrongpass")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "이메일 또는 비밀번호가 올바르지 않습니다.",
    });
    expect(api.isLoggedIn()).toBe(false);
  });

  test("입력 검증 오류(422)를 한국어 메시지로 변환", async () => {
    const fetchImpl = mockFetch(jsonResponse(422, { detail: [{ loc: ["body", "password"], msg: "too short" }] }));
    const api = createApiClient({ fetchImpl, storage: memoryStorage() });
    await expect(api.signup("a@b.com", "short")).rejects.toThrow("비밀번호는 8자 이상이어야 합니다.");
  });

  test("저장된 토큰을 Authorization 헤더로 보낸다", async () => {
    const fetchImpl = mockFetch(jsonResponse(200, { id: 1, email: "a@b.com" }));
    const api = createApiClient({ fetchImpl, storage: memoryStorage({ [TOKEN_KEY]: "saved" }) });

    await api.me();

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer saved");
  });

  test("401 응답을 받으면 만료된 토큰을 지운다", async () => {
    const storage = memoryStorage({ [TOKEN_KEY]: "expired" });
    const api = createApiClient({ fetchImpl: mockFetch(jsonResponse(401, { detail: "로그인이 필요합니다." })), storage });

    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(api.isLoggedIn()).toBe(false);
    expect(storage.data[TOKEN_KEY]).toBeUndefined();
  });

  test("로그아웃하면 토큰 삭제", () => {
    const storage = memoryStorage({ [TOKEN_KEY]: "saved" });
    const api = createApiClient({ fetchImpl: jest.fn(), storage });
    api.logout();
    expect(api.isLoggedIn()).toBe(false);
    expect(storage.data[TOKEN_KEY]).toBeUndefined();
  });

  test("localStorage 접근이 막힌 환경에서도 동작", async () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    const fetchImpl = mockFetch(jsonResponse(200, { access_token: "tok", user: { id: 1 } }));
    const api = createApiClient({ fetchImpl, storage: broken });
    await api.login("a@b.com", "password123");
    expect(api.isLoggedIn()).toBe(true);
  });
});

describe("기록과 랭킹", () => {
  test("게임 기록 저장 요청", async () => {
    const fetchImpl = mockFetch(jsonResponse(201, { id: 3, score: 1200, level: 2, lines: 11 }));
    const api = createApiClient({ fetchImpl, storage: memoryStorage({ [TOKEN_KEY]: "t" }) });

    await api.saveScore({ score: 1200, level: 2, lines: 11 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/scores");
    expect(JSON.parse(init.body)).toEqual({ score: 1200, level: 2, lines: 11 });
  });

  test("랭킹과 내 기록 조회 URL", async () => {
    const fetchImpl = mockFetch(jsonResponse(200, []), jsonResponse(200, { best: null, games_played: 0, recent: [] }));
    const api = createApiClient({ baseUrl: "http://localhost:8000", fetchImpl, storage: memoryStorage() });

    await api.leaderboard(5);
    await api.myScores(3);

    expect(fetchImpl.mock.calls[0][0]).toBe("http://localhost:8000/api/leaderboard?limit=5");
    expect(fetchImpl.mock.calls[1][0]).toBe("http://localhost:8000/api/scores/me?limit=3");
  });
});

describe("백엔드 사용 가능 여부", () => {
  test("health 가 ok 면 true", async () => {
    const api = createApiClient({ fetchImpl: mockFetch(jsonResponse(200, { status: "ok" })), storage: memoryStorage() });
    await expect(api.isAvailable()).resolves.toBe(true);
  });

  test("404(GitHub Pages)나 네트워크 오류면 false", async () => {
    const notFound = createApiClient({ fetchImpl: mockFetch(jsonResponse(404, null)), storage: memoryStorage() });
    const offline = createApiClient({ fetchImpl: jest.fn().mockRejectedValue(new TypeError("Failed to fetch")), storage: memoryStorage() });
    await expect(notFound.isAvailable()).resolves.toBe(false);
    await expect(offline.isAvailable()).resolves.toBe(false);
  });
});
```

### 7-3. `index.html` 수정

**① 스크립트 추가** (`tetris-core.js` 다음)

```html
<script src="src/tetris-core.js"></script>
<script src="src/api-client.js"></script>
```

**② 화면 요소 추가**

- 상단 바: 로그인한 이메일 + 로그아웃 버튼 (`#user-bar`)
- 점수 카드 아래: **전체 최고 점수** (`#top-score`, `#top-player`), 내 최고 기록 (`#my-best`)
- 오른쪽 열: **전체 랭킹 TOP 5** (`#ranking`)
- 게임 오버 화면: 기록 저장 결과 (`#save-status`)
- 로그인/회원가입 모달 (`#auth-modal` 안의 `#auth-form`, 탭 2개, 이메일·비밀번호 입력)

**③ 게임 스크립트에 연결 지점 3곳 추가**

게임 코드는 백엔드를 직접 알지 못하게 하고, `body`의 `data-auth` 값과 **이벤트**로만 회원 스크립트와 연결합니다.

```js
// (a) 로그인 전에는 시작 막기
function canPlay() {
  if (document.body.dataset.auth === "required") {
    document.dispatchEvent(new CustomEvent("tetris:login-required"));   // → 로그인 창 열기
    return false;
  }
  return true;
}
function startGame() {
  if (!canPlay()) return;
  // ... 기존 코드
}

// (b) 게임이 끝날 때마다 기록 이벤트 발생
function endGame() {
  current = null;
  setState("over");
  document.dispatchEvent(new CustomEvent("tetris:gameover", { detail: { score, level, lines } }));
}

// (c) 로그인 입력창에 타이핑할 때 게임 단축키(R=새 게임, P=일시정지 등)가 동작하지 않게
function handleKeydown(event) {
  if (event.target.closest && event.target.closest("input, textarea, select, .auth-modal")) return;
  if (document.body.dataset.auth === "required" && state !== "running") return;
  // ... 기존 코드
}
```

**④ 회원·랭킹 스크립트** (게임 스크립트 아래 별도 `<script>`)

흐름:

```
페이지 로드
 └ api.isAvailable()
    ├ false → data-auth="offline"  : 로그인 없이 플레이, "오프라인 모드" 표시
    └ true  → data-auth="required"
         ├ 저장된 토큰으로 /api/auth/me 성공 → data-auth="ok", 랭킹·내 기록 표시
         └ 실패/토큰 없음 → 로그인 모달 표시
로그인/회원가입 성공 → data-auth="ok", 모달 닫기, 랭킹 갱신
tetris:gameover → POST /api/scores → "기록이 저장되었어요." → 랭킹·전체 최고 점수·내 최고 갱신
로그아웃 → 토큰 삭제, data-auth="required", 로그인 모달
```

전체 코드는 `index.html` 마지막 `<script>` 블록을 참고하세요. 랭킹 이름은 `textContent`로 넣어 사용자 입력이 HTML로 해석되지 않게 했습니다.

---

## 8. 전체 실행과 동작 확인

```bash
# 1) 테스트 (AGENTS.md 규칙: 둘 다 통과해야 작업 완료)
cd ~/work/tetris && npm test                              # Jest 39 passed
cd ~/work/tetris/backend && .venv/bin/python -m pytest -q # pytest 23 passed

# 2) 서버 실행
cd ~/work/tetris/backend && .venv/bin/uvicorn app.main:app --reload
```

http://127.0.0.1:8000/ 접속 후 확인할 것:

1. 로그인 창이 뜨고, 닫거나 게임을 시작할 수 없다
2. 가입하지 않은 이메일로 로그인 → "이메일 또는 비밀번호가 올바르지 않습니다. 처음이라면 회원가입을 해 주세요."
3. **회원가입** 탭에서 가입 → 상단에 이메일 표시, 게임 시작 가능
4. 게임 오버 → "기록이 저장되었어요." → 전체 최고 점수·랭킹·"내 최고 … · N판" 갱신
5. 새로고침해도 로그인 유지, 로그아웃하면 다시 로그인 창
6. 다른 이메일로 가입해 더 높은 점수를 내면 전체 최고 점수가 바뀐다
7. `index.html`을 파일로 직접 열면 "오프라인 모드 · 기록 저장 안 됨"으로 게임만 동작

> 휴대폰 등 다른 기기에서 접속하려면 `--host 0.0.0.0` 으로 실행해야 하고, WSL은 Windows 포트 포워딩 설정이 추가로 필요합니다. 이번 실습은 로컬(같은 PC) 실행만 다룹니다.

---

## 9. CI (GitHub Actions)

`.github/workflows/test.yml`에 백엔드 job을 추가해 push마다 Jest와 pytest를 모두 실행합니다.

```yaml
name: test
on: [push, pull_request]

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      - run: npm test

  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r requirements-dev.txt
      - run: python -m pytest -q
```

---

## 10. 문제 해결

| 증상 | 원인 · 해결 |
|---|---|
| `No module named 'ensurepip'` (`python3 -m venv`) | Ubuntu 기본 Python에 venv 구성요소 없음 → `uv venv .venv` 사용 (또는 `sudo apt install python3.10-venv`) |
| `ModuleNotFoundError: No module named 'app'` | `backend` 폴더에서 실행해야 함: `cd backend && .venv/bin/uvicorn app.main:app` |
| `sqlite3.ProgrammingError: SQLite objects created in a thread can only be used in that same thread` | `create_engine(..., connect_args={"check_same_thread": False})` 누락 |
| `sqlite3.OperationalError: unable to open database file` | DB 폴더 없음 → `DATA_DIR.mkdir(...)` 확인, 경로 확인 |
| 컬럼을 추가했는데 반영 안 됨 | `create_all`은 기존 테이블을 바꾸지 않음 → 개발 중에는 `backend/data/tetris.db` 삭제 후 재실행 |
| 서버 재시작 후 모두 로그아웃됨 | 비밀키가 매번 바뀜 → `backend/data/secret.key` 가 지워지지 않았는지, `TETRIS_SECRET_KEY` 확인 |
| 로그인 창이 안 뜨고 "오프라인 모드" | `/api/health` 실패 → 백엔드 실행 여부, `http://127.0.0.1:8000/` 으로 접속했는지 확인 (파일로 열면 항상 오프라인) |
| `Address already in use` | 8000 포트 사용 중 → `--port 8001` 또는 기존 uvicorn 종료 |
| 로그인 창에서 R·P를 치면 게임이 반응 | `handleKeydown` 맨 앞의 입력창 무시 코드(7-3 ③ (c)) 누락 |
