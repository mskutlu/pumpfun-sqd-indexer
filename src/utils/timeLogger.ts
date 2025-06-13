// Utility function to time asynchronous/synchronous operations
// and log their execution duration to the console.
// The log format is prefixed with `performance.` so that it can be
// easily grepped or visualised by external tooling.

export async function withTimer<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await operation();
  } finally {
    const duration = Date.now() - start;
    // Emit a simple log line that can be parsed by tools like `grep`
    // Example: "performance.db.upsert 23"
    //console.log(`performance.${label} ${duration}`);
  }
}

// Synchronous helper (rare case)
export function withTimerSync<T>(label: string, operation: () => T): T {
  const start = Date.now();
  try {
    return operation();
  } finally {
    const duration = Date.now() - start;
    //console.log(`performance.${label} ${duration}`);
  }
}
