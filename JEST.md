# 테트리스 프론트엔드 유닛 테스트 (Jest) 가이드

대상 환경: WSL2 Ubuntu 22.04, 작업 폴더 `~/work/tetris` (GitHub Pages 배포 저장소, `GITHUB-PAGES.md` 참고)

현재 상태
- WSL 안에는 Node.js가 **없음**
- 단, `which npm` 이 `/mnt/c/Program Files/nodejs/npm` 을 가리킴 → **Windows용 Node가 PATH로 섞여 들어온 것**이므로 쓰면 안 됨 (경로/권한/성능 문제 발생)
- 게임 로직은 `index.html` 안의 `<script>` 즉시실행함수(IIFE)에 들어 있어 외부에서 import 불가 → **순수 로직을 별도 파일로 분리**해야 테스트 가능

---

## 1. Node.js 설치 (nvm 사용)

nvm(Node Version Manager)은 sudo 없이 사용자 홈에 Node를 설치하고 버전을 바꿔 쓸 수 있어 권장됩니다.

```bash
# 필요 도구
sudo apt update && sudo apt install -y curl ca-certificates

# nvm 설치 (최신 버전 번호는 https://github.com/nvm-sh/nvm#installing-and-updating 에서 확인)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# 현재 셸에 반영 (또는 터미널 재시작)
source ~/.bashrc

# LTS 버전 설치 및 기본값 지정
nvm install --lts
nvm alias default 'lts/*'
```

### 설치 확인 — 반드시 WSL 경로인지 확인

```bash
which node npm
# /home/ubuntu/.nvm/versions/node/vXX.X.X/bin/node   ← 이렇게 나와야 정상
# /mnt/c/Program Files/nodejs/...                    ← 이렇게 나오면 Windows Node가 우선된 것

node -v
npm -v
```

Windows 경로가 계속 잡히면 WSL이 Windows PATH를 붙이지 않도록 설정합니다.

```bash
sudo tee -a /etc/wsl.conf > /dev/null <<'EOF'
[interop]
appendWindowsPath = false
EOF
```

PowerShell에서 `wsl --shutdown` 후 WSL을 다시 열면 적용됩니다. (이 설정을 하면 WSL에서 `code`, `explorer.exe` 같은 Windows 명령도 PATH에서 빠지니, 필요하면 `~/.bashrc`에 해당 경로만 따로 추가하세요.)

---

## 2. 프로젝트에 Jest 설치

```bash
cd ~/work/tetris
npm init -y
npm install --save-dev jest jest-environment-jsdom
```

- `jest`: 테스트 러너
- `jest-environment-jsdom`: 브라우저 DOM(`document`, `window`)을 흉내 내는 환경 — DOM 테스트할 때만 필요

`package.json`의 `scripts`를 수정합니다.

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

`.gitignore` 생성 (node_modules는 절대 커밋하지 않음):

```bash
cat > .gitignore <<'EOF'
node_modules/
coverage/
EOF
```

> GitHub Pages는 `index.html`만 서빙하므로 `package.json`, `tests/` 가 저장소에 있어도 배포에는 영향이 없습니다.

---

## 3. 테스트 가능한 구조로 리팩터링

현재 `index.html`의 함수들(`collides`, `clearRows` 등)은 IIFE 안의 전역 상태(`board`, `score`, `level`)와 DOM(`updateStats()`)에 직접 의존합니다. **상태를 인자로 받고 결과를 반환하는 순수 함수**로 뽑아내면 테스트가 쉬워집니다.

### 목표 구조

```
~/work/tetris
├── index.html          # UI·캔버스·이벤트 (core 사용)
├── src/
│   └── tetris-core.js  # 순수 게임 로직 (DOM 없음)
├── tests/
│   ├── tetris-core.test.js
│   └── dom.test.js     # (선택) DOM 테스트
├── package.json
└── .gitignore
```

### `src/tetris-core.js`

브라우저(`<script src>`)와 Jest(`require`) 양쪽에서 쓸 수 있도록 작성합니다. 빌드 도구나 ES 모듈 설정 없이 동작하고, `index.html`을 파일로 직접 열어도(file://) 문제없습니다.

```js
(function (root) {
  "use strict";

  const COLS = 10;
  const ROWS = 20;
  const LINE_POINTS = [0, 100, 300, 500, 800];

  function emptyBoard(rows = ROWS, cols = COLS) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
  }

  function collides(board, piece, offsetX = 0, offsetY = 0, cells = piece.cells) {
    const rows = board.length;
    const cols = board[0].length;
    for (let row = 0; row < cells.length; row += 1) {
      for (let col = 0; col < cells[row].length; col += 1) {
        if (!cells[row][col]) continue;
        const x = piece.x + col + offsetX;
        const y = piece.y + row + offsetY;
        if (x < 0 || x >= cols || y >= rows) return true;
        if (y >= 0 && board[y][x]) return true;
      }
    }
    return false;
  }

  function rotateMatrix(matrix, direction) {
    const height = matrix.length;
    const width = matrix[0].length;
    const rotated = Array.from({ length: width }, () => Array(height).fill(0));
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (direction > 0) rotated[col][height - 1 - row] = matrix[row][col];
        else rotated[width - 1 - col][row] = matrix[row][col];
      }
    }
    return rotated;
  }

  // 꽉 찬 줄을 지우고 새 보드와 지운 줄 수를 반환 (원본 보드는 변경하지 않음)
  function clearRows(board) {
    const cols = board[0].length;
    const remaining = board.filter((row) => row.some((cell) => cell === null));
    const cleared = board.length - remaining.length;
    const fresh = Array.from({ length: cleared }, () => Array(cols).fill(null));
    return { board: fresh.concat(remaining), cleared };
  }

  function lineScore(cleared, level) {
    return (LINE_POINTS[cleared] || 0) * level;
  }

  function levelForLines(lines) {
    return Math.floor(lines / 10) + 1;
  }

  function gravityDelay(level) {
    return Math.max(100, 800 - (level - 1) * 60);
  }

  const api = { COLS, ROWS, emptyBoard, collides, rotateMatrix, clearRows, lineScore, levelForLines, gravityDelay };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;        // Node / Jest
  } else {
    root.TetrisCore = api;       // 브라우저: window.TetrisCore
  }
})(typeof window !== "undefined" ? window : globalThis);
```

### `index.html` 수정

기존 인라인 `<script>` **앞에** core를 불러오고, 기존 함수가 core를 쓰도록 바꿉니다.

```html
  <script src="src/tetris-core.js"></script>
  <script>
    (() => {
      "use strict";
      const { COLS, ROWS, emptyBoard, rotateMatrix, lineScore, levelForLines } = window.TetrisCore;
      const Core = window.TetrisCore;
      // ... 기존 코드 ...
```

기존 함수는 core에 위임하도록 얇게 바꿉니다 (예시):

```js
      // 기존 COLS/ROWS/emptyBoard/rotateMatrix 정의는 삭제

      function collides(piece, offsetX = 0, offsetY = 0, cells = piece.cells) {
        return Core.collides(board, piece, offsetX, offsetY, cells);
      }

      function clearRows() {
        const result = Core.clearRows(board);
        if (result.cleared === 0) return 0;
        board = result.board;
        score += lineScore(result.cleared, level);
        lines += result.cleared;
        level = levelForLines(lines);
        updateStats();
        return result.cleared;
      }

      function gravityDelay() {
        return Core.gravityDelay(level);
      }
```

리팩터링 후 브라우저에서 게임을 직접 플레이해 동작이 이전과 같은지 꼭 확인하세요.

---

## 4. 테스트 작성

### `tests/tetris-core.test.js` (Node 환경, DOM 불필요)

```js
const {
  COLS, ROWS, emptyBoard, collides, rotateMatrix,
  clearRows, lineScore, levelForLines, gravityDelay,
} = require("../src/tetris-core");

const O = [[1, 1], [1, 1]];
const T = [[0, 1, 0], [1, 1, 1]];
const I = [[1, 1, 1, 1]];

describe("emptyBoard", () => {
  test("20x10 크기의 빈 보드를 만든다", () => {
    const board = emptyBoard();
    expect(board).toHaveLength(ROWS);
    expect(board.every((row) => row.length === COLS)).toBe(true);
    expect(board.flat().every((cell) => cell === null)).toBe(true);
  });

  test("각 행은 서로 다른 배열이다 (참조 공유 없음)", () => {
    const board = emptyBoard();
    board[0][0] = "x";
    expect(board[1][0]).toBeNull();
  });
});

describe("collides", () => {
  const board = emptyBoard();

  test("빈 보드 가운데에서는 충돌하지 않는다", () => {
    expect(collides(board, { x: 4, y: 0, cells: O })).toBe(false);
  });

  test("왼쪽/오른쪽 벽을 넘으면 충돌", () => {
    expect(collides(board, { x: 0, y: 0, cells: O }, -1, 0)).toBe(true);
    expect(collides(board, { x: COLS - 2, y: 0, cells: O }, 1, 0)).toBe(true);
  });

  test("바닥을 넘으면 충돌", () => {
    expect(collides(board, { x: 0, y: ROWS - 2, cells: O }, 0, 1)).toBe(true);
  });

  test("보드 위쪽(y<0)은 충돌로 보지 않는다", () => {
    expect(collides(board, { x: 4, y: -1, cells: O })).toBe(false);
  });

  test("이미 쌓인 블록과 겹치면 충돌", () => {
    const filled = emptyBoard();
    filled[ROWS - 1][4] = "#fff";
    expect(collides(filled, { x: 4, y: ROWS - 2, cells: O })).toBe(true);
  });
});

describe("rotateMatrix", () => {
  test("T를 시계방향으로 회전", () => {
    expect(rotateMatrix(T, 1)).toEqual([[1, 0], [1, 1], [1, 0]]);
  });

  test("I를 회전하면 세로 4칸이 된다", () => {
    expect(rotateMatrix(I, 1)).toEqual([[1], [1], [1], [1]]);
  });

  test("시계 → 반시계 회전하면 원래 모양", () => {
    expect(rotateMatrix(rotateMatrix(T, 1), -1)).toEqual(T);
  });

  test("같은 방향 4번 회전하면 원래 모양", () => {
    let m = T;
    for (let i = 0; i < 4; i += 1) m = rotateMatrix(m, 1);
    expect(m).toEqual(T);
  });
});

describe("clearRows", () => {
  test("꽉 찬 줄이 없으면 0줄", () => {
    const { cleared } = clearRows(emptyBoard());
    expect(cleared).toBe(0);
  });

  test("꽉 찬 2줄을 지우고 위에 빈 줄을 채운다", () => {
    const board = emptyBoard();
    board[ROWS - 1].fill("#a");
    board[ROWS - 2].fill("#b");
    board[ROWS - 3][0] = "#c";

    const result = clearRows(board);

    expect(result.cleared).toBe(2);
    expect(result.board).toHaveLength(ROWS);
    expect(result.board[ROWS - 1][0]).toBe("#c");   // 남은 블록이 아래로 내려옴
    expect(result.board[0].every((c) => c === null)).toBe(true);
  });

  test("원본 보드는 변경하지 않는다", () => {
    const board = emptyBoard();
    board[ROWS - 1].fill("#a");
    clearRows(board);
    expect(board[ROWS - 1][0]).toBe("#a");
  });
});

describe("점수/레벨/속도", () => {
  test.each([
    [0, 1, 0],
    [1, 1, 100],
    [2, 1, 300],
    [3, 1, 500],
    [4, 1, 800],
    [4, 3, 2400],
  ])("%i줄, 레벨 %i → %i점", (cleared, level, expected) => {
    expect(lineScore(cleared, level)).toBe(expected);
  });

  test("10줄마다 레벨업", () => {
    expect(levelForLines(0)).toBe(1);
    expect(levelForLines(9)).toBe(1);
    expect(levelForLines(10)).toBe(2);
    expect(levelForLines(25)).toBe(3);
  });

  test("낙하 간격은 레벨이 오를수록 줄고 100ms 미만으로 내려가지 않는다", () => {
    expect(gravityDelay(1)).toBe(800);
    expect(gravityDelay(2)).toBe(740);
    expect(gravityDelay(99)).toBe(100);
  });
});
```

### (선택) `tests/dom.test.js` — jsdom으로 HTML 구조 확인

파일 첫 줄의 docblock 주석으로 이 파일만 브라우저 환경에서 실행합니다.

```js
/**
 * @jest-environment jsdom
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

beforeEach(() => {
  document.documentElement.innerHTML = html;
});

test("게임 보드 캔버스와 점수판이 존재한다", () => {
  expect(document.getElementById("board")).not.toBeNull();
  expect(document.getElementById("score")).not.toBeNull();
  expect(document.getElementById("level")).not.toBeNull();
  expect(document.getElementById("lines")).not.toBeNull();
});

test("시작/일시정지/리셋 버튼이 있다", () => {
  ["start-button", "pause-button", "reset-button"].forEach((id) => {
    expect(document.getElementById(id)).not.toBeNull();
  });
});
```

> `innerHTML`로 넣은 `<script>`는 실행되지 않으므로 이 테스트는 **마크업 구조만** 확인합니다. jsdom은 canvas 그리기·Web Audio를 지원하지 않으므로, 게임 로직은 위처럼 core로 분리해 Node 환경에서 테스트하는 것이 핵심입니다.

---

## 5. 실행

```bash
npm test                 # 전체 테스트 1회 실행
npm run test:watch       # 파일 저장 시 자동 재실행 (개발 중)
npm run test:coverage    # 커버리지 리포트 (coverage/lcov-report/index.html)
npx jest tests/tetris-core.test.js -t "rotateMatrix"   # 특정 파일/이름만
```

성공 예시:

```
PASS  tests/tetris-core.test.js
PASS  tests/dom.test.js

Test Suites: 2 passed, 2 total
Tests:       ... passed, ... total
```

---

## 6. (선택) GitHub Actions로 push마다 자동 테스트

`.github/workflows/test.yml`

```yaml
name: test
on: [push, pull_request]

jobs:
  jest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      - run: npm test
```

`npm ci`는 `package-lock.json`을 기준으로 설치하므로 **`package-lock.json`은 커밋**해야 합니다.

---

## 7. 커밋

```bash
cd ~/work/tetris
git add package.json package-lock.json .gitignore src/ tests/ index.html JEST.md
git status        # node_modules/ 가 목록에 없어야 함
git commit -m "Add Jest unit tests for tetris core logic"
git push
```

---

## 문제 해결

| 증상 | 원인 · 해결 |
|---|---|
| `which node` 가 `/mnt/c/...` | Windows Node가 우선됨 → `source ~/.bashrc`, 그래도 안 되면 1단계의 `appendWindowsPath = false` |
| 새 터미널에서 `node: command not found` | `~/.bashrc`에 nvm 로딩 줄이 없음 → nvm 설치 스크립트 재실행 또는 `nvm use default` |
| `Test environment jest-environment-jsdom cannot be found` | `npm i -D jest-environment-jsdom` |
| `Cannot use import statement outside a module` | 테스트에서 `import` 사용 → 이 가이드는 CommonJS(`require`) 기준. ESM을 쓰려면 `"type": "module"` + `NODE_OPTIONS=--experimental-vm-modules jest` 필요 |
| `window.TetrisCore is undefined` (브라우저) | `index.html`에서 `src/tetris-core.js`를 기존 스크립트보다 **먼저** 불러왔는지, 경로가 맞는지 확인 |
| `/mnt/c/...` 아래에서 npm이 매우 느림 | 프로젝트를 WSL 파일시스템(`~/work/tetris`)에 두고 작업 |
