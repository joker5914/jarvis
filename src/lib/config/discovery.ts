/** Place Details are re-fetched for a known place only after this many days; each category search returns at most this many places (Google ranks by prominence; 60 is the API maximum). */
export const DISCOVERY_CONFIG = { detailsRefreshDays: 30, maxPlacesPerCategory: 40 } as const;
