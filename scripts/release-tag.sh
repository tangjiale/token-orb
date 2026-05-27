#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
MESSAGE="${2:-}"

if [[ -z "$TAG" ]]; then
  echo "用法: npm run release:tag -- v0.1.1 [发布说明]"
  exit 1
fi

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "错误: tag 必须使用 v 开头的语义化版本，例如 v0.1.1"
  exit 1
fi

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

if [[ -z "$MESSAGE" ]]; then
  MESSAGE="Release $TAG"
fi

git tag -a "$TAG" -m "$MESSAGE"
git push origin "$TAG"

echo "已发布 tag: $TAG"
echo "GitHub Actions 将自动打包 macOS / Windows 安装包并发布 Release。"
