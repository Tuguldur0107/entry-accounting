// «AI холболт» хуудасны ChatGPT / Claude-ийн холбох товч + холболтын төлөв —
// ЦЭВЭР, CLIENT-SAFE (tests/ai-connector-clients.test.ts).
//
// Гадны AI connector-ийг автоматаар нэмдэг албан deep link БАЙХГҮЙ (аюулгүй
// байдлын шаардлага — хэрэглэгч өөрөө «Add custom connector» дарж OAuth-оор
// зөвшөөрнө). Тиймээс товч нь MCP хаягийг хуулаад тэдний connector-ийн
// тохиргооны хуудсыг шинэ табд нээнэ — хэрэглэгч зөвхөн буулгаад Connect дарна.
// Тохиргооны хаяг гадны бүтээгдэхүүнийх тул өөрчлөгдвөл ЗӨВХӨН энд засна.

export type ConnectorClient = "claude" | "chatgpt";

export const CONNECTOR_TARGETS: Record<ConnectorClient, { label: string; settingsUrl: string }> = {
  claude: { label: "Claude", settingsUrl: "https://claude.ai/new#customize/connectors" },
  chatgpt: { label: "ChatGPT", settingsUrl: "https://chatgpt.com/plugins" },
};

const HOST_PATTERNS: Record<ConnectorClient, RegExp> = {
  claude: /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/i,
  chatgpt: /(^|\.)(chatgpt\.com|openai\.com)$/i,
};

function hostOf(uri: string): string | null {
  try {
    return new URL(uri).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * OAuth (DCR) клиентийг ChatGPT / Claude-д ангилна — эхлээд redirect_uri-ийн
 * хостоор (клиент өөрөө нэрээ дурын бичиж болох тул найдвартай), дараа нь нэрээр.
 * Танигдахгүй бол null (жишээ нь Claude Code / бусад MCP клиент).
 */
export function classifyOAuthClient(name: string | null | undefined, redirectUris: string[]): ConnectorClient | null {
  for (const uri of redirectUris) {
    const host = hostOf(uri);
    if (!host) continue;
    if (HOST_PATTERNS.claude.test(host)) return "claude";
    if (HOST_PATTERNS.chatgpt.test(host)) return "chatgpt";
  }
  const label = (name ?? "").toLowerCase();
  if (/claude|anthropic/.test(label)) return "claude";
  if (/chatgpt|openai/.test(label)) return "chatgpt";
  return null;
}

/** `oauth_clients.redirect_uris` — JSON массив; гажиг бол хоосон. */
export function parseRedirectUris(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export interface OAuthConnectionRow {
  clientName: string | null;
  redirectUris: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export interface AiConnectionView {
  client: ConnectorClient;
  label: string;
  /** Анх холбогдсон (хамгийн эртний token). */
  connectedAt: string | null;
  /** Сүүлд MCP дуудсан — null бол холбогдсон ч хараахан ашиглаагүй. */
  lastUsedAt: string | null;
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const earlier = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Энэ хэрэглэгч × байгууллагын OAuth token-уудыг ChatGPT / Claude-оор нэгтгэнэ. */
export function summarizeAiConnections(rows: OAuthConnectionRow[]): AiConnectionView[] {
  const byClient = new Map<ConnectorClient, AiConnectionView>();
  for (const row of rows) {
    const client = classifyOAuthClient(row.clientName, parseRedirectUris(row.redirectUris));
    if (!client) continue;
    const current = byClient.get(client);
    byClient.set(client, {
      client,
      label: CONNECTOR_TARGETS[client].label,
      connectedAt: earlier(current?.connectedAt ?? null, row.createdAt),
      lastUsedAt: later(current?.lastUsedAt ?? null, row.lastUsedAt),
    });
  }
  return (["claude", "chatgpt"] as const).flatMap((client) => {
    const view = byClient.get(client);
    return view ? [view] : [];
  });
}

/** «5 минутын өмнө» / «3 цагийн өмнө» / «2 хоногийн өмнө» — UI-ийн товч тайлбар. */
export function relativeTimeMn(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return "дөнгөж сая";
  if (minutes < 60) return `${minutes} минутын өмнө`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} цагийн өмнө`;
  return `${Math.floor(hours / 24)} хоногийн өмнө`;
}
