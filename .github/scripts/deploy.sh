#!/usr/bin/env bash
set -e

echo "🚀 Starting deployment..."

if [ -z "${DEPLOY_PATH}" ]; then
  echo "❌ Error: DEPLOY_PATH is not set"
  exit 1
fi

cd "${DEPLOY_PATH}"

echo "📥 Syncing latest code from production branch..."
git fetch origin production
git checkout -f production
git reset --hard origin/production

# Activate Node environment if present
if [ -d "$HOME/nodevenv/testqbackend.iqpaths.com/20/bin" ]; then
  export PATH=$HOME/nodevenv/testqbackend.iqpaths.com/20/bin:$PATH
fi

echo "📦 Installing dependencies..."
npm install --production

echo "🔄 Restarting app (Passenger-style restart)..."
mkdir -p tmp logs
touch tmp/restart.txt

echo "✅ Deployment finished successfully! App will restart on next request."

