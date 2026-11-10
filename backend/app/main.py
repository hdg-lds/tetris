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
