#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -gt 0 ]]; then
  echo "错误: release:tag 不再接收版本号或发布说明参数"
  echo "请只修改 package.json 的 version 和 release.notes，然后运行 npm run release:tag"
  exit 1
fi

node scripts/sync-release-metadata.mjs

TAG="$(node -e "const p = require('./package.json'); process.stdout.write('v' + p.version)")"
MESSAGE="$(node -e "const p = require('./package.json'); const notes = p.release && p.release.notes; process.stdout.write(Array.isArray(notes) ? notes.filter(Boolean).join('\n') : String(notes || '').trim())")"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误: 当前目录不是 Git 仓库"
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "错误: 当前分支是 $CURRENT_BRANCH，请切换到 main 后再发布"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 工作区存在未提交改动，请先提交或清理后再发布"
  echo "提示: 版本号和更新记录只改 package.json，然后运行 npm run release:sync，把同步结果一起提交。"
  git status --short
  exit 1
fi

git fetch --tags origin

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "错误: 本地已存在 tag $TAG"
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "错误: GitHub 已存在 tag $TAG"
  exit 1
fi

git push origin main

git tag -a "$TAG" -m "$MESSAGE"
git push origin "$TAG"

echo "已发布 tag: $TAG"
echo "Release 更新记录来自 package.json release.notes。"
echo "GitHub Actions 将自动打包 macOS / Windows 安装包并发布 Release。"
