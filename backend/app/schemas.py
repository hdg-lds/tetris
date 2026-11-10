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
