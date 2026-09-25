import { useState, useMemo } from "react";

export type FilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "lt";

export interface FilterRule {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export function useTableFilter<T extends { data: Record<string, any> }>(items: T[]) {
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const addFilter = (defaultColumn: string = "") => {
    setFilters((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        column: defaultColumn,
        operator: "contains",
        value: "",
      },
    ]);
  };

  const updateFilter = (id: string, updates: Partial<FilterRule>) => {
    setFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  };

  const removeFilter = (id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id));
  };

  const clearFilters = () => {
    setFilters([]);
    setSearchQuery("");
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Global Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesGlobal = Object.values(item.data || {}).some((val) =>
          val != null && String(val).toLowerCase().includes(query)
        );
        if (!matchesGlobal) return false;
      }

      // 2. Structured Column Filters (AND logic)
      for (const filter of filters) {
        if (!filter.column) continue;
        const rawVal = item.data?.[filter.column];
        const valStr = rawVal == null ? "" : String(rawVal).toLowerCase().trim();
        const targetStr = (filter.value || "").toLowerCase().trim();

        switch (filter.operator) {
          case "contains":
            if (!valStr.includes(targetStr)) return false;
            break;
          case "not_contains":
            if (valStr.includes(targetStr)) return false;
            break;
          case "equals":
            if (valStr !== targetStr) return false;
            break;
          case "not_equals":
            if (valStr === targetStr) return false;
            break;
          case "starts_with":
            if (!valStr.startsWith(targetStr)) return false;
            break;
          case "ends_with":
            if (!valStr.endsWith(targetStr)) return false;
            break;
          case "is_empty":
            if (valStr !== "") return false;
            break;
          case "is_not_empty":
            if (valStr === "") return false;
            break;
          case "gt": {
            const num = parseFloat(valStr);
            const target = parseFloat(targetStr);
            if (isNaN(num) || isNaN(target) || num <= target) return false;
            break;
          }
          case "lt": {
            const num = parseFloat(valStr);
            const target = parseFloat(targetStr);
            if (isNaN(num) || isNaN(target) || num >= target) return false;
            break;
          }
          default:
            break;
        }
      }

      return true;
    });
  }, [items, filters, searchQuery]);

  return {
    filters,
    searchQuery,
    setSearchQuery,
    addFilter,
    updateFilter,
    removeFilter,
    clearFilters,
    filteredItems,
    hasActiveFilters: filters.length > 0 || searchQuery.trim().length > 0,
    filterCount: filters.length + (searchQuery.trim() ? 1 : 0),
  };
}
