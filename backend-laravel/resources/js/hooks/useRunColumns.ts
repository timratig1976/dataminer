"use client";

import { useState, useCallback } from "react";
import type { AiColumn, RowData, Case } from "@/types";

function isEmptyOrNotFound(v: unknown, col?: AiColumn, rowData?: Record<string, string | null>): boolean {
  if (col && (col.tool === "batch_company" || col.tool === "batch_contact")) {
    if (col.tool === "batch_company" && rowData) {
      const fields = col.batchOutputFields ?? ["company_name", "domain", "phone", "company_email", "city", "industry"];
      const hasAnyField = fields.some(f => rowData[f] && String(rowData[f]).trim() !== "" && !/^notfound$/i.test(String(rowData[f]).trim()));
      if (hasAnyField) return false;
    }
    if (col.tool === "batch_contact" && rowData) {
      const prefix = col.batchContactsPrefix ?? "contact_";
      const hasContact = !!(rowData[`_contacts_json_${col.outputKey}`] || rowData[`${prefix}1_first_name`] || rowData[`${prefix}1_last_name`]);
      if (hasContact) return false;
    }
  }
  const t = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  return t === "" || /^notfound$/i.test(t);
}

// Simple local cancel token — mirrors server-side operation cancel
const cancelledKeys = new Set<string>();
function isOperationCancelled(key: string) { return cancelledKeys.has(key); }

export interface UseRunColumnsReturn {
  runningCells: Set<string>;
  runningColumnId: string | null;
  runningRowIds: Set<string>;
  globalRunError: string | null;
  setGlobalRunError: (e: string | null) => void;
  concurrency: number;
  setConcurrency: (n: number) => void;
  sequentialMode: boolean;
  setSequentialMode: (v: boolean) => void;
  runCell: (rowId: string, col: AiColumn) => Promise<void>;
  stopCell: (rowId: string, col: AiColumn) => void;
  runColumn: (col: AiColumn, runMode?: "all_force" | "empty_only") => Promise<void>;
  stopColumn: (col: AiColumn) => void;
  runPhase: (phase: "company" | "contact") => Promise<void>;
  runSelectedRows: (mode?: "all_force" | "empty_only") => Promise<void>;
  stopAll: () => void;
}

export function useRunColumns(
  caseId: string,
  caseData: Case | null,
  rows: RowData[],
  setRows: React.Dispatch<React.SetStateAction<RowData[]>>,
  selectedRows: Set<string>,
  setColOrder: React.Dispatch<React.SetStateAction<string[]>>
): UseRunColumnsReturn {
  const [runningCells, setRunningCells] = useState<Set<string>>(new Set());
  const [runningColumnId, setRunningColumnId] = useState<string | null>(null);
  const [runningRowIds, setRunningRowIds] = useState<Set<string>>(new Set());
  const [globalRunError, setGlobalRunError] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(5);
  const [sequentialMode, setSequentialMode] = useState(false);
  const [abortControllers, setAbortControllers] = useState<Record<string, AbortController>>({});
  const [operationIds, setOperationIds] = useState<Record<string, string>>({});
  const [runningCellTimestamps, setRunningCellTimestamps] = useState<Record<string, number>>({});

  const runCell = useCallback(async (rowId: string, col: AiColumn) => {
    const key = `${rowId}:${col.id}`;
    const abortController = new AbortController();
    setAbortControllers((prev) => ({ ...prev, [key]: abortController }));
    setRunningCells((prev) => new Set(prev).add(key));
    setRunningCellTimestamps((prev) => ({ ...prev, [key]: Date.now() }));
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } } : r
      )
    );
    try {
      const res = await fetch("/api/run/cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, rowId, columnId: col.id }),
        signal: abortController.signal,
      });
      const result = await res.json();
      if (result.operationId) setOperationIds((prev) => ({ ...prev, [key]: result.operationId }));
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== rowId) return r;
          const extraData = result.multiValues ?? {};
          const extraStatuses: Record<string, string> = {};
          for (const k of Object.keys(extraData)) extraStatuses[k] = result.status ?? "done";
          const metaData: Record<string, string> = {};
          for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
            if (k.startsWith("_llm_") && typeof v === "string") metaData[k] = v;
          }
          return {
            ...r,
            data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey], ...extraData, ...metaData },
            cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status ?? (res.ok ? "done" : "error"), ...extraStatuses },
            cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors,
          };
        })
      );
      if (result.multiValues) {
        const newKeys = Object.keys(result.multiValues);
        setColOrder((prev) => {
          const existing = new Set(prev);
          const toAdd = newKeys.filter((k) => !existing.has(k));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    } finally {
      setRunningCells((prev) => { const s = new Set(prev); s.delete(key); return s; });
      setAbortControllers((prev) => { const { [key]: _, ...rest } = prev; return rest; });
      setRunningCellTimestamps((prev) => { const { [key]: _, ...rest } = prev; return rest; });
      setOperationIds((prev) => { const { [key]: _, ...rest } = prev; return rest; });
    }
  }, [caseId, setRows, setColOrder]);

  const stopCell = useCallback((rowId: string, col: AiColumn) => {
    const key = `${rowId}:${col.id}`;
    const opId = operationIds[key];
    if (opId) fetch(`/api/run/cell?operationId=${opId}`, { method: "DELETE" }).catch(console.error);
    const controller = abortControllers[key];
    if (controller) { controller.abort(); setAbortControllers((prev) => { const { [key]: _, ...rest } = prev; return rest; }); }
    setRunningCells((prev) => { const s = new Set(prev); s.delete(key); return s; });
    setOperationIds((prev) => { const { [key]: _, ...rest } = prev; return rest; });
    setRunningCellTimestamps((prev) => { const { [key]: _, ...rest } = prev; return rest; });
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "skipped" }, data: { ...r.data, [col.outputKey]: "", [`_reasoning_${col.outputKey}`]: "" } }
          : r
      )
    );
  }, [operationIds, abortControllers, setRows]);

  const runColumn = useCallback(async (col: AiColumn, runMode: "all_force" | "empty_only" = "all_force") => {
    const key = `col:${col.id}`;
    const abortController = new AbortController();
    setAbortControllers((prev) => ({ ...prev, [key]: abortController }));
    setRunningColumnId(col.id);
    const targetIds = selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id);
    const targetRows = runMode === "empty_only"
      ? rows.filter((r) => {
          if (!targetIds.includes(r.id)) return false;
          return isEmptyOrNotFound(r.data[col.outputKey], col, r.data);
        })
      : rows.filter((r) => targetIds.includes(r.id));
    const runIds = targetRows.map((r) => r.id);
    setRunningRowIds(new Set(runIds));

    // Mark targeted rows as running optimistically
    setRows((prev) =>
      prev.map((r) => runIds.includes(r.id) ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } } : r)
    );

    try {
      // ── SSE streaming mode ────────────────────────────────────────────────
      const res = await fetch("/api/run/column/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, columnId: col.id, rowIds: targetIds, runMode, concurrency }),
        signal: abortController.signal,
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataStr = line.replace(/^data: /, "").trim();
          if (!dataStr) continue;
          try {
            const event = JSON.parse(dataStr);

            if (event.type === "start" && event.operationId) {
              setOperationIds((prev) => ({ ...prev, [key]: event.operationId }));
            }

            if (event.type === "row_done") {
              const { rowId, status, value, multiValues, tokens, costUsd, error, metaData } = event;
              setRunningRowIds((prev) => {
                if (!prev.has(rowId)) return prev;
                const next = new Set(prev);
                next.delete(rowId);
                return next;
              });
              setRows((prev) =>
                prev.map((r) => {
                  if (r.id !== rowId) return r;
                  const extraData = multiValues ?? {};
                  const extraStatuses: Record<string, string> = {};
                  for (const k of Object.keys(extraData)) extraStatuses[k] = status ?? "done";
                  return {
                    ...r,
                    data: { ...r.data, [col.outputKey]: value ?? r.data[col.outputKey], ...extraData, ...(metaData ?? {}) },
                    cellStatuses: { ...r.cellStatuses, [col.outputKey]: status ?? "done", ...extraStatuses },
                    cellErrors: error ? { ...r.cellErrors, [col.outputKey]: error } : r.cellErrors,
                  };
                })
              );
              if (multiValues) {
                const newKeys = Object.keys(multiValues);
                setColOrder((prev) => {
                  const existing = new Set(prev);
                  const toAdd = newKeys.filter((k) => !existing.has(k));
                  return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
                });
              }
            }

            if (event.type === "error") {
              setGlobalRunError(event.message ?? "Streaming-Fehler");
              // Clear running statuses for remaining rows
              setRows((prev) =>
                prev.map((r) =>
                  runIds.includes(r.id) && r.cellStatuses[col.outputKey] === "running"
                    ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "skipped" } }
                    : r
                )
              );
            }
          } catch { /* skip malformed event */ }
        }
      }
    } catch (error: unknown) {
      const msg = (error as Error).message ?? "";
      if (msg !== "AbortError" && !msg.includes("abort") && (error as Error).name !== "AbortError") {
        setGlobalRunError(msg || "Fehler beim Ausführen");
      }
      // Clear any stuck running cells
      setRows((prev) =>
        prev.map((r) =>
          runIds.includes(r.id) && r.cellStatuses[col.outputKey] === "running"
            ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "skipped" } }
            : r
        )
      );
    } finally {
      setAbortControllers((prev) => { const { [key]: _, ...rest } = prev; return rest; });
      setRunningColumnId(null);
      setRunningRowIds(new Set());
      setOperationIds((prev) => { const { [key]: _, ...rest } = prev; return rest; });
    }
  }, [caseId, rows, selectedRows, concurrency, setRows, setColOrder]);

  const stopColumn = useCallback((col: AiColumn) => {
    const key = `col:${col.id}`;
    const opId = operationIds[key];
    if (opId) fetch(`/api/run/column?operationId=${opId}`, { method: "DELETE" }).catch(console.error);
    const controller = abortControllers[key];
    if (controller) { controller.abort(); setAbortControllers((prev) => { const { [key]: _, ...rest } = prev; return rest; }); }
    setOperationIds((prev) => { const { [key]: _, ...rest } = prev; return rest; });
    setRunningColumnId(null);
    setRunningRowIds(new Set());
  }, [operationIds, abortControllers]);

  const runPhase = useCallback(async (phase: "company" | "contact") => {
    if (!caseData) return;
    const cols = caseData.aiColumns.filter((c) => c.columnGroup === phase);
    if (cols.length === 0) { alert(`Keine ${phase === "company" ? "Firmen" : "Kontakt"}-Spalten gefunden.`); return; }
    const key = `phase:${phase}:${Date.now()}`;
    const abortController = new AbortController();
    setAbortControllers((prev) => ({ ...prev, [key]: abortController }));
    const targetIds = selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id);
    setRunningRowIds(new Set(targetIds));
    setGlobalRunError(null);
    try {
      for (const col of cols) {
        setRows((prev) => prev.map((r) => targetIds.includes(r.id) ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } } : r));
        const res = await fetch("/api/run/column", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, columnId: col.id, rowIds: targetIds, runMode: "empty_only", concurrency }),
          signal: abortController.signal,
        });
        const json = await res.json();
        if (!res.ok) {
          setGlobalRunError(`Fehler bei "${col.name}": ${json?.error ?? `HTTP ${res.status}`}`);
          setRows((prev) => prev.map((r) => targetIds.includes(r.id) ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "error" }, cellErrors: { ...r.cellErrors, [col.outputKey]: json?.error } } : r));
          break;
        }
        const results = json.results;
        setRows((prev) => prev.map((r) => {
          const result = results?.[r.id];
          if (!result) {
            if (targetIds.includes(r.id) && r.cellStatuses[col.outputKey] === "running")
              return { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "skipped" } };
            return r;
          }
          const extraData = result.multiValues ?? {};
          const extraStatuses: Record<string, string> = {};
          for (const k of Object.keys(extraData)) extraStatuses[k] = result.status ?? "done";
          return { ...r, data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey], ...extraData }, cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status, ...extraStatuses }, cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors };
        }));
      }
    } catch (error: unknown) {
      const msg = (error as Error).message ?? "";
      if (!msg.includes("abort") && (error as Error).name !== "AbortError") setGlobalRunError(msg || "Fehler beim Ausführen");
    } finally {
      setAbortControllers((prev) => { const { [key]: _, ...rest } = prev; return rest; });
      setRunningRowIds(new Set());
    }
  }, [caseId, caseData, rows, selectedRows, concurrency, setRows]);

  const runSelectedRows = useCallback(async (mode: "all_force" | "empty_only" = "all_force") => {
    if (!caseData) return;
    if (caseData.aiColumns.length === 0) { alert("Keine KI-Spalten konfiguriert."); return; }
    const key = `rows:${Date.now()}`;
    const abortController = new AbortController();
    setAbortControllers((prev) => ({ ...prev, [key]: abortController }));
    const targetIds = selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id);
    setGlobalRunError(null);
    try {
      // Run columns sequentially but don't abort on individual column error
      for (const col of caseData.aiColumns) {
        if (isOperationCancelled(key)) break;

        // Filter target rows based on mode: in empty_only only touch empty ones!
        const colTargetRows = mode === "empty_only"
          ? rows.filter(r => targetIds.includes(r.id) && isEmptyOrNotFound(r.data[col.outputKey], col, r.data))
          : rows.filter(r => targetIds.includes(r.id));

        if (colTargetRows.length === 0) continue; // Nothing to do for this column

        const colTargetIds = colTargetRows.map(r => r.id);
        setRunningRowIds(new Set(colTargetIds));

        setRows((prev) => prev.map((r) =>
          colTargetIds.includes(r.id) ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } } : r
        ));

        try {
          const res = await fetch("/api/run/column/stream", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caseId, columnId: col.id, rowIds: colTargetIds, runMode: mode, concurrency }),
            signal: abortController.signal,
          });

          if (!res.body) throw new Error("No response body");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const dataStr = line.replace(/^data: /, "").trim();
              if (!dataStr) continue;
              try {
                const event = JSON.parse(dataStr);
                if (event.type === "row_done") {
                  const { rowId, status, value, multiValues, error, metaData } = event;
                  setRunningRowIds((prev) => {
                    if (!prev.has(rowId)) return prev;
                    const next = new Set(prev);
                    next.delete(rowId);
                    return next;
                  });
                  setRows((prev) => prev.map((r) => {
                    if (r.id !== rowId) return r;
                    const extraData = multiValues ?? {};
                    const extraStatuses: Record<string, string> = {};
                    for (const k of Object.keys(extraData)) extraStatuses[k] = status ?? "done";
                    return {
                      ...r,
                      data: { ...r.data, [col.outputKey]: value ?? r.data[col.outputKey], ...extraData, ...(metaData ?? {}) },
                      cellStatuses: { ...r.cellStatuses, [col.outputKey]: status ?? "done", ...extraStatuses },
                      cellErrors: error ? { ...r.cellErrors, [col.outputKey]: error } : r.cellErrors,
                    };
                  }));
                }
              } catch { /* skip malformed */ }
            }
          }
        } catch (colErr: unknown) {
          const msg = (colErr as Error).message ?? "";
          if (msg.includes("abort") || (colErr as Error).name === "AbortError") break;
          // Column error — mark remaining running cells as error but CONTINUE to next column
          setRows((prev) => prev.map((r) =>
            colTargetIds.includes(r.id) && r.cellStatuses[col.outputKey] === "running"
              ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "error" }, cellErrors: { ...r.cellErrors, [col.outputKey]: msg } }
              : r
          ));
          setGlobalRunError(`Fehler bei "${col.name}" (weiter mit nächster Spalte): ${msg}`);
        }
      }
    } catch (error: unknown) {
      const msg = (error as Error).message ?? "";
      if (!msg.includes("abort") && (error as Error).name !== "AbortError") setGlobalRunError(msg || "Fehler beim Ausführen");
    } finally {
      setAbortControllers((prev) => { const { [key]: _, ...rest } = prev; return rest; });
      setOperationIds((prev) => { const { [key]: _, ...rest } = prev; return rest; });
      setRunningRowIds(new Set());
    }
  }, [caseId, caseData, rows, selectedRows, concurrency, setRows]);

  // Stop ALL running operations at once
  const stopAll = useCallback(() => {
    // Abort every active controller
    Object.values(abortControllers).forEach(ctrl => {
      try { ctrl.abort(); } catch { /* ignore */ }
    });
    // Cancel server-side operations
    Object.values(operationIds).forEach(opId => {
      fetch(`/api/run/column?operationId=${opId}`, { method: 'DELETE' }).catch(() => null);
      fetch(`/api/run/cell?operationId=${opId}`, { method: 'DELETE' }).catch(() => null);
    });
    setAbortControllers({});
    setOperationIds({});
    setRunningColumnId(null);
    setRunningRowIds(new Set());
    setRunningCells(new Set());
    // Mark all running cells as skipped
    setRows(prev => prev.map(r => {
      const hasRunning = Object.values(r.cellStatuses).some(s => s === 'running');
      if (!hasRunning) return r;
      const newStatuses = { ...r.cellStatuses };
      for (const k of Object.keys(newStatuses)) {
        if (newStatuses[k] === 'running') newStatuses[k] = 'skipped';
      }
      return { ...r, cellStatuses: newStatuses };
    }));
  }, [abortControllers, operationIds, setRows]);

  return {
    runningCells, runningColumnId, runningRowIds,
    globalRunError, setGlobalRunError,
    concurrency, setConcurrency,
    sequentialMode, setSequentialMode,
    runCell, stopCell,
    runColumn, stopColumn,
    runPhase, runSelectedRows,
    stopAll,
  };
}
