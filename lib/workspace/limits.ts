export const DEFAULT_WORKSPACE_PLAN_TIER = "basic";
export const MAX_OWNED_BASIC_WORKSPACES = 5;
export const MAX_WORKSPACE_MEMBERSHIPS = 25;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeWorkspacePlanTier(value: unknown) {
  const normalized = normalizeText(value);
  if (normalized) {
    return normalized;
  }

  return DEFAULT_WORKSPACE_PLAN_TIER;
}

export function parseWorkspaceSlugs(value: unknown) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const entry of value) {
    const slug = normalizeText(entry);
    if (!slug) continue;
    unique.add(slug);
  }

  return Array.from(unique);
}

export function isBasicPlanTier(value: unknown) {
  return normalizeWorkspacePlanTier(value) === DEFAULT_WORKSPACE_PLAN_TIER;
}
