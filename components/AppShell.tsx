"use client";

import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, Database, Bug, Settings, Sliders, Zap, Sparkles } from "lucide-react";

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
          {actions}
        </div>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}
