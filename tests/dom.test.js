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
