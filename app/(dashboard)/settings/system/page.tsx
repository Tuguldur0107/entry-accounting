import { allAiTools, AI_TOOLS } from "@/lib/ai/tools";
import { customizationSummary } from "@/lib/custom/loader";
import { APP_VERSION, GIT_SHA, UPSTREAM_REPO } from "@/lib/version";

export const metadata = { title: "Систем, хувилбар — Entry Accounting" };
export const dynamic = "force-dynamic";

// Хувилбар, custom/ өргөтгөл, интеграцийн цэгүүд — fork дээр "аль хувилбар
// дээр байна вэ, юу өргөтгөсөн бэ" гэдгийг нэг дороос харна (нууц байхгүй).
export default function SystemPage() {
  const custom = customizationSummary();
  const total = allAiTools().length;
  const rows: [string, string][] = [
    ["Хувилбар", `v${APP_VERSION}`],
    ["Commit", GIT_SHA ? GIT_SHA.slice(0, 12) : "— (GIT_SHA орчны хувьсагч тохируулаагүй)"],
    ["Upstream (core)", `github.com/${UPSTREAM_REPO}`],
    ["AI / MCP / REST tools", `${total} (core ${AI_TOOLS.length} + custom ${custom.toolCount})`],
    ["custom/ багц", custom.name ? `${custom.name}${custom.version ? ` v${custom.version}` : ""}` : "— (бүртгэлгүй, custom/index.ts)"],
    ["custom/ hooks", custom.hooks.length > 0 ? custom.hooks.join(", ") : "—"],
  ];
  const endpoints: [string, string][] = [
    ["MCP", "/api/mcp — Bearer eak_/eoat_ token (Claude Code, Cowork, claude.ai)"],
    ["REST API v1", "GET /api/v1/tools · POST /api/v1/tools/<name> — ижил token"],
    ["OAuth", "/.well-known/oauth-authorization-server — custom connector-ийн Connect"],
    ["Health", "/api/health — { ok, version, sha } (нэвтрэлтгүй)"],
  ];
  return (
    <div className="max-w-2xl space-y-6">
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Систем, хувилбар</h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            Шинэчлэлт: fork дээр Actions → Upstream sync; заавар docs/deployment/README.md
          </p>
        </div>
        <dl className="grid gap-2 text-xs sm:grid-cols-[180px_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--ea-text-3)]">{label}</dt>
              <dd className="font-mono text-[var(--ea-text-1)]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Интеграцийн цэгүүд</h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            Token: AI туслах → Тохиргоо → MCP холболт. Дэлгэрэнгүй docs/deployment/api-integration.md
          </p>
        </div>
        <dl className="grid gap-2 text-xs sm:grid-cols-[180px_1fr]">
          {endpoints.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--ea-text-3)]">{label}</dt>
              <dd className="font-mono text-[var(--ea-text-1)]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
