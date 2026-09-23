# DataMiner: Hetzner Deployment & Publishing Guide

Dieses Dokument beschreibt das Setup und den Veröffentlichungs-Workflow für den Hetzner-Server.

---

## 1. Server- & Umgebungsdaten

* **Host:** `dedi4509.your-server.de`
* **SSH-Port:** `222`
* **SSH-User:** `viminb`
* **SSH-Befehl:**
  ```bash
  ssh -p 222 viminb@dedi4509.your-server.de
  ```
* **Projektverzeichnis auf dem Server:**
  * Vollständiger Pfad: `/usr/www/users/viminb/dataminer`
  * Alias aus Home-Verzeichnis: `~/public_html/dataminer`
* **Web-DocumentRoot (KonsoleH):**
  * Die Domain / Subdomain (z. B. `dataminer.viminds.de`) muss in KonsoleH auf folgenden Unterordner zeigen:
    ```
    /usr/www/users/viminb/dataminer/public
    ```
* **Installierte Versionen auf dem Server:**
  * PHP: `8.5` (mit `pdo_pgsql`, `pgsql`, `mbstring`, `curl`, `json`, `zip`, `xml`)
  * Composer: `2.5+`
  * Node.js & npm: Installiert
  * Process Manager: `pm2`
  * Datenbank: PostgreSQL auf `127.0.0.1:5432`

---

## 2. Erstmalige Einrichtung (Initial Setup)

### A. PostgreSQL-Datenbank & User anlegen
Auf dem Server im Terminal ausführen:
```bash
psql -U postgres
```
```sql
CREATE DATABASE dataminer_prod;
CREATE USER dataminer_user WITH ENCRYPTED PASSWORD 'DEIN_SICHERES_PASSWORT';
GRANT ALL PRIVILEGES ON DATABASE dataminer_prod TO dataminer_user;
ALTER DATABASE dataminer_prod OWNER TO dataminer_user;

\c dataminer_prod
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL ON SCHEMA public TO dataminer_user;
\q
```

### B. `.env` Datei auf dem Server anlegen
Auf dem Server im Ordner `/usr/www/users/viminb/dataminer`:
```bash
cd /usr/www/users/viminb/dataminer
cp .env.example .env
nano .env
```
Wichtige Parameter in der `.env`:
```dotenv
APP_NAME=DataMiner
APP_ENV=production
APP_DEBUG=false
APP_URL=https://deine-domain.de

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=dataminer_prod
DB_USERNAME=dataminer_user
DB_PASSWORD=DEIN_SICHERES_PASSWORT

# API Keys (globaler Fallback)
EDEN_API_KEY=dein_eden_key
EDEN_REGION=us
SERPER_API_KEY=dein_serper_key
SERP_API_KEY=dein_serpapi_key
```

### C. Dateirechte absichern
```bash
chmod 600 /usr/www/users/viminb/dataminer/.env
chmod -R 775 /usr/www/users/viminb/dataminer/storage /usr/www/users/viminb/dataminer/bootstrap/cache
```

---

## 3. Deployment / Zukünftige Veröffentlichungen

### Schritt 1: Lokalen Frontend-Build erstellen (auf deinem Mac)
Vor jedem Sync auf deinem Mac im Ordner `backend-laravel` ausführen:
```bash
cd backend-laravel
npm run build
```

### Schritt 2: Code per rsync synchronisieren (auf deinem Mac)
Führe diesen Befehl im Hauptverzeichnis des Projekts aus:
```bash
# 1. Frontend-Assets lokal bauen
npm run build

# 2. Dateien zum Hetzner Server synchronisieren
rsync -avz --progress -e "ssh -p 222" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='storage/logs/*' \
  --exclude='storage/framework/cache/*' \
  --exclude='storage/framework/sessions/*' \
  --exclude='storage/framework/views/*' \
  ./ viminb@dedi4509.your-server.de:/usr/www/users/viminb/dataminer/
```

### Schritt 3: Migrationen & Caches auf dem Server aktualisieren
Direkt per SSH in einem Befehl ausführen:
```bash
ssh -p 222 viminb@dedi4509.your-server.de << 'EOF'
cd /usr/www/users/viminb/dataminer
composer install --no-dev --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
pm2 restart dataminer-worker --update-env 2>/dev/null || true
EOF
```

---

## 3b. Alternative: Deployment direkt via Git auf dem Server (in offener SSH-Session)

Falls der Server als Git-Repository eingerichtet ist oder du direkt in der SSH-Konsole arbeitest, kannst du das Update direkt auf dem Server durchführen:

```bash
cd /usr/www/users/viminb/dataminer
git pull origin main
composer install --no-dev --optimize-autoloader --no-interaction
npm run build
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
pm2 restart dataminer-worker --update-env 2>/dev/null || true
```

---

## 3c. E-Mail Konfiguration (SMTP) auf dem Server prüfen

Stelle sicher, dass in der `.env` auf dem Server (`/usr/www/users/viminb/dataminer/.env`) die Mailer-Konfiguration hinterlegt ist:

```env
MAIL_MAILER=smtp
MAIL_HOST=mail.your-server.de
MAIL_PORT=587
MAIL_USERNAME=apps@viminds.com
MAIL_PASSWORD="s1+BeT/F:jTD"
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=apps@viminds.com
MAIL_FROM_NAME="DataMiner"
```

*Hinweis: Wenn Sonderzeichen (`+`, `/`, `:`) im Passwort enthalten sind, das Passwort immer in Anführungszeichen setzen.*

Nach Änderungen an der `.env` immer den Konfigurations-Cache leeren:
```bash
php artisan config:clear
php artisan config:cache
```

---

## 4. Hintergrund-Worker (Queues für 100k-Verarbeitung)

Da auf dem Server `pm2` vorhanden ist, kann der Queue-Worker für parallele Hintergrundverarbeitung dauerhaft laufen:

### Worker starten:
```bash
cd /usr/www/users/viminb/dataminer
pm2 start "php artisan queue:work database --sleep=1 --tries=3 --timeout=90" --name "dataminer-worker"
pm2 save
```

### Worker-Status & Logs überwachen:
```bash
pm2 status
pm2 logs dataminer-worker
```

---

## 5. Schnelles 1-Klick Deployment-Skript

Du kannst lokal auf deinem Mac jederzeit das Skript `./scripts/deploy.sh` ausführen, um den gesamten Prozess in einem Schritt durchzuführen:

```bash
./scripts/deploy.sh
```
*(Baut das Frontend, überträgt alle geänderten Dateien via rsync, führt Migrationen aus und leert/erwärmt alle Caches auf dem Server).*
