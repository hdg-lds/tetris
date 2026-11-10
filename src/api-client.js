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
