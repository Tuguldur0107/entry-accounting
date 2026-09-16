// Entry deployment-ийн лицензийн token олгогч (Console/CI-ээс ажиллуулна).
//
//   ENTRY_LICENSE_SIGNING_KEY='-----BEGIN PRIVATE KEY-----…' \
//     node scripts/issue-license.mjs --slug goyol --url https://goyol.entry.mn --days 365 [--plan standard]
//
// Нууц түлхүүр repo-д БАЙХГҮЙ — Entry Console / GitHub Actions secret-д
// хадгална. Гаралт нь deployment-ийн ENTRY_LICENSE env-д тавигдана.
// Public тал: lib/licensing/license.ts (offline баталгаажуулалт).

import { createPrivateKey, sign } from "node:crypto";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const slug = arg("slug");
const url = arg("url");
const days = Number(arg("days", "365"));
const plan = arg("plan");

if (!slug || !url || !Number.isFinite(days) || days <= 0) {
  console.error(
    "Хэрэглээ: ENTRY_LICENSE_SIGNING_KEY=… node scripts/issue-license.mjs --slug <slug> --url <https://…> --days <N> [--plan <нэр>]"
  );
  process.exit(1);
}
new URL(url); // буруу URL бол энд шидэгдэнэ

const pem = process.env.ENTRY_LICENSE_SIGNING_KEY;
if (!pem?.includes("PRIVATE KEY")) {
  console.error("ENTRY_LICENSE_SIGNING_KEY env-д Ed25519 private key (PEM) өгнө үү");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const payload = {
  slug,
  appUrl: new URL(url).origin,
  ...(plan ? { plan } : {}),
  iat: now,
  exp: now + Math.round(days * 86400),
};

const payloadRaw = Buffer.from(JSON.stringify(payload), "utf8");
const signature = sign(null, payloadRaw, createPrivateKey(pem));
const token = `entl_${payloadRaw.toString("base64url")}.${signature.toString("base64url")}`;

console.error(
  `slug=${payload.slug} url=${payload.appUrl} exp=${new Date(payload.exp * 1000).toISOString().slice(0, 10)}`
);
console.log(token);
