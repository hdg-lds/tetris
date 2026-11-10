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
