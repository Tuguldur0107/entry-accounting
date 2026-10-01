// Голомт OBI-ийн HTTP клиент — ЗӨВХӨН унших үйлчилгээ (Фаз 1): нэвтрэх,
// дансны жагсаалт (ACCTLST), үлдэгдэл (ACCTBALINQ), хуудаслалттай хуулга
// (OPERACCSTAINQ). Гүйлгээ хийх (CGWTXNADD, TOTP X-Golomt-Code) энд
// БАЙХГҮЙ — тэр түлхүүрийг Entry авахгүй (docs/dev/bank-api.md §2).
//
// DB-гүй: нууцыг дуудагч (lib/bank/golomt/connection.ts) тайлж өгнө.
// `fetchImpl` / `now`-ийг тест солино (tests/golomt-client.test.ts).

import {
  GOLOMT_API_BASE,
  GOLOMT_STATEMENT_MAX_ROWS,
  GOLOMT_STATEMENT_PAGE_SIZE,
  type GolomtAccountSummary,
  type GolomtEnvironment,
} from "./constants";
import { golomtChecksum, golomtDecrypt, golomtEncrypt } from "./crypto";
import type { GolomtStatementEntry } from "./statement";

export type GolomtCredentials = {
  environment: GolomtEnvironment;
  username: string;
  password: string;
  sessionKey: string;
  ivKey: string;
  /** Банкнаас өгсөн client id — хоосон бол банкны grant хариунаас авна. */
  clientId?: string | null;
  /** Данс эзэмшигч байгууллагын регистр. */
  registerNo: string;
};

export type GolomtGrant = { clientId: string; state: string; scope: string };
type Json = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 20_000;
/** Access token 300 сек — 60 секундын нөөцтэйгөөр сэргээнэ (SPEC §4.2). */
const TOKEN_REFRESH_AFTER_MS = 240_000;
const MAX_STATEMENT_PAGES = Math.ceil(
  GOLOMT_STATEMENT_MAX_ROWS / GOLOMT_STATEMENT_PAGE_SIZE
);

export class GolomtApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "GolomtApiError";
  }
}

/**
 * SPEC §4.3 — client_id/state/scope хоосон үед ирэх OAuth grant хариу:
 * `{clientId, responseType, redirectUri, state, scope}` эсвэл зарим
 * үйлчилгээнд `{url: "…?response_type=code&client_id=…&state=…&scope=…"}`.
 */
export function isGolomtGrantResponse(value: unknown): value is Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Json;
  return (
    typeof record.redirectUri === "string" ||
    (record.responseType === "code" && typeof record.state === "string") ||
    (typeof record.url === "string" && /[?&]response_type=code\b/.test(record.url))
  );
}

/** Grant хариунаас дараагийн хүсэлтийн client_id/state/scope. */
export function golomtGrantParams(record: Json): GolomtGrant {
  let fromUrl: URLSearchParams | null = null;
  if (typeof record.url === "string") {
    try {
      fromUrl = new URL(record.url).searchParams;
    } catch {
      fromUrl = null;
    }
  }
  const pick = (key: string, urlKey: string) => {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    return fromUrl?.get(urlKey)?.trim() ?? "";
  };
  return {
    clientId: pick("clientId", "client_id"),
    state: pick("state", "state"),
    scope: pick("scope", "scope"),
  };
}

/** Алдааны мессежид аль алхам унасныг хэрэглэгчид нэрлэнэ. */
const STEP_LABELS: Record<string, string> = {
  LGIN: "нэвтрэх",
  ACCTLST: "дансны жагсаалт",
  ACCTBALINQ: "дансны үлдэгдэл",
  OPERACCSTAINQ: "хуулга татах",
};

function stepLabel(service: string): string {
  return STEP_LABELS[service] ?? service;
}

/**
 * Банкны алдааг серверийн логт бичнэ — алхам, HTTP статус, банкны алдааны
 * код/текст л. Нууц (нууц үг, түлхүүр, токен) болон хариуны өгөгдөл ОРОХГҮЙ.
 */
function logBankFailure(service: string, status: number | null, message: string) {
  console.warn(
    `[golomt] ${service} (${stepLabel(service)}) амжилтгүй — HTTP ${status ?? "-"}: ${message.slice(0, 300)}`
  );
}

function stringField(record: Json, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Банкны алдааны хариунаас ойлгомжтой мессеж. Голомтын ерөнхий
 * «Please contact bank administrator…» мессежийг статусаар нь тайлбарлана.
 */
/**
 * Банкны мэдэгдэж буй алдааны кодыг ойлгомжтой монгол тайлбар болгоно.
 * Код нь `subErrors[].code` эсвэл `message`-д ирдэг (2026-10-01 UAT-д
 * зохиомол нэрээр нэвтэрч шалгав: бүртгэлгүй нэр → MERDET0001).
 */
const KNOWN_BANK_ERRORS: { match: RegExp; text: string }[] = [
  {
    match: /MERDET0001|merchant\.details\.not\.present/i,
    text: "Нэвтрэх нэр банкинд бүртгэлгүй — «Голомт API» тохиргооны нэвтрэх нэрийг банкнаас ирсэн баримтаас хуулж, сонгосон орчин (UAT / үндсэн) зөв эсэхийг шалгана уу",
  },
];

function bankErrorDetails(parsed: Json): { codes: string[]; fieldMessages: string[] } {
  const subErrors = Array.isArray(parsed.subErrors) ? parsed.subErrors : [];
  const codes: string[] = [];
  const fieldMessages: string[] = [];
  for (const item of subErrors) {
    if (!item || typeof item !== "object") continue;
    const record = item as Json;
    const code = stringField(record, "code", "type");
    if (code) codes.push(code);
    // Талбарын шалгалтын монгол мессеж (ж: «Нэвтрэх нууц үг оруулна уу») —
    // `{…}` загвар болон англи ерөнхий текстийг алгасна.
    const message = stringField(record, "message");
    if (message && /[А-Яа-яӨөҮүЁё]/.test(message)) fieldMessages.push(message);
  }
  return { codes, fieldMessages };
}

function describeFailure(service: string, status: number, body: string): string {
  let message = "";
  let details: { codes: string[]; fieldMessages: string[] } = { codes: [], fieldMessages: [] };
  try {
    const parsed = JSON.parse(body) as Json;
    message = stringField(parsed, "errDesc", "message", "error");
    details = bankErrorDetails(parsed);
  } catch {
    // шифрлэгдсэн эсвэл хоосон
  }
  const codeText = details.codes.join(", ");
  logBankFailure(
    service,
    status,
    [message || body.slice(0, 120), codeText].filter(Boolean).join(" · ")
  );
  const step = stepLabel(service);
  const known = KNOWN_BANK_ERRORS.find(
    (entry) => entry.match.test(message) || details.codes.some((code) => entry.match.test(code))
  );
  if (known)
    return `Голомт банк (${step}): ${known.text}${codeText ? ` [${codeText}]` : ""}`;
  if (details.fieldMessages.length)
    return `Голомт банк (${step}, HTTP ${status}): ${[...new Set(details.fieldMessages)].join("; ")}`;
  if (!message || /contact bank administrator/i.test(message) || message === "Bad Request") {
    if (status === 401 || status === 403)
      return `Голомт банк ${step} алхамд хандалтыг зөвшөөрсөнгүй (HTTP ${status}) — нэвтрэх нэр, нууц үг, түлхүүрээ шалгана уу`;
    return `Голомт банкны сервис ${step} алхамд алдаа буцаалаа (HTTP ${status}${codeText ? `, ${codeText}` : ""}) — дахин оролдох эсвэл банкны менежертэй холбогдоно уу`;
  }
  return `Голомт банк (${step}, HTTP ${status}): ${message}${codeText ? ` [${codeText}]` : ""}`;
}

export class GolomtClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private tokenIssuedAt = 0;
  private grant: GolomtGrant | null = null;
  private readonly base: string;

  constructor(
    private readonly credentials: GolomtCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    this.base = GOLOMT_API_BASE[credentials.environment];
    if (!this.base) throw new GolomtApiError("Голомтын орчин буруу");
  }

  private get keys() {
    return {
      sessionKey: this.credentials.sessionKey,
      ivKey: this.credentials.ivKey,
    };
  }

  private async send(
    path: string,
    init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }
  ): Promise<{ status: number; text: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new GolomtApiError(
        "Голомт банкны сервертэй холбогдож чадсангүй — сүлжээ эсвэл банкны сервис түр саатсан байж магадгүй"
      );
    }
    return { status: response.status, text: await response.text() };
  }

  /**
   * Хариуг JSON болгоно: шифргүй JSON (нэвтрэх, алдаа, /v1/utility) шууд,
   * бусад нь Base64 AES-CBC (SPEC §3).
   */
  private decode(text: string): Json {
    const trimmed = text.trim();
    if (!trimmed) throw new GolomtApiError("Голомт банкнаас хоосон хариу ирлээ");
    let plain = trimmed;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      try {
        plain = golomtDecrypt(trimmed, this.keys);
      } catch {
        throw new GolomtApiError(
          "Голомтын хариуг тайлж чадсангүй — session key / IV key зөв эсэхийг шалгана уу"
        );
      }
    }
    try {
      const parsed = JSON.parse(plain) as unknown;
      return (Array.isArray(parsed) ? { items: parsed } : parsed) as Json;
    } catch {
      throw new GolomtApiError("Голомтын хариу JSON биш байна");
    }
  }

  private acceptToken(payload: Json) {
    const token = stringField(payload, "token", "Token", "accessToken");
    if (!token) {
      const message = stringField(payload, "errDesc", "message");
      logBankFailure("LGIN", 200, message || "token ирээгүй");
      throw new GolomtApiError(
        message
          ? `Голомт банк (нэвтрэх): ${message}`
          : "Голомт банкинд нэвтэрч чадсангүй — нэвтрэх нэр, нууц үгээ шалгана уу"
      );
    }
    this.token = token;
    this.refreshToken =
      stringField(payload, "refreshToken", "RefreshToken") || null;
    this.tokenIssuedAt = this.now();
  }

  /** SPEC §4.1 — нууц үгийг checksum-гүйгээр AES-ээр шифрлэж илгээнэ. */
  async login(): Promise<void> {
    const body = JSON.stringify({
      name: this.credentials.username,
      password: golomtEncrypt(this.credentials.password, this.keys),
    });
    const { status, text } = await this.send("/v1/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Golomt-Service": "LGIN",
      },
      body,
    });
    if (status < 200 || status >= 300)
      throw new GolomtApiError(describeFailure("LGIN", status, text), status);
    this.acceptToken(this.decode(text));
  }

  /** SPEC §4.2 — GET, Bearer <refreshToken>. Амжилтгүй бол дахин нэвтэрнэ. */
  private async ensureToken(): Promise<string> {
    if (!this.token) {
      await this.login();
      return this.currentToken();
    }
    if (this.now() - this.tokenIssuedAt < TOKEN_REFRESH_AFTER_MS) return this.token;
    if (this.refreshToken) {
      const { status, text } = await this.send("/v1/auth/refresh", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.refreshToken}`,
          "X-Golomt-Service": "LGIN",
        },
      });
      if (status >= 200 && status < 300) {
        try {
          this.acceptToken(this.decode(text));
          return this.currentToken();
        } catch {
          // доор дахин нэвтэрнэ
        }
      }
    }
    await this.login();
    return this.currentToken();
  }

  private currentToken(): string {
    if (!this.token) throw new GolomtApiError("Голомт банкинд нэвтэрч чадсангүй");
    return this.token;
  }

  /**
   * SPEC §5 (алхам 2): эхний хүсэлтэд client_id, state, scope ГУРВУУЛАА хоосон —
   * банк grant буцаасны дараа түүний утгуудаар дахин илгээнэ (алхам 7).
   * Тохиргооны Client ID-г энд хэрэглэхгүй (2026-10-01 UAT: client_id-тай
   * эхний хүсэлт `merchant.details.not.present` буцаасан).
   */
  private query(): string {
    const grant = this.grant ?? { clientId: "", state: "", scope: "" };
    const params = new URLSearchParams({
      client_id: grant.clientId,
      state: grant.state,
      scope: grant.scope,
    });
    return `?${params.toString()}`;
  }

  /**
   * Checksum-тэй бизнес хүсэлт. Банк OAuth grant (SPEC §4.3) буцаавал түүний
   * client_id/state/scope-оор НЭГ удаа дахин илгээнэ; дахиад grant ирвэл
   * харилцагчийн зөвшөөрөл дутуу гэж ил алдаа.
   */
  async call(service: string, path: string, payload: Json): Promise<Json> {
    const body = JSON.stringify(payload);
    const checksum = golomtChecksum(body, this.keys);
    let consentUrl = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ensureToken();
      const { status, text } = await this.send(`${path}${this.query()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "X-Golomt-Service": service,
          "X-Golomt-Checksum": checksum,
          Authorization: `Bearer ${token}`,
        },
        body,
      });
      if (status < 200 || status >= 300)
        throw new GolomtApiError(describeFailure(service, status, text), status);
      const decoded = this.decode(text);
      // 200 хариутай ч банкны бизнес алдаа (status FAILED / errDesc) — чимээгүй
      // хоосон үр дүн болгохгүй.
      const bankError = stringField(decoded, "errDesc", "errorDesc");
      if (bankError || decoded.status === "FAILED") {
        const message = bankError || stringField(decoded, "message") || "FAILED";
        logBankFailure(service, status, message);
        throw new GolomtApiError(`Голомт банк (${stepLabel(service)}): ${message}`, status);
      }
      if (!isGolomtGrantResponse(decoded)) return decoded;
      consentUrl = typeof decoded.url === "string" ? decoded.url : consentUrl;
      if (attempt === 0) {
        this.grant = golomtGrantParams(decoded);
        continue;
      }
    }
    logBankFailure(service, null, "OAuth grant давтагдсан — харилцагчийн зөвшөөрөл дутуу");
    throw new GolomtApiError(
      `Голомт банк ${stepLabel(service)} (${service}) үйлчилгээнд харилцагчийн зөвшөөрөл (OAuth) шаардаж байна — ${consentUrl ? `зөвшөөрлийн холбоос: ${consentUrl}` : "банкны менежерээр энэ үйлчилгээг байгууллагын эрхэд нээлгэнэ үү"}`
    );
  }

  /** SPEC §5.11 — харилцах данснууд. */
  async listAccounts(): Promise<GolomtAccountSummary[]> {
    const result = await this.call("ACCTLST", "/v1/account/list", {
      registerNo: this.credentials.registerNo,
    });
    const accounts = Array.isArray(result.operAccounts) ? result.operAccounts : [];
    return accounts
      .filter((item): item is Json => !!item && typeof item === "object")
      .map((item) => ({
        accountId: stringField(item, "accountId"),
        accountName: stringField(item, "accountName", "shortName"),
        currency: stringField(item, "currency").toUpperCase(),
      }))
      .filter((item) => item.accountId);
  }

  /** SPEC §5.6 — хуудас бүрийг дуусталаа (дээд хязгаартай) татна. */
  async fetchStatement(
    accountId: string,
    startDate: string,
    endDate: string
  ): Promise<GolomtStatementEntry[]> {
    const entries: GolomtStatementEntry[] = [];
    for (let page = 1; page <= MAX_STATEMENT_PAGES; page++) {
      const result = await this.call(
        "OPERACCSTAINQ",
        "/v1/account/operative/statement/inquiry",
        {
          accountId,
          registerNo: this.credentials.registerNo,
          startDate,
          endDate,
          page,
          size: GOLOMT_STATEMENT_PAGE_SIZE,
        }
      );
      const statements = Array.isArray(result.statements) ? result.statements : [];
      entries.push(...(statements as GolomtStatementEntry[]));
      const totalPages = Number(result.totalPages);
      if (
        statements.length === 0 ||
        !Number.isFinite(totalPages) ||
        page >= totalPages
      )
        return entries;
    }
    throw new GolomtApiError(
      `Хуулга ${GOLOMT_STATEMENT_MAX_ROWS.toLocaleString("en-US")} мөрөөс их байна — хугацааг богиносгоно уу`
    );
  }
}
