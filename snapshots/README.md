# DataMiner Snapshots

Automatische Backups aller Cases als JSON-Snapshots.

## Inhalt

| Datei | Case | Zeilen | Datum |
|---|---|---|---|
| `2026-09-21_Tourismus_Gastgewerbe_MV.json` | Tourismus/Gastgewerbe in MV | 114 | 2026-09-21 |
| `2026-09-19_Wohnungsgenossenschaften_MV.json` | Wohnungsgenossenschaften MV | 712 | 2026-09-19 |
| `2026-09-19_Schulte.json` | Schulte | 3.078 | 2026-09-19 |
| `2026-09-19_Automated_Test_Case.json` | Automated Test Case | 1 | 2026-09-19 |

## Wiederherstellung

Einen Snapshot über die API importieren:

```bash
curl -X POST http://localhost:3000/api/import/snapshot \
  -H "Content-Type: application/json" \
  -d "@snapshots/2026-09-19_Wohnungsgenossenschaften_MV.json"
```

Oder im Browser: **Alle Cases → Snapshot → Importieren**.
