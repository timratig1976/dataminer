"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, Database, Bug, Settings, Sliders, Zap, Sparkles, Loader2, Plus } from "lucide-react";

interface RunningRun {
  id: string;
  caseId: string;
  uniqueCount: number;
  targetCount: number;
  status: string;
  goal?: string;
}

interface SidebarCase {
  id: string;
  name: string;
  rowCount?: number;
  updatedAt?: string;
}

export default function AppShell({
  title,
  titleIcon,
  actions,
  children,
}: {
  title: React.ReactNode;
  titleIcon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [cases, setCases] = useState<SidebarCase[]>([]);

  // Fetch recent cases for the sidebar
  useEffect(() => {
    fetch("/api/cases")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data)) {
          setCases(data.slice(0, 8));
        }
      })
      .catch(() => {});
  }, [pathname]);

  // Global agent worker loop: continues runs when no page tab is driving them
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let idleCount = 0;

    async function tick() {
      if (!active || inFlight) return;
      inFlight = true;

      try {
        const owned: string[] = [];
        const now = Date.now();
        const HEARTBEAT_TTL = 5000;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("agentLoop:")) continue;
          const ts = parseInt(localStorage.getItem(key) || "0", 10);
          if (!isNaN(ts) && now - ts < HEARTBEAT_TTL) {
            owned.push(key.slice("agentLoop:".length));
          }
        }

        const res = await fetch("/api/agent/worker", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agent-owned-runs": owned.join(","),
          },
        });
        const data = await res.json();
        if (Array.isArray(data.results) && data.results.length === 0 && data.skipped === 0) {
          idleCount = Math.min(idleCount + 1, 10);
        } else {
          idleCount = 0;
        }
      } catch {
        // ignore network errors
      } finally {
        inFlight = false;
      }
    }

    let intervalMs = 3000;
    const tickWrapper = async () => {
      await tick();
      intervalMs = idleCount > 2 ? 10000 : idleCount > 5 ? 30000 : 3000;
      timeoutId = setTimeout(tickWrapper, intervalMs);
    };
    let timeoutId = setTimeout(tickWrapper, intervalMs);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, []);

  const bottomNav = [
    { href: "/settings", title: "API & Keys", label: "Keys", icon: <Settings className="w-3.5 h-3.5" /> },
    { href: "/settings/models", title: "Modell-Auswahl", label: "Models", icon: <Sliders className="w-3.5 h-3.5" /> },
    { href: "/settings/planner", title: "Planner Prompt", label: "Planner", icon: <Sparkles className="w-3.5 h-3.5" /> },
    { href: "/settings/llm-test", title: "LLM-Testing", label: "LLM", icon: <Zap className="w-3.5 h-3.5" /> },
    { href: "/scrapling-test", title: "Scrapling Test", label: "Scrape", icon: <Bug className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)", color: "var(--text-1)", fontFamily: "var(--f)" }}>
      {/* ─ Sidebar ─ */}
      <nav
        className="flex flex-col shrink-0"
        style={{
          width: 210,
          minWidth: 210,
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
          padding: "16px 0",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 pb-3.5" style={{ borderBottom: "1px solid var(--border-xs)" }}>
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2.5 hover:opacity-85 transition-opacity text-left w-full cursor-pointer"
          >
            <div
              className="w-6 h-6 rounded flex items-center justify-center text-white text-[11px] font-bold shadow-sm"
              style={{ background: "var(--orange)" }}
            >
              D
            </div>
            <span className="font-semibold text-[13.5px] tracking-tight" style={{ color: "var(--text-1)" }}>
              DataMiner
            </span>
          </button>
        </div>

        {/* Section: Main Nav & Cases */}
        <div className="flex-1 overflow-y-auto px-3.5 py-3">
          {/* Quick Add Button */}
          <button
            onClick={() => router.push("/cases")}
            className="w-full text-left px-2.5 py-1.5 rounded text-xs cursor-pointer transition-all flex items-center gap-1.5 mb-3"
            style={{
              border: "1px dashed var(--border)",
              color: "var(--text-3)",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--orange)";
              e.currentTarget.style.color = "var(--orange)";
              e.currentTarget.style.background = "var(--orange-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-3)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Neuer Case</span>
          </button>

          {/* Primary Nav Links */}
          <div className="flex flex-col gap-0.5 mb-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] text-left transition-colors cursor-pointer"
              style={{
                background: pathname === "/dashboard" ? "var(--orange-soft)" : "transparent",
                color: pathname === "/dashboard" ? "var(--orange)" : "var(--text-2)",
                fontWeight: pathname === "/dashboard" ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (pathname !== "/dashboard") e.currentTarget.style.background = "var(--bg)";
              }}
              onMouseLeave={(e) => {
                if (pathname !== "/dashboard") e.currentTarget.style.background = "transparent";
              }}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => router.push("/cases")}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] text-left transition-colors cursor-pointer"
              style={{
                background: pathname === "/cases" ? "var(--orange-soft)" : "transparent",
                color: pathname === "/cases" ? "var(--orange)" : "var(--text-2)",
                fontWeight: pathname === "/cases" ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (pathname !== "/cases") e.currentTarget.style.background = "var(--bg)";
              }}
              onMouseLeave={(e) => {
                if (pathname !== "/cases") e.currentTarget.style.background = "transparent";
              }}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Alle Cases</span>
            </button>
          </div>

          {/* Cases List */}
          {cases.length > 0 && (
            <div>
              <div
                className="text-[10px] font-semibold tracking-wider uppercase mb-1.5 px-2"
                style={{ color: "var(--text-3)" }}
              >
                Cases
              </div>
              <div className="flex flex-col gap-1">
                {cases.map((c) => {
                  const isActive = pathname === `/cases/${c.id}`;
                  return (
                    <div
                      key={c.id}
                      onClick={() => router.push(`/cases/${c.id}`)}
                      className="px-2 py-1.5 rounded cursor-pointer transition-colors"
                      style={{
                        background: isActive ? "var(--orange-soft)" : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = "var(--bg)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div
                        className="text-[12px] font-medium truncate"
                        style={{ color: isActive ? "var(--orange)" : "var(--text-1)" }}
                        title={c.name}
                      >
                        {c.name}
                      </div>
                      {typeof c.rowCount === "number" && (
                        <div className="text-[10.5px] mt-0.5" style={{ color: "var(--text-3)" }}>
                          {c.rowCount} Zeilen
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Bottom icon row */}
        <div
          className="px-2 pt-2 pb-0 flex items-center justify-around"
          style={{ borderTop: "1px solid var(--border-xs)" }}
        >
          {bottomNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                title={item.title}
                className="flex flex-col items-center gap-0.5 px-1.5 py-1 rounded transition-colors cursor-pointer"
                style={{
                  color: active ? "var(--orange)" : "var(--text-3)",
                  background: active ? "var(--orange-soft)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = "var(--text-1)";
                    e.currentTarget.style.background = "var(--bg)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = "var(--text-3)";
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                {item.icon}
                <span className="text-[9px] leading-none font-medium mt-0.5">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ─ Main Content ─ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="px-6 py-3 flex items-center justify-between shrink-0"
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-2">
            {titleIcon}
            <span className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
              {title}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <WorkerMonitor />
            {actions}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6" style={{ background: "var(--bg)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function WorkerMonitor() {
  const [runs, setRuns] = useState<RunningRun[]>([]);
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      if (!active) return;
      try {
        const res = await fetch("/api/agent/worker");
        const data = await res.json();
        setRuns(Array.isArray(data.running) ? data.running : []);
      } catch {
        // ignore
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    if (expanded) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const total = runs.length;
  if (total === 0) return null;

  const totalUnique = runs.reduce((s, r) => s + (r.uniqueCount || 0), 0);
  const totalTarget = runs.reduce((s, r) => s + (r.targetCount || 0), 0);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded cursor-pointer transition-colors"
        style={{
          color: "var(--orange)",
          background: "var(--orange-soft)",
          border: "1px solid var(--orange-mid)",
        }}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>
          {total} Agent-Run{total === 1 ? "" : "s"} · {totalUnique.toLocaleString("de-DE")}/{totalTarget.toLocaleString("de-DE")}
        </span>
      </button>
      {expanded && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-lg shadow-md z-50 p-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--text-3)" }}
          >
            Laufende Ziel-Suchen
          </div>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {runs.map((r) => (
              <div
                key={r.id}
                onClick={() => router.push(`/cases/${r.caseId}`)}
                className="flex flex-col gap-1 p-2 rounded cursor-pointer transition-colors"
                style={{ background: "var(--bg)" }}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate flex-1" style={{ color: "var(--text-1)" }} title={r.goal ?? r.id}>
                    {r.goal ?? r.id}
                  </span>
                  <span className="font-semibold" style={{ color: "var(--orange)" }}>
                    {r.uniqueCount.toLocaleString("de-DE")}/{r.targetCount.toLocaleString("de-DE")}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      background: "var(--orange)",
                      width: `${Math.min(100, r.targetCount > 0 ? (r.uniqueCount / r.targetCount) * 100 : 0)}%`,
                    }}
                  />
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-3)" }}>
                  {r.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
