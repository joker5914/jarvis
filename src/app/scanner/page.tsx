import { ScannerView } from "@/components/scanner/ScannerView";

export default function ScannerPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Scanner</h1>
        <p className="text-sm text-muted-foreground">Runs zip searches, TDLR syncs, and website re-checks on their own inside your operating window. Pause or stop at any time.</p>
      </div>
      <ScannerView />
    </div>
  );
}
