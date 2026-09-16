import { getActor } from "@/lib/actor";
import { loadConfig } from "@/lib/config/runtime";
import { LeadsPageClient } from "@/components/leads/LeadsPageClient";

export default async function LeadsPage() {
  const actor = await getActor();
  const cfg = await loadConfig(actor.id);
  const categories = cfg.allCategories.filter((c) => c.enabled).map(({ slug, label }) => ({ slug, label }));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Leads</h1>
      <LeadsPageClient categories={categories} />
    </div>
  );
}
