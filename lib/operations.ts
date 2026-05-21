// In-memory store for tracking running operations
// This allows cancellation to work even after page reloads

export interface RunningOperation {
  id: string;
  type: 'cell' | 'column';
  caseId: string;
  rowId?: string;
  columnId?: string;
  startTime: number;
  cancelled: boolean;
}

const runningOperations = new Map<string, RunningOperation>();

export function registerOperation(op: Omit<RunningOperation, 'id' | 'cancelled'>): string {
  const id = `${op.type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  runningOperations.set(id, { ...op, id, cancelled: false });
  return id;
}

export function cancelOperation(id: string): boolean {
  const op = runningOperations.get(id);
  if (op) {
    op.cancelled = true;
    return true;
  }
  return false;
}

export function isOperationCancelled(id: string): boolean {
  const op = runningOperations.get(id);
  return op?.cancelled ?? false;
}

export function getOperation(id: string): RunningOperation | undefined {
  return runningOperations.get(id);
}

export function removeOperation(id: string): void {
  runningOperations.delete(id);
}

export function cleanupOldOperations(maxAgeMs: number = 3600000): void {
  const now = Date.now();
  for (const [id, op] of runningOperations.entries()) {
    if (now - op.startTime > maxAgeMs) {
      runningOperations.delete(id);
    }
  }
}

// Cleanup old operations every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => cleanupOldOperations(), 300000);
}
