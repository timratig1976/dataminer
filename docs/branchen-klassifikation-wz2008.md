# Branchen-Klassifikationssystematik für DataMiner (WZ 2008 & NACE Rev. 2)

> **Zweck:** Leitfaden und Referenzarchitektur für die automatisierte Branchen-Erkennung, Kategorisierung und Filterung von B2B-Unternehmen mittels KI (LLM-Prompts) und Anreicherungs-Pipelines.

---

## 1. Warum WZ 2008 / NACE Rev. 2?

- **Offizieller Standard in Deutschland & der EU:**  
  Die **WZ 2008** (*Klassifikation der Wirtschaftszweige des Statistischen Bundesamtes / Destatis*) basiert 1:1 auf der europäischen **NACE Rev. 2** (*Statistical Classification of Economic Activities in the European Community*).
- **Handelsregister & Verbände:**  
  Jedes amtlich erfasste Unternehmen in Deutschland, Creditreform, Bürgel und Handelsregisterberichte sind nach dieser Systematik aufgebaut.
- **LLM-Kompatibilität:**  
  GPT-4o, Claude und Gemini kennen die NACE/WZ-Hierarchie vollständig und können aus Impressums- und Leistungsbeschreibungen treffsicher den passenden 2- bis 5-stelligen Code ableiten.

---

## 2. Die 4-Stufen-Hierarchie der Klassifikation

Die Systematik gliedert sich von der groben Makro-Ebene bis zur feinen Spezialisierung:

```
Ebene 1: Abschnitt (1 Buchstabe A–U)         z. B. "C" Verarbeitendes Gewerbe
Ebene 2: Abteilung (2 Ziffern)               z. B. "28" Maschinenbau
Ebene 3: Gruppe & Klasse (3–4 Ziffern)       z. B. "28.22" Herstellung von Hebezeugen & Fördermitteln
Ebene 4: Unterklasse (5 Ziffern, Dtl.)       z. B. "28.22.1" Herstellung von Personen- & Lastenaufzügen
```

---

## 3. Die 21 Hauptabschnitte (Ebene 1: Abschnitte A bis U)

Für B2B-Lead-Generierung, Case-Filter und Top-Level-Badges in DataMiner:

| Code | Bezeichnung | Relevante Kernbereiche & typische Zielgruppen |
|:---:|:---|:---|
| **A** | Land- und Forstwirtschaft, Fischerei | Agrarbetriebe, Gartenbau, Forstwirtschaft |
| **B** | Bergbau und Gewinnung von Steinen und Erden | Kieswerke, Steinbrüche, Rohstoffgewinnung |
| **C** | **Verarbeitendes Gewerbe (Industrie / Produktion)** | Maschinenbau, Metallverarbeitung, Lebensmittel, Chemie, Automotive |
| **D** | Energieversorgung | Strom, Gas, Fernwärme, Solarparks, Windenergie |
| **E** | Wasserversorgung; Abwasser- & Abfallentsorgung | Recyclingbetriebe, Entsorger, Kläranlagen |
| **F** | **Baugewerbe / Handwerk** | Hochbau, Tiefbau, Dachdecker, Elektroinstallation, SHK (Sanitär, Heizung, Klima) |
| **G** | **Handel; Instandhaltung & Reparatur von Kfz** | Großhandel (B2B), Einzelhandel, Autohäuser, Werkstätten |
| **H** | **Verkehr und Lagerei (Logistik)** | Speditionen, Transportunternehmen, Lagerhaltung, Kurierdienste |
| **I** | **Gastgewerbe & Tourismus** | Hotels, Pensionen, Restaurants, Catering, Ferienanlagen |
| **J** | **Information und Kommunikation** | Softwareentwicklung (SaaS), IT-Systemhäuser, Verlage, Telekommunikation |
| **K** | Erbringung von Finanz- und Versicherungsdienstleistungen | Banken, Versicherungen, Makler, Fintechs |
| **L** | **Grundstücks- und Wohnungswesen** | Wohnungsbaugesellschaften, Immobilienmakler, Hausverwaltungen |
| **M** | **Erbringung von freiberuflichen, wissenschaftl. Dienstleistungen** | Rechtsanwälte, Steuerberater, Unternehmensberater, Ingenieurbüros, Architekten, Marketingagenturen |
| **N** | **Erbringung von sonstigen wirtschaftlichen Dienstleistungen** | Personaldienstleister (Zeitarbeit), Sicherheitsdienste, Gebäudereinigung, Callcenter |
| **O** | Öffentliche Verwaltung, Verteidigung; Sozialversicherung | Kommunen, Behörden, Verbände |
| **P** | Erziehung und Unterricht | Schulen, Universitäten, private Weiterbildungsinstitute |
| **Q** | **Gesundheits- und Sozialwesen** | Krankenhäuser, Arztpraxen, Pflegeheime, Medizintechnik-Anwender |
| **R** | Kunst, Unterhaltung und Erholung | Theater, Fitnessstudios, Freizeitparks, Sportvereine |
| **S** | Erbringung von sonstigen Dienstleistungen | Interessensverbände, Reparatur von Computern & Gebrauchsgütern |
| **T** | Private Haushalte | Haushalte als Arbeitgeber |
| **U** | Exterritoriale Organisationen | Botschaften, Internationale Organisationen |

---

## 4. Ziel-Datenmodell für DataMiner (Cases-Tabelle)

Wenn die KI eine Website analysiert, soll sie **folgende 4 Ausgabespalten** strukturiert füllen:

| Spalten-Key (`key`) | Typ | Beschreibung | Beispielwert |
|:---|:---:|:---|:---|
| `industry_primary` | Text | Lesbare Überkategorie (aus den Top-20 Branchen) | `Handwerk & Baugewerbe` |
| `wz_code` | Text | Offizieller WZ 2008 / NACE 4- oder 5-Steller | `43.22.0` |
| `wz_name` | Text | Offizieller Titel der WZ 2008-Klasse | `Gas-, Wasser-, Heizungs- sowie Lüftungs- und Klimainstallation` |
| `industry_tags` | Text / JSON | Konkrete Leistungsschwerpunkte der Firma | `Wärmepumpen, Badsanierung, Solarthermie` |
| `b2b_b2c` | Select | Primäre Zielgruppe | `B2B`, `B2C` oder `Hybrid` |

---

## 5. Vorlage für den System-Prompt (Prompt-Entwurf)

Dieser Prompt kann direkt in das neue Side-Panel als Preset übernommen werden:

```text
Du bist ein Experte für die Klassifikation von Unternehmen nach dem amtlichen deutschen System "WZ 2008" (Klassifikation der Wirtschaftszweige, kompatibel zu NACE Rev. 2).

Deine Aufgabe:
Analysiere die vorliegenden Daten des Unternehmens (Firmenname: "{company_name}", Website-Inhalt/Text: "{_scrape_cached}", Beschreibung: "{description}").

Ordne das Unternehmen exakt in die WZ 2008 Systematik ein und extrahiere folgende Attribute im JSON-Format:

{
  "industry_primary": "Eine verständliche Hauptkategorie (z. B. IT & Software, Maschinenbau, Handwerk & Bau, Tourismus & Gastgewerbe, Großhandel, Beratung & Recht, Gesundheit)",
  "wz_code": "Exakter 4- oder 5-stelliger WZ 2008 Code (z.B. 62.01, 43.22.0, 55.10.1)",
  "wz_name": "Offizielle amtliche Bezeichnung der WZ-Klasse",
  "industry_tags": "3 bis 5 konkrete Schlagworte zu Spezialisierung und Angebot, kommagetrennt",
  "b2b_b2c": "B2B | B2C | Hybrid",
  "confidence": "high | medium | low"
}

Regeln:
1. Wenn es sich um ein Handwerksunternehmen handelt (z. B. Sanitär/Heizung), nutze Abschnitt F (Code 41, 42 oder 43).
2. Wenn es sich um reine Software-/SaaS-Entwicklung handelt, nutze Abschnitt J (Code 62.01).
3. Wenn das Unternehmen mehrere Zweige hat, klassifiziere nach dem erkennbaren Hauptumsatzträger.
4. Antworte ausschließlich mit dem geforderten JSON-Objekt.
```

---

## 6. Typische Branchen-Schlüssel zur Schnellauswahl (Top 15 im Mittelstand)

Für Schnellfilter und Validierungen:

- **62.01 / 62.02**: IT-Dienstleistungen & Softwareentwicklung
- **43.21 / 43.22**: Elektro- und SHK-Installation (Handwerk)
- **28.11 – 28.99**: Maschinen- und Anlagenbau
- **46.10 – 46.90**: Großhandel (B2B-Handel)
- **49.41**: Güterkraftverkehr (Spedition & Logistik)
- **55.10**: Hotellerie & Beherbergung
- **56.10**: Gastronomie & Restaurants
- **68.20 / 68.32**: Wohnungsgesellschaften & Immobilienverwaltung
- **69.10 / 69.20**: Rechts- und Steuerberatung, Wirtschaftsprüfung
- **70.22**: Unternehmensberatung
- **71.11 / 71.12**: Architektur- und Ingenieurbüros
- **73.11**: Werbeagenturen & Marketing
- **78.20**: Zeitarbeit & Personalüberlassung
- **81.21 / 81.22**: Gebäudereinigung & Facility Management
- **86.10 / 86.21**: Kliniken, Allgemeinarzt- und Facharztpraxen
