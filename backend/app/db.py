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
