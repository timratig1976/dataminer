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
  searchForceLayer?: "serpapi" | "brave" | "duckduckgo" | "playwright";
  captureReasoning?: boolean;       // ask LLM to return _reasoning field; stored as _reasoning_{outputKey}
}

export interface Case {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  aiColumns: AiColumn[];
  apiKey?: string;
  apiKeyMasked?: string;
  cerebrasApiKey?: string;
  cerebrasApiKeyMasked?: string;
  anthropicApiKey?: string;
  anthropicApiKeyMasked?: string;
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
