"use client";

import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, Database, Bug, Key } from "lucide-react";

/**
 * AppShell — shared sidebar + topbar so every page has a consistent frame.
 * Standard: w-64 sidebar, single nav list, rounded-xl cards.
 *
 * Usage:
 *   <AppShell title="Dashboard" actions={<button/>}>
 *     ...page content (scrollable)...
 *   </AppShell>
 */
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
  const bottom = [
    { href: "/settings", label: "Globale Einstellungen", icon: <Key className="w-3.5 h-3.5" /> },
    { href: "/scrapling-test", label: "Scrapling Test", icon: <Bug className="w-3.5 h-3.5" /> },
  ];

  const isActive = (href: string) =>
    href === "/cases" ? pathname.startsWith("/cases") : pathname === href;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-violet-600 rounded flex items-center justify-center text-white text-xs font-bold">
              D
            </div>
            <span className="font-semibold text-gray-900 text-sm">DataMiner</span>
          </div>
        </div>

        {/* Primary nav */}
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

        {/* Bottom links */}
        <div className="px-3 py-3 border-t border-gray-100 space-y-1">
          {bottom.map((item) => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg text-left transition-colors ${
                isActive(item.href)
                  ? "font-medium text-violet-700 bg-violet-50"
                  : "text-gray-500 hover:text-violet-600 hover:bg-violet-50"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {titleIcon}
            <span className="text-sm font-semibold text-gray-800">{title}</span>
          </div>
          {actions}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}
