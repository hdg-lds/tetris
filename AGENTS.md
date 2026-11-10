# Project instructions

## Prompt and result history

- Keep `WORKFLOW.md` as the chronological record of user task prompts and their outcomes for this project.
- For each project task, append an entry after finishing the work and before the final response. Preserve the original user prompt exactly, including spelling, punctuation, Markdown, and code. Include follow-up prompts and user choices that affect the task, in order.
- Summarize the result concisely, including the outcome, changed files, and verification performed (or state that no verification was run).
- Keep earlier entries unchanged. Do not invent or reconstruct missing wording; mark it as unavailable if the exact prompt is not present in the conversation.
- Do not record system or developer instructions, platform boilerplate, tool output, or hidden reasoning. Do not persist credentials or secret tokens; redact those values as `[REDACTED]` if they appear in a prompt.
- Use the current date for entries. Apply this rule when working in this project while this file is present.

## Unit tests (required)

- After any change to code, run the unit tests before finishing the task:
  - Frontend (`index.html`, `src/`, `tests/`, `package.json`): `npm test`
  - Backend (`backend/`): `cd backend && .venv/bin/python -m pytest -q`
  - If a change touches both, or the frontend–backend API contract (`src/api-client.js`, `backend/app/`), run both.
- A task is complete only when every test passes. If any test fails, fix the cause (or update the test if the behavior change was intended) and run the tests again until they pass. Never report the task as done while tests are failing, skipped, or not run.
- When game logic changes, add or update the matching tests in `tests/`. Keep pure game logic in `src/tetris-core.js` and API calls in `src/api-client.js` so they stay testable. When an API endpoint changes, update `backend/tests/`.
- If the tests cannot be run (for example, Node.js is unavailable), stop and tell the user instead of declaring the task complete.
- Record the test command and its result (number of tests passed for each suite) in the `WORKFLOW.md` entry and in the final response.

## Git workflow

- Never rebase. Do not use `git rebase`, `git pull --rebase`, or `git config pull.rebase true`.
- Integrate remote changes with merge only: `git pull --no-rebase` (or `git fetch` then `git merge origin/<branch>`).
- If a push is rejected because the remote has new commits, run `git pull --no-rebase`, resolve any conflicts, run the tests, then push again.
