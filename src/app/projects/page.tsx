import { Suspense } from "react";
import { getActor } from "@/lib/actor";
import { loadConfig } from "@/lib/config/runtime";
import { ProjectsView } from "@/components/projects/ProjectsView";

export default async function ProjectsPage() {
  const actor = await getActor();
  const cfg = await loadConfig(actor.id);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">Houston construction and renovation projects from the TDLR registry, scored for SMB fit and timing.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ProjectsView thresholds={cfg.projects} />
      </Suspense>
    </div>
  );
}
