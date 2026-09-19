# Master-Migrationsplan: Next.js (TypeScript) → Laravel 12 (PHP 8.3+)
**Autor:** Leitender PHP-Architekt & Migrations-Spezialist  
**Datum:** 20. September 2026  
**Ziel:** 100% vollständige, kompromisslose Rekonstruktion aller Datenmodelle, Backend-Algorithmen, UI-Komponenten und interaktiven Workflows. Keine Dummies, keine abgespeckten Modals, volle 100k+ Skalierung.

---

## 1. IST-Zustand & Quantitative Analyse

| Bereich | Next.js Source | Laravel Vorhanden | Fehlende Abdeckung / Differenz |
|---|---|---|---|
| **API-Routen** | **56 Endpunkte** | 22 Routen | **34 Endpunkte fehlen** (v.a. Spezial-Workflows wie `extrapolate-email`, `sub-industries`, `dedupe`, `flag-catalog`, etc.) |
| **Backend-Services** | **28 Module (10.160 Zeilen)** | 11 Services | Sub-Engines für Apollo, Catalog-Registry, Catalog-Scraper, Operations-Manager |
| **Frontend-Modals** | **2.768 Zeilen in 5 Modals** | 754 Zeilen | **2.014 Zeilen UI-Funktionalität fehlen** (`AgentGoalModal`: 1.084 vs 103 Zeilen; `AddColumnModal`: 942 vs 305 Zeilen) |
| **Tabellen-Engine** | `GroupedTableView` + Inline Editing | Standard-Table mit Paginierung | Gruppierte Phasenansicht, Inline-Cell-Editor, Status-Badges, Bulk-Actions |

---

## 2. Detaillierte Modul- & Komponenten-Matrix

### A. Frontend Modals & Views (Gegenüberstellung)

#### 1. `AgentGoalModal.tsx` (Original: 1.084 Zeilen ➔ Bisher: 103 Zeilen)
* **Was im Original existiert:**
  - **Plan-Visualisierung:** Multi-Step-Liste mit Icons (`google_maps`, `google_search`, `catalog_scrape`), geschätzten Treffern, Priorität und Ziel-Regionszuordnung.
  - **Live-Execution-Engine:** Schrittweise Ausführung via `POST /api/cases/[id]/agent/[runId]/step`, Pause/Resume, Stop-Button.
  - **Kosten- & Token-Kalkulator:** Live-Berechnung verbrauchter USD-Kosten und API-Calls pro Schritt.
  - **Ergebnis-Preview:** Sofortige Anzeige neu gefundener Unternehmen im Modal während des Laufs.
  - **Plan-Editor:** Manuelles Bearbeiten, Hinzufügen, Löschen oder Umsortieren von Schritten vor dem Start.
* **Migrations-Aktion:**
  - Original-Modal [components/AgentGoalModal.tsx](components/AgentGoalModal.tsx) vollständig nach `backend-laravel/resources/js/Components/AgentGoalModal.tsx` übernehmen.
  - Anbindung an die neuen Laravel Controller-Methoden `store()`, `executeStep()`, `stream()`.

#### 2. `AddColumnModal.tsx` (Original: 942 Zeilen ➔ Bisher: 305 Zeilen)
* **Was im Original existiert:**
  - **Presets-Katalog:** 9 vordefinierte Vorlagen mit Ein-Klick-Übernahme.
  - **Input-Mappings (`inputMappings`):** Verknüpfung von Eingabefeldern (z.B. `official_domain` aus Spalte A an Prompt-Platzhalter `{official_domain}`).
  - **Bedingte Ausführung (`conditions`):** `empty` (nur wenn leer), `require_input` (nur wenn Quelle befüllt), `not_empty`.
  - **Multi-Output JSON-Keys (`multiKeys`):** Ein einzelner LLM-Aufruf befüllt mehrere Spalten gleichzeitig (z.B. Impressum ➔ Name, Adresse, GF, USt-ID).
  - **Web-Search & Crawl-Settings:** Aktivierung von Google-Suche vor LLM-Extraktion (`useWebSearch`, `searchQuery`, `evidenceMode`).
* **Migrations-Aktion:**
  - Original-Code [components/AddColumnModal.tsx](components/AddColumnModal.tsx) 1:1 übernehmen und Pfade anpassen.

#### 3. `GroupedTableView.tsx` (Original: 478 Zeilen ➔ Bisher: Nicht integriert)
* **Was im Original existiert:**
  - Umschaltung zwischen **Flacher Ansicht** und **Phasen-Gruppierung** (`Company` vs. `Contact` vs. `Details`).
  - Zeilen-Aktionen: Einzelne Zelle ausführen, Zeile löschen, Domain auflösen.
  - Inline-Zellen-Editor: Doppelklick öffnet Text-Editor zum direkten Korrigieren von Feldern mit `PATCH /api/rows/[id]`.
* **Migrations-Aktion:**
  - `GroupedTableView.tsx` direkt als primären Tabellen-Renderer in `Cases/Show.tsx` einbinden.

---

### B. Fehlende Backend-Services & API-Routen

Zur vollständigen Abdeckung der 56 Next.js-Routen werden folgende PHP-Services implementiert bzw. komplettiert:

#### 1. Deduping & Datenbereinigung
- **Next.js:** `/api/cases/[id]/dedupe`, `/api/contact-rows/cleanup`
- **Laravel-Ziel:** `DeduplicationService.php` mit atomaren PostgreSQL-Queries (`DELETE FROM rows WHERE id NOT IN (SELECT min(id) ... GROUP BY lower(trim(data->>'domain')))`).

#### 2. E-Mail-Extrapolation & Verifikation
- **Next.js:** `/api/cases/[id]/extrapolate-email`, `/api/verify-email`, `/api/verify-email-all`
- **Laravel-Ziel:** Ausbau von [backend-laravel/app/Services/EmailExtrapolatorService.php](backend-laravel/app/Services/EmailExtrapolatorService.php) mit MX-Record-Check und Pattern-Generierung (Vorname.Nachname@, FirstInitial.Last@ etc.).

#### 3. Domain-Resolution & Catalog-Handling
- **Next.js:** `/api/cases/[id]/resolve-domains`, `/api/cases/[id]/flag-catalog`, `/api/cases/[id]/reflag-catalogs`
- **Laravel-Ziel:** `DomainResolverService.php` zur automatischen Erkennung offizieller Webseiten aus Branchenverzeichnis-Einträgen.

#### 4. Contact-Rows Synchronisation
- **Next.js:** `/api/contact-rows`, `/api/contact-rows/extract`
- **Laravel-Ziel:** Automatisches Befüllen der Tabelle `contact_rows` bei Ausführung von `batch_contact`, damit der Tab **`👤 Kontakte`** sofort befüllt wird.

---

## 3. Schritt-für-Schritt Umsetzungs-Phasen

### Phase 1: Vollständige Modals 1:1 übernehmen
1. Portierung von `AddColumnModal.tsx` (942 Zeilen) inklusive aller Form-Validatoren und Presets.
2. Portierung von `AgentGoalModal.tsx` (1.084 Zeilen) mit Plan-Vorschau und Schritt-Steuerung.
3. Bereitstellung der Hilfs-Hooks (`useRunColumns.ts`, `useAgentRun.ts`) im Laravel-Frontend.

### Phase 2: Tabellen-Engine & Inline-Editing
1. Integration von `GroupedTableView.tsx` in `Cases/Show.tsx`.
2. Bereitstellung von `PATCH /api/rows/{id}` für Live-Zelländerungen.
3. Anbindung der 6 Sheet-Tabs (`Firmen`, `Kontakte`, `Suchen`, `Quellen`, `Log`, `Export`).

### Phase 3: Backend-Algorithmen vervollständigen
1. Implementierung von `DeduplicationService` (`POST /api/cases/{id}/dedupe`).
2. Anbindung von `ContactRow`-Extraktion an `batch_contact`.
3. Bereitstellung von `POST /api/cases/{id}/resolve-domains`.

### Phase 4: Qualitätsprüfung & Live-Verifikation
1. Durchführung eines echten Live-Laufs für Phase 1 (`batch_company`) und Phase 2 (`batch_contact`).
2. Snapshot-Export und Re-Import-Test zur Validierung der Datenintegrität.
3. 100% grüne Tests (Unit- und Feature-Tests).
