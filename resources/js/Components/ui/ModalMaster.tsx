"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

// ── Reusable Modal Master Shell ───────────────────────────────────────────────

export interface ModalProps {
  isOpen?: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  maxWidth?: string | number;
  maxHeight?: string | number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerRight?: React.ReactNode;
}

export function Modal({
  isOpen = true,
  onClose,
  title,
  subtitle,
  icon,
  badge,
  maxWidth = "42rem",
  maxHeight = "90vh",
  children,
  footer,
  headerRight,
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(24,24,27,0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          borderRadius: 14,
          border: "1px solid var(--border)",
          boxShadow: "0 20px 48px -10px rgba(0,0,0,0.18)",
          width: "100%",
          maxWidth,
          maxHeight,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header Master */}
        <div
          style={{
            padding: "13px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {icon && (
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "var(--r)",
                  background: "var(--orange-soft)",
                  border: "1px solid var(--orange-mid)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--orange)",
                  fontSize: 15,
                  flexShrink: 0,
                }}
              >
                {icon}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text-1)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {title}
                </h3>
                {badge && <div>{badge}</div>}
              </div>
              {subtitle && (
                <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 1 }}>{subtitle}</div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {headerRight}
            <button
              onClick={onClose}
              aria-label="Schließen"
              style={{
                width: 28,
                height: 28,
                border: "1px solid var(--border)",
                borderRadius: "var(--rs)",
                background: "#fff",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-2)",
                fontSize: 16,
                transition: "all 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg)";
                e.currentTarget.style.color = "var(--text-1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#fff";
                e.currentTarget.style.color = "var(--text-2)";
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>{children}</div>

        {/* Footer Master */}
        {footer && (
          <div
            style={{
              padding: "13px 20px",
              borderTop: "1px solid var(--border)",
              background: "var(--surface)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Master Form Field Component ───────────────────────────────────────────────

export interface FormFieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  rightLabel?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  rightLabel,
  className = "",
  style,
  children,
}: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`} style={style}>
      {(label || rightLabel) && (
        <div className="flex items-center justify-between">
          {label && (
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {label}
            </label>
          )}
          {rightLabel && <div>{rightLabel}</div>}
        </div>
      )}
      {children}
      {hint && !error && (
        <span style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.35 }}>{hint}</span>
      )}
      {error && (
        <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 500 }}>{error}</span>
      )}
    </div>
  );
}

// ── Master Input Component ───────────────────────────────────────────────────

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export function Input({ mono, style, className = "", ...props }: InputProps) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        border: "1px solid var(--border)",
        borderRadius: "var(--r)",
        padding: "7px 11px",
        fontSize: 13,
        outline: "none",
        background: "#fff",
        color: "var(--text-1)",
        fontFamily: mono ? "monospace" : "inherit",
        transition: "border-color 0.12s ease, box-shadow 0.12s ease",
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--orange)";
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--orange-soft)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
        props.onBlur?.(e);
      }}
      className={className}
    />
  );
}

// ── Master Textarea Component ─────────────────────────────────────────────────

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export function Textarea({ mono, style, className = "", ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      style={{
        width: "100%",
        border: "1px solid var(--border)",
        borderRadius: "var(--r)",
        padding: "8px 11px",
        fontSize: 13,
        outline: "none",
        background: "#fff",
        color: "var(--text-1)",
        fontFamily: mono ? "monospace" : "inherit",
        lineHeight: 1.5,
        transition: "border-color 0.12s ease, box-shadow 0.12s ease",
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--orange)";
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--orange-soft)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
        props.onBlur?.(e);
      }}
      className={className}
    />
  );
}

// ── Master Select Component ───────────────────────────────────────────────────

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  mono?: boolean;
}

export function Select({ mono, style, className = "", children, ...props }: SelectProps) {
  return (
    <select
      {...props}
      style={{
        width: "100%",
        border: "1px solid var(--border)",
        borderRadius: "var(--r)",
        padding: "7px 11px",
        fontSize: 13,
        outline: "none",
        background: "#fff",
        color: "var(--text-1)",
        fontFamily: mono ? "monospace" : "inherit",
        cursor: "pointer",
        transition: "border-color 0.12s ease, box-shadow 0.12s ease",
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--orange)";
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--orange-soft)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
        props.onBlur?.(e);
      }}
      className={className}
    >
      {children}
    </select>
  );
}

// ── Master Segmented Tabs ─────────────────────────────────────────────────────

export interface SegmentedTabsProps<T extends string> {
  tabs: Array<{ id: T; label: React.ReactNode; icon?: React.ReactNode; count?: number }>;
  activeTab: T;
  onChange: (id: T) => void;
  style?: React.CSSProperties;
}

export function SegmentedTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  style,
}: SegmentedTabsProps<T>) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        padding: 3,
        borderRadius: "var(--r)",
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: "var(--rs)",
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 500,
              background: isActive ? "var(--surface)" : "transparent",
              color: isActive ? "var(--orange)" : "var(--text-2)",
              boxShadow: isActive ? "var(--shadow-sm)" : "none",
              transition: "all 0.12s ease",
            }}
          >
            {tab.icon && <span>{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 999,
                  background: isActive ? "var(--orange-soft)" : "var(--border)",
                  color: isActive ? "var(--orange)" : "var(--text-2)",
                  fontWeight: 600,
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Master Callout Alert ──────────────────────────────────────────────────────

export interface CalloutProps {
  type?: "info" | "warn" | "error" | "success";
  title?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Callout({ type = "info", title, children, action, style }: CalloutProps) {
  const configs = {
    info: {
      bg: "var(--bg)",
      border: "var(--border)",
      color: "var(--text-1)",
      icon: "ℹ️",
    },
    warn: {
      bg: "var(--warn-soft)",
      border: "#fed7aa",
      color: "#9a4411",
      icon: "⚠️",
    },
    error: {
      bg: "var(--danger-soft)",
      border: "#fecaca",
      color: "#991b1b",
      icon: "✗",
    },
    success: {
      bg: "var(--green-soft)",
      border: "var(--green-mid)",
      color: "#166534",
      icon: "✓",
    },
  };

  const c = configs[type];

  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: "var(--r)",
        padding: "10px 14px",
        fontSize: 12,
        color: c.color,
        lineHeight: 1.45,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        ...style,
      }}
    >
      <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{c.icon}</span>
      <div style={{ flex: 1 }}>
        {title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>}
        <div>{children}</div>
        {action && <div style={{ marginTop: 6 }}>{action}</div>}
      </div>
    </div>
  );
}
