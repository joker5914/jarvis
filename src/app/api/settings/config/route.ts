import { ZodError } from "zod";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { saveOverrides, type RuntimeConfig } from "@/lib/config/runtime";

function toConfigPayload(cfg: RuntimeConfig) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- entityPatterns are fixed in code, not editable via the API
  const { entityPatterns: _e, ...exclusion } = cfg.exclusion;
  return {
    exclusion,
    categories: cfg.allCategories.map(({ slug, label, enabled, packageSlug, defaultPackageSlug }) => ({
      slug,
      label,
      enabled,
      packageSlug,
      defaultPackageSlug,
    })),
    projects: cfg.projects,
  };
}

export const PUT = handle(async (req) => {
  const actor = await getActor();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  let cfg: RuntimeConfig;
  try {
    cfg = await saveOverrides(actor.id, body);
  } catch (e) {
    if (e instanceof ZodError) throw new ApiError(400, e.issues[0]?.message ?? "Validation failed");
    throw e;
  }
  return json({ config: toConfigPayload(cfg) });
});
