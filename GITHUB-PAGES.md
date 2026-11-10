# 테트리스 GitHub Pages 배포 가이드

- GitHub 계정: `hdg-lds`
- 저장소: `tetris` → `git@github.com:hdg-lds/tetris.git`
- 로컬 작업 폴더: `~/work/tetris`
- 인증 방식: SSH (`~/.ssh/id_ed25519`)
- 배포 주소: **https://hdg-lds.github.io/tetris/**

이 앱은 빌드 과정이 없는 정적 페이지(`index.html` 단일 파일)라서, 저장소 루트에 `index.html`을 올리고 Pages 소스를 `main` 브랜치 루트로 지정하기만 하면 됩니다.

---

## 1. 앱을 `~/work/tetris`로 복사

```bash
mkdir -p ~/work/tetris
cp -r ~/work/kosa-ict-genai-2026-hyundai/src/exercise/hdg-lds/day12/tetris/. ~/work/tetris/
cd ~/work/tetris
ls -la        # index.html, README.md 등이 보이면 OK
```

> 원본(`kosa-ict-genai-2026-hyundai`)은 별도 git 저장소입니다. `~/work/tetris`는 그 밖에 있으므로 새 저장소로 독립적으로 관리됩니다.

## 2. SSH 인증 확인

```bash
ssh -T git@github.com
```

- `Hi hdg-lds! You've successfully authenticated...` 가 나오면 3단계로 넘어갑니다.
- `Permission denied (publickey)` 가 나오면 공개키를 GitHub에 등록합니다.

```bash
cat ~/.ssh/id_ed25519.pub
```

출력된 한 줄 전체를 복사해 GitHub → **Settings → SSH and GPG keys → New SSH key** 에 붙여넣고 저장한 뒤, `ssh -T git@github.com` 으로 다시 확인합니다.

(키가 없다면 `ssh-keygen -t ed25519 -C "hdg-lds"` 로 먼저 생성)

## 3. GitHub에 `tetris` 저장소 만들기

웹에서: https://github.com/new

- Repository name: `tetris`
- Visibility: **Public** (무료 계정은 Public 저장소에서만 Pages 사용 가능)
- README / .gitignore / license 추가 **하지 않음** (빈 저장소로 생성 → push 충돌 방지)

`gh` CLI를 쓰는 경우(선택):

```bash
gh repo create hdg-lds/tetris --public
```

## 4. 로컬 저장소 초기화 후 push

```bash
cd ~/work/tetris
git init -b main
git config user.name  "hdg-lds"
git config user.email "<GitHub에 등록한 이메일>"

touch .nojekyll                 # Jekyll 처리 건너뛰기 (정적 HTML 그대로 배포)
git add .
git commit -m "Initial commit: tetris"

git remote add origin git@github.com:hdg-lds/tetris.git
git push -u origin main
```

확인:

```bash
git remote -v     # origin  git@github.com:hdg-lds/tetris.git (fetch/push) — https:// 가 아니라 git@ 이어야 SSH 사용
```

## 5. GitHub Pages 활성화

저장소 페이지 → **Settings → Pages**

- Source: **Deploy from a branch**
- Branch: **main** / 폴더: **/ (root)** → **Save**

1~2분 후 같은 화면 상단에 `Your site is live at https://hdg-lds.github.io/tetris/` 가 표시됩니다. 배포 진행 상황은 **Actions** 탭의 `pages build and deployment` 워크플로에서 볼 수 있습니다.

`gh` CLI로 켜는 경우(선택):

```bash
gh api -X POST repos/hdg-lds/tetris/pages -f "source[branch]=main" -f "source[path]=/"
```

## 6. 이후 수정 사항 배포

```bash
cd ~/work/tetris
# index.html 수정 후
git add .
git commit -m "변경 내용 설명"
git push
```

push 할 때마다 Pages가 자동으로 다시 배포됩니다. 브라우저에 반영이 안 보이면 강력 새로고침(Ctrl+Shift+R)을 합니다.

---

## 참고 / 문제 해결

| 증상 | 원인 · 해결 |
|---|---|
| `Permission denied (publickey)` | 공개키 미등록 → 2단계 수행. `ssh-add ~/.ssh/id_ed25519` 로 에이전트에 키 추가도 시도 |
| push 시 아이디/비밀번호를 물어봄 | remote가 HTTPS로 설정됨 → `git remote set-url origin git@github.com:hdg-lds/tetris.git` |
| `rejected ... fetch first` | 저장소를 README 포함으로 만든 경우 → `git pull --rebase origin main` 후 다시 push |
| 페이지가 404 | Pages 설정의 브랜치/폴더 확인, 루트에 `index.html` 존재 여부 확인, 몇 분 대기 |
| Settings에 Pages 메뉴가 비활성 | 저장소가 Private → Public으로 변경 |

- 저장소가 Public이므로 `AGENTS.md`, `PLAN.md`, `WORKFLOW.md` 등도 모두 공개됩니다. 공개하고 싶지 않은 파일은 4단계 전에 삭제하거나 `.gitignore`에 추가하세요.
- `.env`, 키 파일 등 비밀 정보가 폴더에 섞여 들어가지 않았는지 `git status`로 커밋 전에 확인하세요.
