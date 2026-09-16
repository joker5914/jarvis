export function ProgressBar({ current, total, label }: { current?: number; total?: number; label?: string }) {
  const pct = total && total > 0 ? Math.min(100, Math.round(((current ?? 0) / total) * 100)) : null;
  return (
    <div className="w-full" data-testid="progress-bar">
      <div
        className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"
        role="progressbar"
        aria-label={label ?? "Search progress"}
        {...(pct != null ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct } : { "aria-busy": true })}
      >
        <div
          className={`h-2 rounded bg-blue-600 transition-all ${pct == null ? "w-1/3 animate-pulse" : ""}`}
          style={pct != null ? { width: `${pct}%` } : undefined}
        />
      </div>
      {label && (
        <div className="mt-1 text-xs text-neutral-500">
          {label}
          {pct != null && ` · ${current}/${total}`}
        </div>
      )}
    </div>
  );
}
