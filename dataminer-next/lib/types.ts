export type CellStatus = "idle" | "running" | "done" | "error" | "skipped";

export interface AiColumn {
  id: string;
  name: string;
  prompt: string;
  outputKey: string;
  model?: string;
  outputMode?: "text" | "json";
  jsonKey?: string;
  condition?: "empty" | "not_empty" | "require_input";
  conditionField?: string;
}

export interface Case {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  aiColumns: AiColumn[];
  apiKey?: string;
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
