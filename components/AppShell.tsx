"use client";

import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, Database, Bug, Settings, Sliders, Zap } from "lucide-react";

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

  const isActive = (href: string) =>
    href === "/cases" ? pathname.startsWith("/cases") : pathname === href;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-violet-600 rounded flex items-center justify-center text-white text-xs font-bold">D</div>
            <span className="font-semibold text-gray-900 text-sm">DataMiner</span>
          </div>
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

        <div className="px-3 py-3 border-t border-gray-100 flex items-center gap-1">
          <button
            onClick={() => router.push("/settings")}
            title="API & Region"
            className={`p-2 rounded-lg transition-colors ${
              pathname === "/settings" ? "text-violet-700 bg-violet-50" : "text-gray-400 hover:text-violet-600 hover:bg-violet-50"
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={() => router.push("/settings/models")}
            title="Modell-Auswahl"
            className={`p-2 rounded-lg transition-colors ${
              pathname === "/settings/models" ? "text-violet-700 bg-violet-50" : "text-gray-400 hover:text-violet-600 hover:bg-violet-50"
            }`}
          >
            <Sliders className="w-4 h-4" />
          </button>
          <button
            onClick={() => router.push("/settings/llm-test")}
            title="LLM-Testing"
            className={`p-2 rounded-lg transition-colors ${
              pathname === "/settings/llm-test" ? "text-blue-700 bg-blue-50" : "text-gray-400 hover:text-blue-600 hover:bg-blue-50"
            }`}
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            onClick={() => router.push("/scrapling-test")}
            title="Scrapling Test"
            className={`p-2 rounded-lg transition-colors ${
              pathname === "/scrapling-test" ? "text-violet-700 bg-violet-50" : "text-gray-400 hover:text-violet-600 hover:bg-violet-50"
            }`}
          >
            <Bug className="w-4 h-4" />
          </button>
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
