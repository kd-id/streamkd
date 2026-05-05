#!/usr/bin/env bash
set -euo pipefail

BRANCH="${STREAMKD_UPDATE_BRANCH:-main}"
REMOTE="${STREAMKD_UPDATE_REMOTE:-origin}"
APP_NAME="${STREAMKD_PM2_NAME:-streamkd}"

cd "$(dirname "$0")/.."

echo "== StreamKD fast update =="
echo "Repo: $(pwd)"

git fetch "$REMOTE" "$BRANCH"

CURRENT_REV="$(git rev-parse HEAD)"
TARGET_REV="$(git rev-parse "$REMOTE/$BRANCH")"

if [ "$CURRENT_REV" = "$TARGET_REV" ]; then
  echo "Source already up to date: $(git rev-parse --short HEAD)"
  DEPENDENCIES_CHANGED="0"
else
  if git diff --name-only "$CURRENT_REV" "$TARGET_REV" -- package.json package-lock.json | grep -q .; then
    DEPENDENCIES_CHANGED="1"
  else
    DEPENDENCIES_CHANGED="0"
  fi

  git pull --ff-only "$REMOTE" "$BRANCH"
  echo "Updated to: $(git rev-parse --short HEAD)"
fi

if [ ! -d node_modules ]; then
  echo "node_modules not found. Installing dependencies..."
  npm install --ignore-scripts
  npm run rebuild-native
elif [ "$DEPENDENCIES_CHANGED" = "1" ]; then
  echo "Dependency files changed. Updating dependencies..."
  npm install --ignore-scripts
  npm run rebuild-native
else
  echo "Dependency files unchanged. Skipping npm install."
fi

if command -v pm2 >/dev/null 2>&1 && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "Restarting PM2 app: $APP_NAME"
  pm2 restart "$APP_NAME" --update-env
  pm2 save
elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q "^${APP_NAME}.service"; then
  echo "Restarting systemd service: $APP_NAME"
  sudo systemctl restart "$APP_NAME"
else
  echo "No PM2/systemd app named '$APP_NAME' found."
  echo "Restart manually, for example: pm2 restart $APP_NAME --update-env"
fi

echo "Done."
