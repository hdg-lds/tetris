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
