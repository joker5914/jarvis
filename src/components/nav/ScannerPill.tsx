export function ScannerPill() {
  return (
    <span
      data-testid="scanner-pill"
      className="hidden items-center gap-2 rounded-full border px-3 py-1 text-xs text-neutral-500 md:inline-flex"
    >
      <span className="h-2 w-2 rounded-full bg-neutral-400" />
      Scanner off
    </span>
  );
}
