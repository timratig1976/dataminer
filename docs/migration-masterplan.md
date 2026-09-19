# Migrations-Masterplan: DataMiner → Laravel + 100k Power

**Stand:** 2026-09-19  
**Ziel:** Vollständige Ablösung des Next.js-Stacks durch Laravel (PHP) als Backend + Inertia/React als Frontend. 100.000+ Zeilen Enrichment-Kapazität.

---

## 🟢 Bereits fertig (Phase 1 & 2 abgeschlossen)

| Was | Datei |
|---|---|
| DB-Migrationen (alle 6 Tabellen) | `backend-laravel/database/migrations/` |
| Eloquent-Modelle | `app/Models/{DataCase,Row,AgentRun,ContactRow,ScrapeCache,GlobalSetting}.php` |
| Auth: Sanctum + Spatie Roles | `routes/api.php` + `RoleAndPermissionSeeder.php` |
| CRUD: Cases, Rows, Export | `Api/{CaseController,RowController,ExportController}.php` |
| EnrichmentJob + SSE-Stream | `Api/EnrichmentJobController.php` |
| Queue-Job mit `FOR UPDATE SKIP LOCKED` | `Jobs/ProcessEnrichmentChunk.php` |
| Services: EdenAI, BatchEnrich, ContactSearch | `app/Services/` |
| Feature-Tests (3/3 grün) | `tests/Feature/DataMinerApiTest.php` |

---

## 🔴 Phase 3 — Fehlende Services portieren (Backend-Fertigstellung)

### 3A · `AgentRunnerService.php` + Discovery-Loop
**Quelle:** `lib/agent-runner.ts`, `lib/discovery.ts`, `lib/planner.ts`  
**Aufwand:** ~2 Tage

```
backend-laravel/app/Services/
  AgentRunnerService.php     ← Plan → Execute → Observe → Decide Loop
  PlannerService.php         ← LLM erstellt DiscoveryPlan (JSON), Regionen-Injection
  DiscoveryService.php       ← webSearch / mapsSearch → SeedRows
  CatalogScraperService.php  ← Paginated link extractor

backend-laravel/app/Jobs/
  ExecuteAgentStep.php       ← Queue-Job für jeden Plan-Step (async!)

backend-laravel/app/Http/Controllers/Api/
  AgentRunController.php     ← POST /api/agent/runs, GET /api/agent/runs/{id}/stream
```

**Schlüssel-Logik:**
- `PlannerService`: LLM-Call → `DiscoveryPlan` als JSON, Regionen aus PHP-Array (analog `lib/regions.ts`)
- `ExecuteAgentStep`: Queue-Job, ruft Search-API auf, schreibt Ergebnisse in `rows`, updated `agent_runs.state`
- `AgentRunController::stream()`: SSE-Endpoint, pollt `agent_runs` 1×/s, sendet aggregierten Progress
- Validierung von Maps-Places via LLM (analog `validatePlaces()` in agent-runner.ts)

---

### 3B · `SearchService.php` + `MapsService.php`
**Quelle:** `lib/search.ts`, `lib/maps.ts`, `lib/discovery-client.ts`  
**Aufwand:** ~1 Tag

```
backend-laravel/app/Services/
  SearchService.php    ← Provider-Abstraction: SerpAPI, Serper, Brave, Scrapling, DuckDuckGo
  MapsService.php      ← Google Maps via SerpAPI/Serper/Scrapling
  FirecrawlService.php ← Scrape URL + Search (ergänzt EdenAiService)
```

**Schlüssel-Logik:**
- Provider-Kaskade: `auto` → günstigsten verfügbaren Key wählen
- Rate Limiting: Laravel `RateLimiter::attempt()` per Provider
- `SearchResult` → `DiscoveryHit` Mapping inkl. Domain-Normalisierung via PHP-Port von `psl`

---

### 3C · `ImportService.php`
**Quelle:** `lib/import-parser.ts`, `app/api/import/`  
**Aufwand:** ~0.5 Tage

```
backend-laravel/app/Services/
  ImportService.php    ← CSV, XLSX, JSON-Snapshot → rows[] 

backend-laravel/app/Http/Controllers/Api/
  ImportController.php ← POST /api/import (CSV/XLSX), POST /api/import/snapshot
```

**Schlüssel-Logik:**
- CSV: `league/csv` Paket
- XLSX: `phpoffice/phpspreadsheet` Paket
- Snapshot-Import: JSON → `DataCase` + `Row[]` bulk-insert mit `upsert()`
- Chunk-Inserts: 500er Batches via `Row::insert()` für 100k-Performance

---

### 3D · `SettingsController.php`
**Quelle:** `lib/secrets.ts`, `app/api/settings/`  
**Aufwand:** ~0.5 Tage

```
backend-laravel/app/Http/Controllers/Api/
  SettingsController.php  ← GET/PUT /api/settings/{key}
```

**Schlüssel-Logik:**
- `GlobalSetting` Model mit Eloquent `encrypted` Cast für API-Keys
- Keys: `edenai_key`, `serpapi_key`, `serper_key`, `brave_key`, `firecrawl_key`, `openai_key`, `planner_prompt`, `region`

---

### 3E · `ProfileScraperService.php` + `EmailExtrapolatorService.php`
**Quelle:** `lib/profile-scraper.ts`, `lib/email-extrapolator.ts`  
**Aufwand:** ~0.5 Tage

```
backend-laravel/app/Services/
  ProfileScraperService.php      ← Impressum-Parsing → Kontaktdaten
  EmailExtrapolatorService.php   ← LLM + Schema → E-Mail-Varianten generieren
```

---

## 🟡 Phase 4 — Frontend auf Inertia/React migrieren

**Strategie:** Bestehende React-Komponenten (`components/`) können zu ~70% wiederverwendet werden.  
Next.js App Router → Inertia.js Controller-Responses.

### Setup
```bash
# In backend-laravel/:
composer require inertiajs/inertia-laravel
npm install @inertiajs/react react react-dom
```

### Komponentenmapping

| Next.js Seite | Inertia-Page | Wiederverwendung |
|---|---|---|
| `app/page.tsx` (Dashboard) | `resources/js/Pages/Dashboard.tsx` | ~80% |
| `app/cases/page.tsx` | `resources/js/Pages/Cases/Index.tsx` | ~90% |
| `app/cases/[id]/page.tsx` (3400 Zeilen!) | `resources/js/Pages/Cases/Show.tsx` | ~85% |
| `app/settings/page.tsx` | `resources/js/Pages/Settings.tsx` | ~80% |
| `components/GroupedTableView.tsx` | direkt übernehmen | 100% |
| `components/AddColumnModal.tsx` | direkt übernehmen | 100% |
| `components/ImportWizard.tsx` | direkt übernehmen | 95% |
| `hooks/useCaseData.ts` | → `usePage().props` + axios | ~60% |
| `hooks/useAgentRun.ts` | direkt übernehmen (SSE gleich) | 90% |

### Routing (Inertia-Controller)

```php
// routes/web.php
Route::middleware(['auth'])->group(function () {
    Route::get('/', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/cases', [CasePageController::class, 'index'])->name('cases.index');
    Route::get('/cases/{case}', [CasePageController::class, 'show'])->name('cases.show');
    Route::get('/settings', [SettingsPageController::class, 'index'])->name('settings.index');
});
```

---

## 🔵 Phase 5 — 100k Deployment & Infrastruktur

### Queue-Worker (Supervisor)
```ini
# /etc/supervisor/conf.d/dataminer-worker.conf
[program:dataminer-worker]
command=php /var/www/dataminer/artisan queue:work pgsql --tries=3 --timeout=90 --sleep=1
numprocs=8          ; 8 parallele Worker = ~50 Rows/s Enrichment-Throughput
autostart=true
autorestart=true
```

### Nginx
```nginx
server {
    listen 80;
    root /var/www/dataminer/public;
    index index.php;
    location / { try_files $uri $uri/ /index.php?$query_string; }
    location ~ \.php$ { fastcgi_pass unix:/run/php/php8.3-fpm.sock; }
}
```

### PHP-FPM Tuning für 100k
```ini
; /etc/php/8.3/fpm/pool.d/www.conf
pm = dynamic
pm.max_children = 50
pm.start_servers = 10
pm.min_spare_servers = 5
pm.max_spare_servers = 20
pm.max_requests = 500        ; Memory-Leak-Prävention
```

### PostgreSQL-Indizes (bereits in Migration, hier zur Erinnerung)
```sql
CREATE INDEX rows_case_id_idx      ON rows(case_id);
CREATE INDEX rows_status_idx       ON rows(case_id, (cell_statuses->>'status'));
CREATE INDEX scrape_cache_url_idx  ON scrape_cache(url);
```

### Redis für Queue & Cache
```bash
# .env
CACHE_DRIVER=redis
QUEUE_CONNECTION=redis    # schneller als pgsql bei >10k Jobs
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

---

## 📅 Zeitplan (realistisch, solo)

| Phase | Inhalt | Dauer |
|---|---|---|
| **Phase 3A** | AgentRunner + Discovery + Planner | 2 Tage |
| **Phase 3B** | SearchService + MapsService + Firecrawl | 1 Tag |
| **Phase 3C** | ImportService (CSV/XLSX/Snapshot) | 0,5 Tage |
| **Phase 3D** | SettingsController (API-Keys) | 0,5 Tage |
| **Phase 3E** | ProfileScraper + EmailExtrapolator | 0,5 Tage |
| **Phase 4** | Frontend Inertia/React Port | 3–4 Tage |
| **Phase 5** | Deployment + Supervisor + Nginx | 1 Tag |
| **Buffer** | Tests, Bugfixes, Feinschliff | 1 Tag |
| **GESAMT** | | **~9–10 Tage** |

---

## 🚀 Empfohlene Reihenfolge zum Starten

```
1. Phase 3C (Import)  ← einfachstes, sofort testbar
2. Phase 3D (Settings) ← Voraussetzung für alle API-Calls
3. Phase 3B (Search)   ← Basis für Discovery
4. Phase 3A (Agent)    ← Krönung, alles baut darauf auf
5. Phase 3E (Profile)  ← parallel zu 4 möglich
6. Phase 4 (Frontend)  ← wenn Backend 100% steht
7. Phase 5 (Deploy)    ← zum Schluss
```

---

## Nächster Schritt

```
Sag einfach: "Start Phase 3C" oder "Start Phase 3D" 
und ich implementiere den Code direkt.
```
