/**
 * lib/agent.test.ts
 * Unit tests for the goal-based discovery agent (agent-runner.ts).
 * All DB + external calls mocked at top level (Vitest hoisting-safe).
 * Run: npm test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentRunState, AgentGoal, AgentStepResult } from "./agent-types";
import type { PlanStep, DiscoveryPlan } from "./planner";

vi.mock("./db", () => ({
  createAgentRun: vi.fn(), getAgentRun: vi.fn(), updateAgentRunState: vi.fn(),
  getExistingDomains: vi.fn(), appendDiscoveryRows: vi.fn(), appendLog: vi.fn(),
}));
vi.mock("./planner", () => ({ createDiscoveryPlan: vi.fn(), refinePlan: vi.fn() }));
vi.mock("./discovery", () => ({
  discoverySearch: vi.fn(),
  hitToSeedRow: vi.fn((h: Record<string,string>) => ({ ...h, company_name: h.title ?? "" })),
}));
vi.mock("./maps", () => ({ mapsSearch: vi.fn(), placeToSeedExtras: vi.fn().mockReturnValue({}) }));
vi.mock("./edenai", () => ({ edenScrapeUrl: vi.fn(), edenChatCompletion: vi.fn() }));
vi.mock("./operations", () => ({
  isOperationCancelled: vi.fn().mockReturnValue(false),
  registerOperation: vi.fn().mockReturnValue("op-test"),
}));

const db      = await import("./db");
const planner = await import("./planner");
const disc    = await import("./discovery");
const maps    = await import("./maps");
const ops     = await import("./operations");
const { evaluateStopCondition, startAgentRun, executeNextStep, cancelAgentRun } =
  await import("./agent-runner");

// ── Fixtures ─────────────────────────────────────────────────────────────────
const makeStep = (o: Partial<PlanStep> = {}): PlanStep => ({
  id:"step_1", type:"google_search", label:"Test Search",
  query:"Heizung Berlin", source:"auto", estimatedHits:20, priority:1, ...o });

const makePlan = (steps: PlanStep[] = [makeStep()]): DiscoveryPlan =>
  ({ goal:"Test", steps, estimatedRows:20, warnings:[] });

const makeRun = (o: Partial<AgentRunState> = {}): AgentRunState => ({
  id:"run-1", caseId:"case-1", goal:{description:"Test",targetCount:100},
  status:"running", iteration:0, plan:makePlan(),
  stepResults:[], uniqueCount:0, costUsd:0,
  startedAt:new Date().toISOString(), updatedAt:new Date().toISOString(), log:[], ...o });

const makeResult = (o: Partial<AgentStepResult> = {}): AgentStepResult => ({
  stepId:"step_1", attemptedAt:new Date().toISOString(),
  hitsFound:20, uniqueInserted:15, costUsd:0, source:"auto", ...o });

const makeHit = (i: number) => ({
  title:`Co${i}`, url:`https://co${i}.de`, domain:`co${i}.de`, snippet:"x",
  isCatalog:false, isDuplicate:false, searchQuery:"q", searchSource:"auto" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ops.isOperationCancelled).mockReturnValue(false);
  vi.mocked(db.getExistingDomains).mockResolvedValue([]);
  vi.mocked(db.appendDiscoveryRows).mockResolvedValue({ inserted:12, duplicates:3 });
  vi.mocked(db.appendLog).mockResolvedValue(undefined as never);
  vi.mocked(db.createAgentRun).mockResolvedValue(undefined as never);
  vi.mocked(db.updateAgentRunState).mockResolvedValue(undefined as never);
  vi.mocked(maps.placeToSeedExtras).mockReturnValue({});
  vi.mocked(disc.hitToSeedRow).mockImplementation(
    (h: Record<string,string>) => ({ ...h, company_name: h.title ?? "" }));
  vi.mocked(planner.refinePlan).mockResolvedValue(null);
});

// ── evaluateStopCondition ────────────────────────────────────────────────────
describe("evaluateStopCondition", () => {
  it("null when not yet at target",  () => expect(evaluateStopCondition(makeRun({uniqueCount:50}))).toBeNull());
  it("completed at exactly target",  () => expect(evaluateStopCondition(makeRun({uniqueCount:100}))).toBe("completed"));
  it("completed past target",        () => expect(evaluateStopCondition(makeRun({uniqueCount:120}))).toBe("completed"));
  it("budget_exhausted at cost cap", () => expect(evaluateStopCondition(makeRun({costUsd:5,goal:{description:"x",targetCount:100,maxBudgetUsd:5}}))).toBe("budget_exhausted"));
  it("null when under cost cap",     () => expect(evaluateStopCondition(makeRun({costUsd:3,goal:{description:"x",targetCount:100,maxBudgetUsd:5}}))).toBeNull());
  it("budget_exhausted at iter cap", () => expect(evaluateStopCondition(makeRun({iteration:10,goal:{description:"x",targetCount:100,maxIterations:10}}))).toBe("budget_exhausted"));
  it("null when under iter cap",     () => expect(evaluateStopCondition(makeRun({iteration:5,goal:{description:"x",targetCount:100,maxIterations:10}}))).toBeNull());

  it("completed on diminishing returns (4 steps, < 5% yield)", () => {
    const run = makeRun({ stepResults:[
      makeResult({stepId:"s1",uniqueInserted:1}), makeResult({stepId:"s2",uniqueInserted:1}),
      makeResult({stepId:"s3",uniqueInserted:1}), makeResult({stepId:"s4",uniqueInserted:1}) ] });
    expect(evaluateStopCondition(run)).toBe("completed");
  });

  it("null with only 3 results (insufficient data)", () => {
    const run = makeRun({ stepResults:[
      makeResult({stepId:"s1",uniqueInserted:1}), makeResult({stepId:"s2",uniqueInserted:1}),
      makeResult({stepId:"s3",uniqueInserted:1}) ] });
    expect(evaluateStopCondition(run)).toBeNull();
  });

  it("null with healthy yield (50% of remaining)", () => {
    const run = makeRun({ uniqueCount:50, stepResults:[
      makeResult({stepId:"s1",uniqueInserted:13}), makeResult({stepId:"s2",uniqueInserted:12}),
      makeResult({stepId:"s3",uniqueInserted:13}), makeResult({stepId:"s4",uniqueInserted:12}) ] });
    expect(evaluateStopCondition(run)).toBeNull();
  });

  it("budget takes priority over diminishing-returns", () => {
    const run = makeRun({ costUsd:10, goal:{description:"x",targetCount:100,maxBudgetUsd:5},
      stepResults:[ makeResult({stepId:"s1",uniqueInserted:1}), makeResult({stepId:"s2",uniqueInserted:1}),
                    makeResult({stepId:"s3",uniqueInserted:1}), makeResult({stepId:"s4",uniqueInserted:1}) ] });
    expect(evaluateStopCondition(run)).toBe("budget_exhausted");
  });
});

// ── Type shapes ───────────────────────────────────────────────────────────────
describe("type shapes", () => {
  it("AgentGoal optionals are undefined by default", () => {
    const g: AgentGoal = { description:"T", targetCount:50 };
    expect(g.maxBudgetUsd).toBeUndefined();
    expect(g.maxDurationMin).toBeUndefined();
    expect(g.maxIterations).toBeUndefined();
  });

  it("log capped to 200: slice(-200) drops oldest", () => {
    const run = makeRun({ log:Array.from({length:201},(_,i) => `e${i}`) });
    if (run.log.length > 200) run.log = run.log.slice(-200);
    expect(run.log).toHaveLength(200);
    expect(run.log[0]).toBe("e1");
  });
});

// ── Step priority & selection ─────────────────────────────────────────────────
describe("step priority & selection", () => {
  it("sorts catalog < maps < search by priority field", () => {
    const steps = [
      makeStep({id:"s3",type:"google_search",priority:3}),
      makeStep({id:"s1",type:"catalog_scrape",priority:1}),
      makeStep({id:"s2",type:"google_maps",priority:2}),
    ];
    expect([...steps].sort((a,b) => a.priority - b.priority).map(s => s.id)).toEqual(["s1","s2","s3"]);
  });
  it("filters executed step ids", () => {
    const steps = [makeStep({id:"a"}), makeStep({id:"b",priority:2})];
    expect(steps.filter(s => !new Set(["a"]).has(s.id)).map(s => s.id)).toEqual(["b"]);
  });
  it("multi_search uses all queries[]", () => {
    const s = makeStep({ type:"multi_search", queries:["A","B","C"] });
    const q = s.type==="multi_search" && s.queries?.length ? s.queries : [s.query!];
    expect(q).toHaveLength(3);
  });
  it("google_search uses single query", () => {
    const s = makeStep({ type:"google_search", queries:undefined });
    const q = s.type==="multi_search" && s.queries?.length ? s.queries : [s.query!];
    expect(q).toEqual(["Heizung Berlin"]);
  });
});

// ── startAgentRun ────────────────────────────────────────────────────────────
describe("startAgentRun", () => {
  beforeEach(() => vi.mocked(planner.createDiscoveryPlan).mockResolvedValue(
    makePlan([makeStep({id:"step_1"}), makeStep({id:"step_2",priority:2})])));

  it("correct initial state + UUID + DB call", async () => {
    const run = await startAgentRun("case-1", {description:"Test",targetCount:200}, {edenApiKey:"k"});
    expect(run.status).toBe("running");
    expect(run.uniqueCount).toBe(0);
    expect(run.costUsd).toBe(0);
    expect(run.plan.steps).toHaveLength(2);
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(db.createAgentRun).toHaveBeenCalledOnce();
    expect(run.log[0]).toContain("Plan erstellt");
  });

  it("passes key flags: true when keys provided", async () => {
    await startAgentRun("c", {description:"T",targetCount:10},
      {edenApiKey:"k", serpApiKey:"s", braveApiKey:"b"});
    expect(planner.createDiscoveryPlan).toHaveBeenCalledWith("T",
      expect.objectContaining({serpApiKeyAvailable:true, braveApiKeyAvailable:true}));
  });

  it("passes key flags: false when keys absent", async () => {
    await startAgentRun("c", {description:"T",targetCount:10}, {edenApiKey:"k"});
    expect(planner.createDiscoveryPlan).toHaveBeenCalledWith("T",
      expect.objectContaining({serpApiKeyAvailable:false, braveApiKeyAvailable:false}));
  });

  it("appends case log on start", async () => {
    await startAgentRun("c", {description:"T",targetCount:10}, {edenApiKey:"k"});
    expect(db.appendLog).toHaveBeenCalledWith("c", expect.stringContaining("Ziel-Suche gestartet"));
  });
});

// ── executeNextStep ───────────────────────────────────────────────────────────
describe("executeNextStep", () => {
  beforeEach(() => vi.mocked(disc.discoverySearch).mockResolvedValue({
    hits:Array.from({length:15},(_,i) => makeHit(i)),
    source:"auto", query:"q", latencyMs:50,
  }));

  it("executes step, updates uniqueCount, status running", async () => {
    vi.mocked(db.getAgentRun).mockResolvedValue(makeRun({plan:makePlan([makeStep({id:"step_1"})])}));
    const r = await executeNextStep("run-1", {edenApiKey:"k"}, "run-1");
    expect(r.stepResults).toHaveLength(1);
    expect(r.uniqueCount).toBe(12);
    expect(r.status).toBe("running");
    expect(r.log[0]).toContain("+12 neu");
  });

  it("status 'completed' when target reached", async () => {
    vi.mocked(db.getAgentRun).mockResolvedValue(makeRun({
      uniqueCount:90, goal:{description:"x",targetCount:100}, plan:makePlan([makeStep()]) }));
    const r = await executeNextStep("run-1", {edenApiKey:"k"}, "run-1");
    expect(r.status).toBe("completed");
    expect(r.uniqueCount).toBe(102);
  });

  it("records 0 uniqueInserted when no hits returned", async () => {
    // This covers the error-handling path: empty search result → 0 inserted
    vi.mocked(disc.discoverySearch).mockResolvedValue({
      hits: [], source: "auto", query: "q", latencyMs: 50,
    });
    vi.mocked(db.appendDiscoveryRows).mockResolvedValue({ inserted:0, duplicates:0 });
    vi.mocked(db.getAgentRun).mockResolvedValue(
      makeRun({ plan:makePlan([makeStep({id:"step_1"})]) }));

    const r = await executeNextStep("run-1", {edenApiKey:"k"}, "run-1");

    expect(r.stepResults[0].uniqueInserted).toBe(0);
    expect(r.stepResults[0].hitsFound).toBe(0);
    expect(r.stepResults[0].error).toBeUndefined();
  });

  it("throws when run not found", async () => {
    vi.mocked(db.getAgentRun).mockResolvedValue(null);
    await expect(executeNextStep("x",{edenApiKey:"k"},"x")).rejects.toThrow("not found");
  });

  it("calls discoverySearch once per city in multi_search", async () => {
    const step = makeStep({ id:"step_1", type:"multi_search",
      queries:["Berlin","Hamburg","München"], query:undefined });
    vi.mocked(db.getAgentRun).mockResolvedValue(makeRun({plan:makePlan([step])}));
    await executeNextStep("run-1", {edenApiKey:"k"}, "run-1");
    expect(disc.discoverySearch).toHaveBeenCalledTimes(3);
    const args = vi.mocked(disc.discoverySearch).mock.calls.map(c => c[0]);
    expect(args).toEqual(["Berlin","Hamburg","München"]);
  });

  it("stops multi_search loop when cancelled mid-flight", async () => {
    let n = 0;
    vi.mocked(ops.isOperationCancelled).mockImplementation(() => ++n > 1);
    const step = makeStep({ type:"multi_search", queries:["A","B","C"], query:undefined });
    vi.mocked(db.getAgentRun).mockResolvedValue(makeRun({plan:makePlan([step])}));
    await executeNextStep("run-1", {edenApiKey:"k"}, "run-1");
    expect(disc.discoverySearch).toHaveBeenCalledTimes(1);
  });
});

// ── cancelAgentRun ────────────────────────────────────────────────────────────
describe("cancelAgentRun", () => {
  it("sets status 'cancelled' and adds log", async () => {
    vi.mocked(db.getAgentRun).mockResolvedValue(makeRun({uniqueCount:42}));
    const r = await cancelAgentRun("run-1");
    expect(r?.status).toBe("cancelled");
    expect(r?.log.at(-1)).toContain("Abgebrochen");
    expect(db.appendLog).toHaveBeenCalledWith("case-1", expect.stringContaining("42"));
  });
  it("persists to DB", async () => {
    vi.mocked(db.getAgentRun).mockResolvedValue(makeRun());
    await cancelAgentRun("run-1");
    expect(db.updateAgentRunState).toHaveBeenCalledWith(expect.objectContaining({status:"cancelled"}));
  });
  it("returns null when run not found", async () => {
    vi.mocked(db.getAgentRun).mockResolvedValue(null);
    expect(await cancelAgentRun("x")).toBeNull();
  });
});
