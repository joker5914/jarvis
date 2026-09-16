import Link from "next/link";
import { LeadDetail } from "@/components/leads/LeadDetail";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/leads" className="text-sm text-blue-600 hover:underline">← Back to leads</Link>
      <LeadDetail id={id} />
    </div>
  );
}
