"use client";

import { useState, useCallback, useRef } from "react";
import type { AgentGoal, AgentRunState } from "@/lib/agent-types";

export type { AgentGoal, AgentRunState, AgentRunStatus } from "@/lib/agent-types";

export interface UseAgentRunReturn {
  run: AgentRunState | null;
  running: boolean;
  error: string | null;
  start: (goal: AgentGoal) => Promise<void>;
  step: () => Promise<AgentRunState | null>;
  cancel: () => Promise<void>;
  reload: (runId: string) => Promise<void>;
}

/**
 * Hook for goal-based discovery agent.
 *
 * Usage:
 *   const { run, running, start, step, cancel } = useAgentRun(caseId);
 *
 * Call `start(goal)` once. Then call `step()` in a loop (e.g. setInterval or
 * sequential await chain) until run.status is terminal.
 */
export function useAgentRun(caseId: string): UseAgentRunReturn {
  const [run, setRun] = useState<AgentRunState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const abortRef = useRef(false);

  const start = useCallback(async (goal: AgentGoal) => {
    if (!caseId || caseId === "__disabled__") return;
    setError(null);
    setRunning(true);
    abortRef.current = false;

    try {
      const res = await fetch(`/api/cases/${caseId}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setRunning(false);
        return;
      }

      setRun(data);
      runIdRef.current = data.id;
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }, [caseId]);

  const step = useCallback(async (): Promise<AgentRunState | null> => {
    const rid = runIdRef.current;
    if (!rid || abortRef.current) {
      setRunning(false);
      return null;
    }

    try {
      const res = await fetch(`/api/cases/${caseId}/agent/${rid}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      // Guard against HTML error pages (e.g. Next.js 404/500 pages)
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        setError(`Server error (HTTP ${res.status}) — expected JSON but got ${contentType.split(";")[0]}`);
        setRunning(false);
        return null;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setRunning(false);
        return null;
      }

      setRun(data);

      // Terminal states
      const terminalStatuses = new Set(["completed", "budget_exhausted", "cancelled", "failed"]);
      if (terminalStatuses.has(data.status)) {
        setRunning(false);
      }

      return data;
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      return null;
    }
  }, [caseId]);

  const cancel = useCallback(async () => {
    abortRef.current = true;
    const rid = runIdRef.current;
    if (!rid) return;

    try {
      const res = await fetch(`/api/cases/${caseId}/agent/${rid}`, {
        method: "PUT", // PUT on [runId] = cancel (see route.ts: CANCEL as PUT)
      });
      const data = await res.json();
      if (res.ok) setRun(data);
    } catch (e) {
      console.error("[useAgentRun] cancel error:", e);
    }
    setRunning(false);
  }, [caseId]);

  const reload = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/agent/${runId}`);
      const data = await res.json();
      if (res.ok) {
        setRun(data);
        runIdRef.current = data.id;
        const terminalStatuses = new Set(["completed", "budget_exhausted", "cancelled", "failed"]);
        setRunning(!terminalStatuses.has(data.status));
      }
    } catch (e) {
      console.error("[useAgentRun] reload error:", e);
    }
  }, [caseId]);

  return { run, running, error, start, step, cancel, reload };
}