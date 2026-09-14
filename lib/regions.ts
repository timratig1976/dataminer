/**
 * lib/regions.ts
 * German region → city list mapping for multi-search discovery.
 * Used by the AI Planner to expand regional queries without LLM token cost.
 */

export interface RegionInfo {
  name: string;
  abbreviation: string;
  cities: string[];
}

export const GERMAN_REGIONS: Record<string, RegionInfo> = {
  mv: {
    name: "Mecklenburg-Vorpommern",
    abbreviation: "MV",
    cities: [
      "Rostock", "Schwerin", "Greifswald", "Stralsund", "Neubrandenburg",
      "Wismar", "Güstrow", "Rügen", "Bergen auf Rügen", "Usedom",
      "Wolgast", "Anklam", "Demmin", "Waren (Müritz)", "Parchim",
      "Hagenow", "Ludwigslust", "Ribnitz-Damgarten", "Sassnitz",
    ],
  },
  bb: {
    name: "Brandenburg",
    abbreviation: "BB",
    cities: [
      "Potsdam", "Cottbus", "Brandenburg an der Havel", "Frankfurt (Oder)",
      "Oranienburg", "Eberswalde", "Neuruppin", "Schwedt/Oder",
      "Finsterwalde", "Senftenberg", "Luckenwalde", "Rathenow",
    ],
  },
  be: {
    name: "Berlin",
    abbreviation: "BE",
    cities: [
      "Berlin", "Berlin-Mitte", "Berlin-Charlottenburg", "Berlin-Spandau",
      "Berlin-Steglitz", "Berlin-Pankow", "Berlin-Neukölln", "Berlin-Treptow",
      "Berlin-Lichtenberg", "Berlin-Reinickendorf",
    ],
  },
  bw: {
    name: "Baden-Württemberg",
    abbreviation: "BW",
    cities: [
      "Stuttgart", "Mannheim", "Karlsruhe", "Freiburg im Breisgau",
      "Heidelberg", "Heilbronn", "Ulm", "Pforzheim", "Reutlingen",
      "Tübingen", "Sindelfingen", "Ludwigsburg", "Aalen", "Konstanz",
      "Esslingen am Neckar", "Göppingen", "Ravensburg", "Villingen-Schwenningen",
    ],
  },
  by: {
    name: "Bayern",
    abbreviation: "BY",
    cities: [
      "München", "Nürnberg", "Augsburg", "Regensburg", "Ingolstadt",
      "Würzburg", "Fürth", "Erlangen", "Bamberg", "Landshut",
      "Rosenheim", "Kempten", "Bayreuth", "Aschaffenburg", "Passau",
      "Neu-Ulm", "Memmingen", "Straubing",
    ],
  },
  he: {
    name: "Hessen",
    abbreviation: "HE",
    cities: [
      "Frankfurt am Main", "Wiesbaden", "Kassel", "Darmstadt", "Offenbach am Main",
      "Hanau", "Marburg", "Gießen", "Fulda", "Wetzlar", "Rüsselsheim",
      "Dreieich", "Langen", "Bad Homburg", "Eschborn",
    ],
  },
  ni: {
    name: "Niedersachsen",
    abbreviation: "NI",
    cities: [
      "Hannover", "Braunschweig", "Osnabrück", "Wolfsburg", "Göttingen",
      "Oldenburg", "Salzgitter", "Hildesheim", "Wilhelmshaven", "Delmenhorst",
      "Lüneburg", "Celle", "Hameln", "Lingen", "Wolfenbüttel",
    ],
  },
  nrw: {
    name: "Nordrhein-Westfalen",
    abbreviation: "NRW",
    cities: [
      "Köln", "Düsseldorf", "Dortmund", "Essen", "Duisburg",
      "Bochum", "Wuppertal", "Bonn", "Bielefeld", "Münster",
      "Gelsenkirchen", "Mönchengladbach", "Aachen", "Krefeld", "Oberhausen",
      "Hagen", "Hamm", "Solingen", "Leverkusen", "Osnabrück",
    ],
  },
  rp: {
    name: "Rheinland-Pfalz",
    abbreviation: "RP",
    cities: [
      "Mainz", "Ludwigshafen", "Koblenz", "Trier", "Kaiserslautern",
      "Worms", "Neustadt an der Weinstraße", "Bad Kreuznach", "Pirmasens", "Speyer",
    ],
  },
  sh: {
    name: "Schleswig-Holstein",
    abbreviation: "SH",
    cities: [
      "Kiel", "Lübeck", "Flensburg", "Neumünster", "Norderstedt",
      "Elmshorn", "Pinneberg", "Itzehoe", "Schleswig", "Heide",
      "Husum", "Rendsburg", "Bad Segeberg",
    ],
  },
  sl: {
    name: "Saarland",
    abbreviation: "SL",
    cities: [
      "Saarbrücken", "Neunkirchen", "Homburg", "Völklingen", "Saarlouis",
      "Sankt Ingbert", "Merzig", "Püttlingen",
    ],
  },
  sn: {
    name: "Sachsen",
    abbreviation: "SN",
    cities: [
      "Dresden", "Leipzig", "Chemnitz", "Zwickau", "Plauen",
      "Görlitz", "Freiberg", "Bautzen", "Pirna", "Meißen",
    ],
  },
  st: {
    name: "Sachsen-Anhalt",
    abbreviation: "ST",
    cities: [
      "Halle (Saale)", "Magdeburg", "Dessau-Roßlau", "Wittenberg",
      "Salzwedel", "Stendal", "Halberstadt", "Quedlinburg",
    ],
  },
  th: {
    name: "Thüringen",
    abbreviation: "TH",
    cities: [
      "Erfurt", "Jena", "Gera", "Weimar", "Gotha",
      "Suhl", "Altenburg", "Nordhausen", "Eisenach", "Ilmenau",
    ],
  },
  hb: {
    name: "Bremen",
    abbreviation: "HB",
    cities: ["Bremen", "Bremerhaven"],
  },
  hh: {
    name: "Hamburg",
    abbreviation: "HH",
    cities: [
      "Hamburg", "Hamburg-Altona", "Hamburg-Bergedorf", "Hamburg-Eimsbüttel",
      "Hamburg-Harburg", "Hamburg-Nord", "Hamburg-Wandsbek",
    ],
  },
};

/** All known abbreviation aliases (e.g. "mecklenburg" → "mv") */
const REGION_ALIASES: Record<string, string> = {
  "mecklenburg": "mv",
  "mecklenburg-vorpommern": "mv",
  "vorpommern": "mv",
  "brandenburg": "bb",
  "berlin": "be",
  "baden-württemberg": "bw",
  "württemberg": "bw",
  "badenwürttemberg": "bw",
  "baden württemberg": "bw",
  "bawü": "bw",
  "bw": "bw",
  "bayern": "by",
  "bavaria": "by",
  "by": "by",
  "hessen": "he",
  "hesse": "he",
  "niedersachsen": "ni",
  "lower saxony": "ni",
  "nordrhein-westfalen": "nrw",
  "nrw": "nrw",
  "nordrhein westfalen": "nrw",
  "rheinland-pfalz": "rp",
  "rheinland pfalz": "rp",
  "schleswig-holstein": "sh",
  "saarland": "sl",
  "sachsen": "sn",
  "saxony": "sn",
  "sachsen-anhalt": "st",
  "sachsen anhalt": "st",
  "thüringen": "th",
  "thuringia": "th",
  "bremen": "hb",
  "hamburg": "hh",
};

/**
 * Detect a German region from free text (case-insensitive).
 * Returns the region key (e.g. "mv") or null.
 */
export function detectRegion(text: string): string | null {
  const lower = text.toLowerCase();

  // Direct key match (mv, nrw, etc.)
  for (const key of Object.keys(GERMAN_REGIONS)) {
    const info = GERMAN_REGIONS[key];
    if (
      lower.includes(` ${key} `) ||
      lower.includes(` ${key},`) ||
      lower.endsWith(` ${key}`) ||
      lower.startsWith(`${key} `) ||
      lower.includes(info.name.toLowerCase()) ||
      lower.includes(info.abbreviation.toLowerCase())
    ) {
      return key;
    }
  }

  // Alias match
  for (const [alias, key] of Object.entries(REGION_ALIASES)) {
    if (lower.includes(alias)) return key;
  }

  return null;
}

/**
 * Get cities for a detected region. Returns [] when region unknown.
 */
export function getCitiesForRegion(regionKey: string): string[] {
  return GERMAN_REGIONS[regionKey]?.cities ?? [];
}

/**
 * Expand a query template for each city in a region.
 * e.g. template="Heizungsbauer {city}", cities=["Rostock","Schwerin"]
 * → ["Heizungsbauer Rostock", "Heizungsbauer Schwerin"]
 */
export function expandQueryForRegion(template: string, regionKey: string): string[] {
  const cities = getCitiesForRegion(regionKey);
  return cities.map((city) => template.replace(/\{city\}/g, city));
}
