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
