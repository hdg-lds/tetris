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
