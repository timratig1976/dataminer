# DataMiner – Table UI Enhancement Plan
> **Ziel:** Robuste, komfortablere Cases-Tabelle – inspiriert von Clay's Datatable-UX.  
> Kein komplettes Redesign. Evolution & Enhancement auf dem bestehenden Stack.

**UI-Referenz-Screenshots:** [`docs/clay-ui-reference/`](./clay-ui-reference/README.md)

---

## Analyse: Was Clay gut macht

### 1. Column Header Context Menu
![Clay Column Header Menu](./clay-ui-reference/01-column-header-menu.png)

Clay öffnet per Klick auf den Spaltenheader ein vollständiges Kontextmenü:
- Rename, Edit column, Insert left/right
- Change color, Pin, Hide, Delete
- Sort A→Z / Z→A direkt aus dem Menü
- **„Filter on this column"** – Filter wird vorausgefüllt mit genau dieser Spalte

**Was uns fehlt:** Kein Kontextmenü. Spaltenverwaltung ist umständlich.

---

### 2. Filter-UI als Popover
![Clay Filter UI](./clay-ui-reference/02-filter-ui.png)

Strukturierter Filter-Builder direkt über der Tabelle:
- `Where [Spalte ▾] [Operator ▾] [Wert]`
- `+ Add filter` / `+ Add filter group` / `✕ Clear filters`
- Aktiver Filter sichtbar durch Badge in der Toolbar

**Was uns fehlt:** Nur rudimentäre Suche, kein strukturierter Filter-Builder.

---

### 3. Sort-UI als Popover
![Clay Sort UI](./clay-ui-reference/07-sort-ui.png)

Multi-Column Sort mit:
- Zeile: `[Spalte auswählen ▾] [Richtung ▾] [🗑️]`
- `+ Add sort` für weitere Ebenen

**Was uns fehlt:** Kein Multi-Sort.

---

### 4. AI Column Config – Side Panel
![Clay AI Column Generate](./clay-ui-reference/04-ai-column-generate.png)
![Clay AI Column Configure](./clay-ui-reference/05-ai-column-configure.png)
![Clay AI Column JSON Schema](./clay-ui-reference/06-ai-column-json-schema.png)

Clay öffnet bei KI-Spalten ein **rechtes Side-Panel** (kein Modal!) mit zwei Tabs:

**Generate-Tab:**
- Freitextfeld: *"Was soll die KI tun?"*
- `/` zum Einfügen von Spaltenreferenzen (`{{Domain}}`, `{{Firmenname}}`)
- `✨ Generate`-Button generiert optimierten Prompt automatisch

**Configure-Tab:**
- Use Case (Web research, etc.)
- Model-Auswahl
- Prompt-Editor mit Spaltenreferenzen
- Define Outputs: Fields oder **JSON Schema** (eigenes Schema definierbar)
- Run Settings: Auto-run Toggle, Bedingung hinzufügen, Delay

**Was uns fehlt:** Unser `EditPromptModal` ist ein blockierendes Modal – das Side-Panel-Pattern ist deutlich komfortabler, weil man die Tabelle im Hintergrund sehen kann.

---

### 5. Toolbar – Kompakte Statusanzeige
![Clay Toolbar Search](./clay-ui-reference/08-toolbar-search.png)

Toolbar zeigt: `46/48 columns · 12.014/12.014 rows · [▽ Filter] [⇅ Sort] [🔍]`

**Was uns fehlt:** Keine Zähler, keine Statusanzeige in der Toolbar.

---

## Enhancement-Plan

> **Scope:** Nur die 5 unten beschriebenen Bereiche.  
> Keine neuen Spaltentypen (Text/Number/Date/etc.) – das ist ein anderes Feature.

---

### Sprint 1 · Column Header Menu ⭐⭐⭐⭐⭐
**Aufwand:** ~1 Tag | **Wirkung:** Sofort spürbar

**Neue Komponente:** `resources/js/Components/table/ColumnHeaderMenu.tsx`

Menüstruktur:
```
✏️  Spalte umbenennen      → Inline-Input direkt im Header
←   Spalte links einfügen  → Neue leere Spalte
→   Spalte rechts einfügen → Neue leere Spalte
─────────────────────────────
🔼  Sortieren A → Z
🔽  Sortieren Z → A  
▽   Nach dieser Spalte filtern  → Filter-Panel öffnet vorausgefüllt
─────────────────────────────
📌  Spalte fixieren (Pin)
👁️  Spalte ausblenden
🗑️  Spalte löschen         → Bestätigungs-Dialog
```

**Trigger:** Klick auf `▾`-Icon im Header (erscheint bei Hover).

**Keine Breaking Changes** an bestehender Tabellenlogik – reines UI-Overlay.

---

### Sprint 2 · Filter & Sort Popover ⭐⭐⭐⭐⭐
**Aufwand:** ~1 Tag | **Wirkung:** Sehr hoch – oft genutzt

**Neue Komponenten:**
- `resources/js/Components/table/FilterPanel.tsx`
- `resources/js/Components/table/SortPanel.tsx`
- `resources/js/hooks/useTableFilter.ts`
- `resources/js/hooks/useTableSort.ts`

**Filter-UI:**
```
Where  [Spalte auswählen ▾]  [equal to ▾]  [________________]  [👁️] [···]
       [+ Add filter]   [+ Add filter group]   [✕ Clear filters]
```

Filter-Operatoren je Typ:
- Text: `contains`, `equal to`, `starts with`, `is empty`, `is not empty`
- Zahl: `=`, `>`, `<`, `between`
- Status: `is`, `is not`

**Sort-UI:**
```
[Spalte auswählen ▾]  [A → Z ▾]  [🗑️]
[+ Add sort]
```

**Toolbar-Badge:** Bei aktivem Filter → `▽` wird blau + Zahl der aktiven Filter.

---

### Sprint 3 · Toolbar Redesign ⭐⭐⭐⭐
**Aufwand:** ~0,5 Tage | **Wirkung:** Sofort sichtbar

**Neue Toolbar-Struktur:**
```
[▶ Run]  [👁️ View ▾]  [📊 {n} Spalten]  [📋 {m}/{total} Einträge]  [▽]  [⇅]  [🔍 Suche...]
```

Details:
- `{n} Spalten` → Klick öffnet Column-Visibility-Panel (Toggle je Spalte)
- `{m}/{total} Einträge` → zeigt gefiltert/gesamt: z.B. `234/1.204`
- Filter `▽` und Sort `⇅` Icons werden **blau** wenn aktiv

**Betroffene Datei:** `resources/js/Pages/Cases/Show.tsx` (Toolbar-Bereich)

---

### Sprint 4 · AI Column als Side Panel ⭐⭐⭐⭐
**Aufwand:** ~1 Tag | **Wirkung:** Hoch – tägliche Nutzung

**Refactoring:** `EditPromptModal.tsx` → wird zum Side Panel (kein blockierendes Modal mehr)

Vorteile:
- Tabelle bleibt im Hintergrund sichtbar
- Nutzer kann andere Spalten als Referenz sehen
- Prompt-Feld mit `/`-Trigger für Spaltenreferenzen: `{{Firmenname}}`, `{{Website}}`

**Neue Komponente:** `resources/js/Components/table/AiColumnSidePanel.tsx`

Struktur:
```
┌─────────────────────────────────┐
│ ✨ KI-Anreicherung  ✏️  [□ ✕]  │  ← Header mit Name + Edit
├─────────────────────────────────┤
│ [Generate] [Configure]          │  ← Tabs
├─────────────────────────────────┤
│ Prompt:                         │
│ ┌───────────────────────────┐   │
│ │ Für {{Firmenname}}, finde │   │
│ │ die E-Mail des CEO...     │   │
│ └───────────────────────────┘   │
│ Tippe / für Spaltenreferenz     │
│                    [✨ Generate] │
├─────────────────────────────────┤
│ ▼ Run Settings                  │
│   Auto-run  [●──]               │
│   [ ] Bedingung hinzufügen      │
│   ● Sofort ausführen            │
│   ○ Mit Verzögerung             │
├─────────────────────────────────┤
│ ⚠ Kein Spaltenbezug – läuft    │
│   nicht automatisch.            │
│                    [💾 Speichern]│
└─────────────────────────────────┘
```

---

### Sprint 5 · Zell-Interaktionen & Row Detail ⭐⭐⭐
**Aufwand:** ~1 Tag | **Wirkung:** Mittel – Komfortgewinn

**Features:**

1. **Zell-Expand:** Hover über Zelle → `⤢`-Icon → Popover mit vollem Inhalt (kein Truncate mehr)
2. **Row Hover Menu:** Hover über Zeile → rechts erscheinen: `[✏️] [🗑️] [↗]`
3. **Multi-Select Checkbox:** Ganz linke Spalte – bei Auswahl erscheint Bulk-Aktionsleiste:
   ```
   3 Einträge ausgewählt  [📤 Exportieren]  [🗑️ Löschen]  [✕ Auswahl aufheben]
   ```
4. **Row Detail Panel:** Klick auf Zeilen-Icon → Side-Panel mit allen Feldern (wie Clay's Record Detail)

---

## Technische Architektur

```
resources/js/
├── Components/
│   └── table/                         ← neues Verzeichnis
│       ├── ColumnHeaderMenu.tsx        ← Sprint 1
│       ├── FilterPanel.tsx             ← Sprint 2
│       ├── SortPanel.tsx               ← Sprint 2
│       ├── TableToolbar.tsx            ← Sprint 3 (Refactor)
│       ├── AiColumnSidePanel.tsx       ← Sprint 4 (Refactor EditPromptModal)
│       ├── CellExpand.tsx              ← Sprint 5
│       └── ColumnVisibilityPanel.tsx   ← Sprint 3
└── hooks/
    ├── useTableFilter.ts               ← Sprint 2
    ├── useTableSort.ts                 ← Sprint 2
    └── useTableColumns.ts              ← Sprint 1+3
```

**Bestehende Dateien die angepasst werden:**
- `resources/js/Pages/Cases/Show.tsx` → Toolbar + Column-Header-Hooks einbinden
- `resources/js/Components/case/EditPromptModal.tsx` → zu Side Panel migrieren

---

## Priorisierung

| Sprint | Feature | Aufwand | UX-Gewinn | Priorität |
|--------|---------|---------|-----------|-----------|
| 1 | Column Header Menu | 1 Tag | ⭐⭐⭐⭐⭐ | 🔴 Hoch |
| 2 | Filter & Sort Popover | 1 Tag | ⭐⭐⭐⭐⭐ | 🔴 Hoch |
| 3 | Toolbar Redesign | 0,5 Tage | ⭐⭐⭐⭐ | 🟡 Mittel |
| 4 | AI Column Side Panel | 1 Tag | ⭐⭐⭐⭐ | 🟡 Mittel |
| 5 | Zell-Interaktionen | 1 Tag | ⭐⭐⭐ | 🟢 Nice-to-have |

**Empfehlung:** Sprint 1 + 2 zuerst (2 Tage) – danach entscheiden.

---

## Was NICHT gemacht wird (Scope-Ausschluss)

- ❌ Neue Spaltentypen (Text/Number/Date/URL/Email etc.) – zu viel Backend-Aufwand
- ❌ Views / Saved Filters speichern – Phase 2
- ❌ Drag-to-reorder Spalten per Maus – separates Feature
- ❌ Komplettes Tabellen-Redesign – Evolution, kein Rewrite
