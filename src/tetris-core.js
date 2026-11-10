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

  const BASE_DELAY = 800;     // 레벨 1 낙하 간격(ms)
  const SPEED_FACTOR = 0.85;  // 레벨이 오를 때마다 낙하 간격이 15%씩 짧아짐
  const MIN_DELAY = 80;       // 최고 속도

  // 레벨이 오를수록 블록이 점점 빨리 떨어지도록 낙하 간격(ms)을 계산
  function gravityDelay(level) {
    const safeLevel = Math.max(1, Math.floor(level) || 1);
    return Math.max(MIN_DELAY, Math.round(BASE_DELAY * SPEED_FACTOR ** (safeLevel - 1)));
  }

  const api = { COLS, ROWS, MIN_DELAY, emptyBoard, collides, rotateMatrix, clearRows, lineScore, levelForLines, gravityDelay };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;        // Node / Jest
  } else {
    root.TetrisCore = api;       // 브라우저: window.TetrisCore
  }
})(typeof window !== "undefined" ? window : globalThis);
