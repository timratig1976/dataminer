/**
 * lib/agent-types.ts
 * Agentic goal-based discovery types.
 *
 * An AgentGoal defines a high-level target ("find 3000 companies matching X").
 * The agent runner iterates: Plan → Execute → Observe → Decide, writing state
 * into the agent_runs table so runs survive server restarts and page reloads.
 */

// ── Goal ──────────────────────────────────────────────────────────────────────

export interface AgentGoal {
  /** Natural-language description: "Handwerksbetriebe Heizung in NRW" */
  description: string;
  /** How many unique companies to acquire */
  targetCount: number;
  /** Optional region hint (detected by LLM if not set) */
  region?: string;
  /** Cost cap in USD — stops at budget_exhausted */
  maxBudgetUsd?: number;
  /** Wall-clock cap in minutes */
  maxDurationMin?: number;
  /** Safety iteration cap (default 10) */
  maxIterations?: number;
  /** Whether to include Google Maps/Places steps in the plan (default true) */
  useMaps?: boolean;
  /** Run LLM validation on Maps results to filter irrelevant entries (adds cost, improves quality) */
  validatePlaces?: boolean;
}

// ── Run state ────────────────────────────────────────────────────────────────

export type AgentRunStatus =
  | "planning"       // initial plan being generated
  | "running"        // executing steps
  | "evaluating"     // all steps done, evaluating whether to replan
  | "expanding"      // replan phase — generating more steps
  | "completed"      // target reached
  | "budget_exhausted" // cost/time cap hit (partial success)
  | "cancelled"      // user-requested abort
  | "failed";        // unrecoverable error

export interface AgentStepResult {
  /** Step id from the plan */
  stepId: string;
  /** ISO timestamp */
  attemptedAt: string;
  /** Raw hits returned by the search */
  hitsFound: number;
  /** Actually inserted after server-side deduplication */
  uniqueInserted: number;
  /** Eden/Firecrawl cost for this step (0 for free layers) */
  costUsd: number;
  /** Source that was used */
  source: string;
  /** Set when the step errored */
  error?: string;
}

export interface AgentRunState {
  /** Stable UUID (primary key) */
  id: string;
  caseId: string;
  goal: AgentGoal;
  status: AgentRunStatus;
  /** Which cycle we're on (starts at 0) */
  iteration: number;
  /** Current plan (grows across iterations — new steps appended) */
  plan: import("./planner").DiscoveryPlan;
  /** Results per executed step */
  stepResults: AgentStepResult[];
  /** Running count of unique domains inserted */
  uniqueCount: number;
  /** Cumulative USD cost */
  costUsd: number;
  /** ISO */
  startedAt: string;
  updatedAt: string;
  /** Human-readable log (last 200 entries, newest last) */
  log: string[];
  /**
   * Deduplicated registry of executed searches.
   * Key: "<type>|<query_or_mapQuery>|<location>" → uniqueInserted count
   * Used by handleReplan to avoid repeating exhausted queries.
   */
  executedQueries?: Record<string, number>;
}

// ── API shapes ───────────────────────────────────────────────────────────────

export interface AgentRunListItem {
  id: string;
  goal: string;
  status: AgentRunStatus;
  targetCount: number;
  uniqueCount: number;
  startedAt: string;
}