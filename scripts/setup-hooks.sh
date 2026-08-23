#!/usr/bin/env bash
#
# Points git at the hooks committed in .githooks/.
#
# Hooks live in .git/hooks/, which is not part of the repository — a fresh
# clone therefore has none of them and every guard in .githooks/ is inert until
# this runs. CLAUDE.md described the pre-commit hook as "자동 설치됨" for months
# while .git/hooks/ held nothing but the stock .sample files.
#
#   ./scripts/setup-hooks.sh
#
# Undo with:  git config --unset core.hooksPath

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

printf '\033[32m✔\033[0m 훅 활성화됨 (core.hooksPath = .githooks)\n'
for h in .githooks/*; do
  [ -f "$h" ] && printf '    %s\n' "$(basename "$h")"
done

email=$(git config user.email || true)
case "$email" in
  *@users.noreply.github.com)
    printf '\033[32m✔\033[0m 커밋 이메일: %s\n' "$email"
    ;;
  "")
    printf '\033[31m✘\033[0m 커밋 이메일이 설정되어 있지 않습니다.\n'
    printf "    git config user.email '<ID>+<username>@users.noreply.github.com'\n"
    exit 1
    ;;
  *)
    printf '\033[31m✘\033[0m 커밋 이메일이 GitHub noreply 주소가 아닙니다: %s\n' "$email"
    printf '    공개 저장소에 개인 주소가 영구히 남습니다. 아래로 바꾸세요:\n'
    printf "    git config user.email '<ID>+<username>@users.noreply.github.com'\n"
    printf '    (주소는 GitHub → Settings → Emails 에서 확인할 수 있습니다)\n'
    exit 1
    ;;
esac
