#!/bin/bash
# ==============================================================================
# DataMiner Deployment Script for Hetzner Server (Git-Based Deployment)
# Server: dedi4509.your-server.de (Port 222)
# Target: /usr/www/users/viminb/dataminer
# ==============================================================================

set -e

REMOTE_HOST="dedi4509.your-server.de"
REMOTE_PORT="222"
REMOTE_USER="viminb"
REMOTE_PATH="/usr/www/users/viminb/dataminer"

echo "🚀 Starte Git-basiertes DataMiner Deployment auf $REMOTE_HOST..."

ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" << 'EOF'
set -e
cd /usr/www/users/viminb/dataminer

echo "📥 [1/5] Hole neuesten Stand vom GitHub Repository (git pull)..."
git fetch origin main
git reset --hard origin/main

echo "📦 [2/5] Installiere PHP Dependencies..."
composer install --no-dev --optimize-autoloader --no-interaction

echo "🔨 [3/5] Kompiliere Frontend-Assets mit Vite direkt auf dem Server..."
npm run build
rm -f public/hot

echo "🗄️ [4/5] Führe Datenbank-Migrationen aus..."
if grep -q "APP_KEY=$" .env 2>/dev/null || ! grep -q "APP_KEY=" .env 2>/dev/null; then
  php artisan key:generate --force
fi
php artisan migrate --force || echo "⚠️ Migrationen übersprungen (DB prüfen)"

echo "⚙️ [5/5] Optimiere Caches & starte Worker neu..."
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Starte PM2 Queue-Worker neu
pm2 restart dataminer-worker --update-env 2>/dev/null || true

echo "✅ Server-Aktualisierung erfolgreich abgeschlossen!"
EOF

echo "🎉 Deployment via Git erfolgreich beendet!"
