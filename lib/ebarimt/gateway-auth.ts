// Операторын PosAPI / ТЕГ-ийн лавлахын прокси руу явах хүсэлтийн НУУЦ HEADER —
// ЦЭВЭР (tests/ebarimt-gateway-auth.test.ts). docs/deployment/ebarimt.md §4a.
//
// Операторын PosAPI (жишээ нь Cloudflare-ийн ард `https://ebarimt.chipmo.mn`)
// интернэтэд нээлттэй бол хэн ч `/rest/info`-оос мерчантуудын ТТД-г харж,
// `/rest/receipt`-ээр тэдний нэрээр баримт үүсгэж болзошгүй. Албан best practice
// нь PosAPI-г нийтэд ил тавихгүй байх. Хямд шийдэл: Cloudflare WAF «энэ header
// байхгүй хүсэлтийг хаах» + Entry СЕРВЕР бүх хүсэлтдээ header-ийг нэмнэ.
//
// ⚠️ SaaS-д харилцагчийн админ `ebarimtPosApiUrl`-аа дурын хаягаар тохируулж
// чадна — header-ийг ЗӨВХӨН `EBARIMT_GATEWAY_HOSTS`-д ил бүртгэсэн хост руу
// илгээнэ, эс бөгөөс нууц харилцагчийн сервер рүү алдагдана. Жагсаалт хоосон
// бол header ХЭЗЭЭ Ч илгээгдэхгүй (default аюулгүй). Нууцын утгыг логлохгүй.
//
// Browser горимд кассын дэлгэц PosAPI-г шууд дууддаг — энд нууц ОРОХГҮЙ
// (NEXT_PUBLIC биш env client bundle-д байхгүй); тэр горим кассын PC-ийн
// localhost руу явдаг тул хамаарахгүй.

export const EBARIMT_GATEWAY_DEFAULT_HEADER = "x-entry-gateway-key";

/** RFC 7230 token — header-ийн нэр. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export interface GatewayEnv {
  EBARIMT_GATEWAY_KEY?: string;
  EBARIMT_GATEWAY_HEADER?: string;
  EBARIMT_GATEWAY_HOSTS?: string;
}

/** `EBARIMT_GATEWAY_HOSTS` — таслалаар/зайгаар тусгаарласан хостын нэрс (жижиг үсгээр). */
export function parseGatewayHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/** Тохиргоо бүрэн эсэх (health / статуст — утга БИШ, зөвхөн тийм/үгүй). */
export function gatewayAuthConfigured(env: GatewayEnv): boolean {
  const key = env.EBARIMT_GATEWAY_KEY?.trim() ?? "";
  const name = env.EBARIMT_GATEWAY_HEADER?.trim() || EBARIMT_GATEWAY_DEFAULT_HEADER;
  return key.length > 0 && HEADER_NAME_RE.test(name) && parseGatewayHosts(env.EBARIMT_GATEWAY_HOSTS).length > 0;
}

/**
 * `url` руу явах хүсэлтэд нэмэх header. Нууц тохируулаагүй, header-ийн нэр
 * буруу, URL уншигдахгүй, эсвэл хост жагсаалтад байхгүй бол `{}`.
 */
export function gatewayHeadersFor(url: string, env: GatewayEnv): Record<string, string> {
  if (!gatewayAuthConfigured(env)) return {};
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return {};
  }
  if (!parseGatewayHosts(env.EBARIMT_GATEWAY_HOSTS).includes(host)) return {};
  const name = env.EBARIMT_GATEWAY_HEADER?.trim() || EBARIMT_GATEWAY_DEFAULT_HEADER;
  return { [name]: env.EBARIMT_GATEWAY_KEY!.trim() };
}

/** Серверийн env (client bundle-д эдгээр хувьсагч байхгүй тул хоосон). */
export function serverGatewayEnv(): GatewayEnv {
  if (typeof process === "undefined" || !process.env) return {};
  return {
    EBARIMT_GATEWAY_KEY: process.env.EBARIMT_GATEWAY_KEY,
    EBARIMT_GATEWAY_HEADER: process.env.EBARIMT_GATEWAY_HEADER,
    EBARIMT_GATEWAY_HOSTS: process.env.EBARIMT_GATEWAY_HOSTS,
  };
}

export function gatewayHeaders(url: string): Record<string, string> {
  return gatewayHeadersFor(url, serverGatewayEnv());
}
