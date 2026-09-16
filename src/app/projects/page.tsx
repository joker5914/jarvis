"use client";

import { Suspense } from "react";
import { ProjectsView } from "@/components/projects/ProjectsView";

export default function ProjectsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-neutral-500">Houston construction and renovation projects from the TDLR registry, scored for SMB fit and timing.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <ProjectsView />
      </Suspense>
    </div>
  );
}
