export type CellStatus = "idle" | "running" | "done" | "error" | "skipped";

export interface MultiKeyMap {
  jsonKey: string;
  outputKey: string;
}

export interface AiColumn {
  id: string;
  name: string;
  prompt: string;
  outputKey: string;
  model?: string;
  outputMode?: "text" | "json";
  jsonKey?: string;
  multiKeys?: MultiKeyMap[];
  validateDomain?: boolean; // if true, HTTP-validate the "domain" multiKey and write domain_validated
  condition?: "empty" | "not_empty" | "require_input";
  conditionField?: string;
  requiredFields?: string[];
  inputMappings?: Record<string, string>;
  useWebSearch?: boolean;           // inject web search results into prompt context
  searchQuery?: string;             // template e.g. "{company_name} Heizung Anbieter"
  searchMaxResults?: number;        // default 5
  searchForceLayer?: "serpapi" | "brave" | "duckduckgo" | "playwright" | "scrapling" | "firecrawl";
  evidenceMode?: "snippet" | "page" | "auto";  // snippet (default) | page (scrape top results) | auto (retry with pages if empty)
  captureReasoning?: boolean;       // ask LLM to return _reasoning field; stored as _reasoning_{outputKey}
  /** Reasoning effort mapping per model family (see lib/edenai.ts). Default: none */
  reasoning?: "none" | "low" | "medium" | "high";

  // ── Deterministic tool columns (no LLM) ──────────────────────────────────
  /** "apollo_contacts": look up decision makers via Apollo.io (MCP/REST) */
  tool?: "apollo_contacts" | "batch_enrich" | "batch_contacts";
  /** Optional Apollo title filter keywords */
  toolApolloTitles?: string[];
  /** Max contacts to fetch (default 10) */
  toolApolloLimit?: number;

  // ── Batch enrichment (tool: "batch_enrich") ───────────────────────────────
  /** Source field containing the domain/URL to scrape (default: "domain") */
  batchSourceField?: string;
  /** Which output fields to populate. Defaults to all known fields. */
  batchOutputFields?: string[];
  /** Also search LinkedIn/web for contact data (adds 1 search call) */
  batchSearchContacts?: boolean;

  // ── Batch contacts (tool: "batch_contacts") ─────────────────────────────
  /** Max contacts to return (default 3) */
  batchContactsMax?: number;
  /** Also search LinkedIn (default true) */
  batchContactsLinkedIn?: boolean;
  /** Also scrape /impressum page (default true) */
  batchContactsImpressum?: boolean;
  /** Output field prefix for contact fields (default: "contact_") */
  batchContactsPrefix?: string;

  // ── Table grouping (for layered view) ────────────────────────────────────
  columnGroup?: "company" | "contact";
}

export interface Case {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  aiColumns: AiColumn[];
  /** Optional per-case Eden AI key; falls back to EDEN_API_KEY env */
  edenApiKey?: string;
  edenApiKeyMasked?: string;
  edenRegion?: "eu" | "us";
  modelAllowlist?: string[];
  colOrder?: string[];
  fieldMappings?: Record<string, string>; // e.g. { company_name: "Unternehmensname", city: "Stadt" }
}

export interface RowData {
  id: string;
  caseId: string;
  rowIndex: number;
  data: Record<string, string | null>;
  cellStatuses: Record<string, CellStatus>;
  cellErrors: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface RunCellRequest {
  caseId: string;
  rowId: string;
  columnId: string;
}

export interface RunColumnRequest {
  caseId: string;
  columnId: string;
  rowIds?: string[];
}

export interface RunRowRequest {
  caseId: string;
  rowId: string;
}

// ── Grouped (Company→Contacts) view ──────────────────────────────────────

export interface CompanyGroup {
  companyName: string;
  companyRow: RowData;
  contacts: RowData[];
}

export interface GroupedRowsResponse {
  companies: CompanyGroup[];
  totalCompanies: number;
  page: number;
  perPage: number;
}
