#!/bin/bash
# ==============================================================================
# DataMiner Deployment Script for Hetzner Server
# Server: dedi4509.your-server.de (Port 222)
# Target: /usr/www/users/viminb/dataminer
# ==============================================================================

set -e

REMOTE_HOST="dedi4509.your-server.de"
REMOTE_PORT="222"
REMOTE_USER="viminb"
REMOTE_PATH="/usr/www/users/viminb/dataminer"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 [1/4] Starte DataMiner Deployment..."

# 1. Frontend kompilieren
echo "📦 [2/4] Kompiliere Frontend-Assets mit Vite..."
cd "$ROOT_DIR"
npm run build

# 2. Dateien synchronisieren
echo "📤 [3/4] Übertrage Projektdateien per rsync..."
rsync -avz --progress -e "ssh -p $REMOTE_PORT" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='storage/logs/*' \
  --exclude='storage/framework/cache/*' \
  --exclude='storage/framework/sessions/*' \
  --exclude='storage/framework/views/*' \
  "$ROOT_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"

# 3. Server-Tasks ausführen
echo "⚙️ [4/4] Aktualisiere Abhängigkeiten & Caches auf dem Server..."
ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" << 'EOF'
cd /usr/www/users/viminb/dataminer

# Composer Dependencies installieren
composer install --no-dev --optimize-autoloader --no-interaction

# Falls noch kein App Key existiert
if grep -q "APP_KEY=$" .env 2>/dev/null || ! grep -q "APP_KEY=" .env 2>/dev/null; then
  php artisan key:generate --force
fi

# Datenbank-Migrationen ausführen (falls DB konfiguriert ist)
php artisan migrate --force || echo "⚠️ Migrationen übersprungen (DB prüfen)"

# Caches leeren und neu erstellen
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Queue-Worker neu starten, falls PM2 läuft (inkl. Aktualisierung der Umgebungsvariablen)
pm2 restart dataminer-worker --update-env 2>/dev/null || true

echo "✅ Server-Aktualisierung erfolgreich abgeschlossen!"
EOF

echo "🎉 Deployment erfolgreich beendet!"
