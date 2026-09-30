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

type Grant = { clientId: string; state: string; scope: string };
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

/** SPEC §4.3 — client_id/state/scope хоосон үед ирэх OAuth grant хариу. */
export function isGolomtGrantResponse(value: unknown): value is Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Json;
  return (
    typeof record.redirectUri === "string" ||
    (record.responseType === "code" && typeof record.state === "string")
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
function describeFailure(status: number, body: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(body) as Json;
    message = stringField(parsed, "errDesc", "message", "error");
  } catch {
    // шифрлэгдсэн эсвэл хоосон
  }
  if (!message || /contact bank administrator/i.test(message)) {
    if (status === 401 || status === 403)
      return `Голомт банк хандалтыг зөвшөөрсөнгүй (HTTP ${status}) — нэвтрэх нэр, нууц үг, түлхүүрээ шалгана уу`;
    return `Голомт банкны сервис алдаа буцаалаа (HTTP ${status}) — дахин оролдох эсвэл банкны менежертэй холбогдоно уу`;
  }
  return `Голомт банк: ${message}`;
}

export class GolomtClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private tokenIssuedAt = 0;
  private grant: Grant | null = null;
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
    if (!token)
      throw new GolomtApiError(
        stringField(payload, "errDesc", "message")
          ? `Голомт банк: ${stringField(payload, "errDesc", "message")}`
          : "Голомт банкинд нэвтэрч чадсангүй — нэвтрэх нэр, нууц үгээ шалгана уу"
      );
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
      throw new GolomtApiError(describeFailure(status, text), status);
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

  private query(): string {
    const grant = this.grant ?? {
      clientId: this.credentials.clientId ?? "",
      state: "",
      scope: "",
    };
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
        throw new GolomtApiError(describeFailure(status, text), status);
      const decoded = this.decode(text);
      if (!isGolomtGrantResponse(decoded)) return decoded;
      if (attempt === 0) {
        this.grant = {
          clientId: stringField(decoded, "clientId") || (this.credentials.clientId ?? ""),
          state: stringField(decoded, "state"),
          scope: stringField(decoded, "scope"),
        };
        continue;
      }
    }
    throw new GolomtApiError(
      `Голомт банк ${service} үйлчилгээнд нэмэлт зөвшөөрөл (OAuth) шаардаж байна — банкны менежерээр энэ үйлчилгээг байгууллагын эрхэд нээлгэнэ үү`
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
