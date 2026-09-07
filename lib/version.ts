// Хувилбарын ЦОРЫН ГАНЦ эх сурвалж — package.json-ийн version (git tag-тай
// ижил: vX.Y.Z). Deploy-ийн commit SHA-г хостинг орчны хувьсагчаас уншина
// (Railway: RAILWAY_GIT_COMMIT_SHA, Vercel: VERCEL_GIT_COMMIT_SHA, өөр
// орчинд GIT_SHA гараар өгнө). Client/server хоёуланд аюулгүй — нууц байхгүй.

import packageJson from "@/package.json";

export const APP_VERSION: string = packageJson.version;

export const GIT_SHA: string | null =
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_SHA ??
  null;

/** Upstream (core) repo — fork-ууд шинэчлэлтээ эндээс авна. */
export const UPSTREAM_REPO = "Tuguldur0107/entry-accounting";

export function versionLabel(): string {
  return GIT_SHA ? `v${APP_VERSION} (${GIT_SHA.slice(0, 7)})` : `v${APP_VERSION}`;
}
