import { useState, useMemo } from "react";

export interface SortRule {
  column: string;
  direction: "asc" | "desc";
}

export function useTableSort<T extends { data: Record<string, any> }>(items: T[]) {
  const [sortRules, setSortRules] = useState<SortRule[]>([]);

  const toggleSort = (column: string, explicitDir?: "asc" | "desc") => {
    setSortRules((prev) => {
      const existingIdx = prev.findIndex((r) => r.column === column);
      if (explicitDir) {
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = { column, direction: explicitDir };
          return next;
        }
        return [{ column, direction: explicitDir }];
      }

      if (existingIdx >= 0) {
        const current = prev[existingIdx];
        if (current.direction === "asc") {
          const next = [...prev];
          next[existingIdx] = { column, direction: "desc" };
          return next;
        } else {
          return prev.filter((_, idx) => idx !== existingIdx);
        }
      } else {
        return [{ column, direction: "asc" }];
      }
    });
  };

  const addSortRule = (column: string = "") => {
    setSortRules((prev) => [...prev, { column, direction: "asc" }]);
  };

  const updateSortRule = (index: number, updates: Partial<SortRule>) => {
    setSortRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...updates } : r))
    );
  };

  const removeSortRule = (index: number) => {
    setSortRules((prev) => prev.filter((_, i) => i !== index));
  };

  const clearSort = () => {
    setSortRules([]);
  };

  const sortedItems = useMemo(() => {
    if (sortRules.length === 0) return items;

    return [...items].sort((a, b) => {
      for (const rule of sortRules) {
        if (!rule.column) continue;
        const valA = a.data?.[rule.column] ?? "";
        const valB = b.data?.[rule.column] ?? "";

        // Number comparison
        const numA = typeof valA === "number" ? valA : parseFloat(String(valA));
        const numB = typeof valB === "number" ? valB : parseFloat(String(valB));
        const bothNumbers = !isNaN(numA) && !isNaN(numB) && String(valA).trim() !== "" && String(valB).trim() !== "";

        let cmp = 0;
        if (bothNumbers) {
          cmp = numA - numB;
        } else {
          cmp = String(valA).localeCompare(String(valB), "de", { numeric: true, sensitivity: "base" });
        }

        if (cmp !== 0) {
          return rule.direction === "asc" ? cmp : -cmp;
        }
      }
      return 0;
    });
  }, [items, sortRules]);

  return {
    sortRules,
    toggleSort,
    addSortRule,
    updateSortRule,
    removeSortRule,
    clearSort,
    sortedItems,
    hasActiveSort: sortRules.length > 0,
    sortCount: sortRules.length,
  };
}
