import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { SearchList } from "@/components/searches/SearchList";
import { ZipSearchForm } from "@/components/searches/ZipSearchForm";

export const dynamic = "force-dynamic";

export default async function SearchesPage() {
  const actor = await getActor();
  const items = await prisma.search.findMany({ where: { ownerId: actor.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h1 className="text-2xl font-semibold">Searches</h1>
        <ZipSearchForm />
      </div>
      <SearchList initial={items} />
    </div>
  );
}
