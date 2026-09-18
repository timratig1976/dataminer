"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, Database, Bug, Settings, Sliders, Zap, Sparkles, Loader2 } from "lucide-react";

interface RunningRun {
  id: string;
  caseId: string;
  uniqueCount: number;
  targetCount: number;
  status: string;
  goal?: string;
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

  // Global agent worker loop: continues runs when no page tab is driving them
  useEffect(() => {
    let active = true;
    let inFlight = false;

    let idleCount = 0;

    async function tick() {
      if (!active || inFlight) return;
      inFlight = true;

      try {
        // Collect runIds currently driven by an active page tab (heartbeat < 5s)
        const owned: string[] = [];
        const now = Date.now();
        const HEARTBEAT_TTL = 5000;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("agentLoop:")) continue;
          const ts = parseInt(localStorage.getItem(key) || "0", 10);
          if (!isNaN(ts) && now - ts < HEARTBEAT_TTL) {
            owned.push(key.slice("agentLoop:" .length));
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
        // Throttle if no work is being done
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

    // Dynamic interval: 3s when busy, up to 30s when idle
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

  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
    { href: "/cases", label: "Alle Cases", icon: <Database className="w-4 h-4" /> },
  ];

  const bottomNav = [
    { href: "/settings",          title: "API & Region",   label: "Keys",    icon: <Settings className="w-4 h-4" />,  color: "violet" },
    { href: "/settings/models",   title: "Modell-Auswahl", label: "Models",  icon: <Sliders className="w-4 h-4" />,   color: "violet" },
    { href: "/settings/planner",  title: "Planner Prompt", label: "Planner", icon: <Sparkles className="w-4 h-4" />,  color: "violet" },
    { href: "/settings/llm-test", title: "LLM-Testing",    label: "LLM",     icon: <Zap className="w-4 h-4" />,       color: "blue"   },
    { href: "/scrapling-test",    title: "Scrapling Test", label: "Scrape",  icon: <Bug className="w-4 h-4" />,       color: "violet" },
  ];

  const isActive = (href: string) =>
    href === "/cases" ? pathname.startsWith("/cases") : pathname === href;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-100">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity w-full text-left"
          >
            <div className="w-6 h-6 bg-violet-600 rounded flex items-center justify-center text-white text-xs font-bold">D</div>
            <span className="font-semibold text-gray-900 text-sm">DataMiner</span>
          </button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {nav.map((item) => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors ${
                isActive(item.href)
                  ? "font-medium text-violet-700 bg-violet-50"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Bottom icon row — always 5 icons, always visible */}
        <div className="px-2 py-2 border-t border-gray-100 flex items-end justify-around">
          {bottomNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const isBlue = item.color === "blue";
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                title={item.title}
                className={`flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-lg transition-colors min-w-0 ${
                  active
                    ? isBlue ? "text-blue-700 bg-blue-50" : "text-violet-700 bg-violet-50"
                    : isBlue ? "text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                             : "text-gray-400 hover:text-violet-600 hover:bg-violet-50"
                }`}
              >
                {item.icon}
                <span className="text-[9px] leading-none font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {titleIcon}
            <span className="text-sm font-semibold text-gray-800">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <WorkerMonitor />
            {actions}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">{children}</div>
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

  // Close on outside click
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
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 transition-colors"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>{total} Agent-Run{total === 1 ? "" : "s"} · {totalUnique.toLocaleString("de-DE")}/{totalTarget.toLocaleString("de-DE")}</span>
      </button>
      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 p-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Laufende Ziel-Suchen</div>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {runs.map(r => (
              <div key={r.id} onClick={() => router.push(`/cases/${r.caseId}`)}
                className="flex flex-col gap-1 p-2.5 rounded-lg bg-gray-50 hover:bg-blue-50 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-900 truncate flex-1" title={r.goal ?? r.id}>{r.goal ?? r.id}</span>
                  <span className="text-blue-600 font-semibold">{r.uniqueCount.toLocaleString("de-DE")}/{r.targetCount.toLocaleString("de-DE")}</span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, r.targetCount > 0 ? (r.uniqueCount / r.targetCount) * 100 : 0)}%` }} />
                </div>
                <div className="text-[10px] text-gray-400">{r.status}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
