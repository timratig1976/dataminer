# Migrations- & Implementierungsplan: Next.js $\rightarrow$ Laravel 11 / 12 (PHP)

## 1. Zielsetzung & Architektur

Das bestehende Next.js-System soll in eine robuste, deployment-fertige **Laravel PHP**-Applikation überführt werden:
- **Backend:** Laravel (PHP 8.3+) mit Eloquent ORM, Queues (Redis/PostgreSQL), Job-Worker und Livewire oder Inertia.js (React/Vue).
- **Datenbank:** PostgreSQL (Bestehendes Schema bleibt 100% kompatibel: `cases`, `rows`, `agent_runs`, `contact_rows`, `scrape_cache`, `settings`).
- **Authentifizierung & Rollen:** Laravel Breeze / Fortify + Spatie Laravel-Permission (Rollen: `Admin`, `User`, `Viewer`).
- **Hintergrundprozesse:** Laravel Queue Worker (`php artisan queue:work`) für Scrapes, Enrichment und Ziel-Suchen – ideal für das 100.000+ Zeilen Skalierungsziel!

---

## 2. Datenbank-Mapping (Drizzle $\rightarrow$ Eloquent)

| Postgres Tabelle | Next.js / Drizzle | Laravel Eloquent Model | Bemerkung |
|---|---|---|---|
| `users` | - | `App\Models\User` | Standard Laravel User + Spatie Roles |
| `cases` | `cases` | `App\Models\DataCase` | `hasMany(Row::class)`, `hasMany(AgentRun::class)` |
| `rows` | `rows` | `App\Models\Row` | `data`, `cell_statuses`, `cell_errors` als `jsonb` Casts |
| `contact_rows` | `contact_rows` | `App\Models\ContactRow` | `belongsTo(DataCase::class)`, `belongsTo(Row::class)` |
| `agent_runs` | `agent_runs` | `App\Models\AgentRun` | Multi-Step Search Runs, `state` JSONB |
| `scrape_cache` | `scrape_cache` | `App\Models\ScrapeCache` | Globaler HTML-/Markdown-Cache mit 7 Tagen TTL |
| `settings` | `settings` | `App\Models\Setting` | API-Keys (encrypted), Region, Planner-Prompt |

---

## 3. Authentifizierung & Rollen-Management

### Paket-Auswahl:
- **Auth Scaffolding:** `laravel/breeze` (Inertia + React oder Blade)
- **Rollen- & Rechte-Manager:** `spatie/laravel-permission`
  - **Rollen:**
    1. `Super-Admin`: Voller Zugriff, API-Keys konfigurieren, Nutzer & Rollen verwalten.
    2. `Editor` / `User`: Eigene Cases anlegen, Discovery/Suche starten, KI-Anreicherung ausführen, Exporte herunterladen.
    3. `Viewer`: Bestehende Cases & Tabellen nur ansehen und filtern (keine API-Kosten auslösen).

---

## 4. Kern-Services & Business-Logik Portierung (TypeScript $\rightarrow$ PHP)

1. **`EdenAiService.php` (`lib/edenai.ts`):**
   - HTTP-Client mit Timeout, Retries und 429-Backoff.
   - Methoden: `chatCompletion()`, `scrapeUrl()`, `webSearch()`.
2. **`BatchEnrichService.php` (`lib/batch-enrich.ts`):**
   - Extraktion von Firmendaten via LLM-JSON.
   - Cache-First-Prüfung in `ScrapeCache`.
3. **`ContactSearchService.php` (`lib/contact-search.ts`):**
   - Entscheider-Suche über Impressum, Google, LinkedIn.
   - Zeilen-Cache $\rightarrow$ DB-Cache $\rightarrow$ Live-Scrape Kaskade.
4. **`AgentRunnerService.php` (`lib/agent-runner.ts`):**
   - Abwicklung von Discovery-Steps und Re-Planning.
   - Dispatching als asynchrone Laravel Jobs (`App\Jobs\ExecuteAgentStep`).

---

## 5. Streaming & Realtime-Events in Laravel

- Für das tabellen-interne Ausführen von Spalten:
  - **Laravel Server-Sent Events (SSE):** `response()->stream()` für Live-Statusmeldungen pro Zeile.
  - Alternativ **Laravel Reverb / WebSockets** für langlebige Hintergrund-Jobs.

---

## 6. Phasenplan zur Migration

### Phase 1: Laravel-Scaffolding & Auth (Sofort)
- [ ] Laravel-Projekt initialisieren oder im Branch einrichten.
- [ ] Breeze & Spatie-Permission installieren.
- [ ] User-Migrationen und Rollen-Seeder (`Admin`, `User`, `Viewer`) anlegen.

### Phase 2: Datenbank & Modelle
- [ ] Migrationen für bestehende Tabellen (`cases`, `rows`, `agent_runs`, etc.) erstellen.
- [ ] Eloquent-Modelle mit JSONB-Casts (`casts = ['data' => 'array']`).

### Phase 3: Services & API-Endpunkte
- [ ] `EdenAiService`, `SearchService`, `EnrichmentService` in PHP implementieren.
- [ ] Routes für Cases, Rows, Export, Snapshot und Queue-Worker registrieren.

### Phase 4: Frontend-Integration & Deployment
- [ ] V2 UI Komponenten (Top-Bar, Sheets, Modals) auf Blade/Livewire oder Inertia-React übertragen.
- [ ] Docker / Deploy-Konfiguration (Nginx, PHP-FPM, Supervisor für Queue-Worker).
