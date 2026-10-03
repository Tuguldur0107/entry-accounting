// Ontology registry-ийн төрөл — ЦЭВЭР, DB импортгүй (client-safe).
// docs/ontology-audit.md §6.2, docs/dev/ontology.md.
//
// P2 (ажиглах): registry нь ОДОО БАЙГАА зан төлвийг баримтжуулна — шинэ дүрэм
// зохиохгүй. Server action-ууд хараахан эндээс уншдаггүй; зөрүүг drift тест
// (`tests/ontology-registry.test.ts`) барина.

/** Модулийн түлхүүр = lib/constants/app-modules.ts-ийн `key` (requireModuleAction-д). */
export type ModuleKey = "gl" | "cash" | "ar" | "ap" | "inv" | "cost" | "proc" | "pos" | "fa" | "tax" | "payroll";

export type Layer = "core" | "extension";

/** Төлөвийн дэвтэрт үзүүлэх нөлөө — «энэ төлөвт GL журнал байна уу». */
export type LedgerEffect = "none" | "posted" | "reversed";

export interface StateDef {
  /** UI шошго — lib/status.ts (эсвэл модулийн шошгын толь)-той ИЖИЛ (drift тест). */
  label: string;
  ledger: LedgerEffect;
  /** Эндээс гарах шилжилт байхгүй. */
  terminal?: boolean;
  /** Агуулга засагдах төлөв (ихэвчлэн зөвхөн ноорог). */
  editable?: boolean;
}

/** Guard-ын түлхүүр — хэрэгжүүлэлт одоо модулийн action-д (P3-д engine-д). */
export type GuardKey =
  | "period_open" // assertPeriodOpen + assertPeriodOpenInTx
  | "not_future_period" // ирээдүйн сарын огноо батлагдахгүй
  | "journal_balanced" // assertBalanced
  | "control_account" // checkControlAccountGuard (lib/gl/control-account-guard.ts)
  | "not_source_locked" // POS_SOURCED / дэд дэвтрийн журнал / цалингийн журнал
  | "no_open_settlements" // төлөлт, кредит нэхэмжлэл, суутгалгүй байх
  | "ebarimt_not_sent" // ТЕГ-д бүртгэгдсэн баримт устгагдахгүй
  | "ai_post_mode" // AI: зөвхөн «Шууд бичих» горимд (assertPostMode)
  | "ai_post_limit" // AI: байгууллагын батлах хязгаар (assertPostLimit)
  | `custom:${string}`; // fork-ийн guard — зөвхөн ХАТУУРУУЛНА (§6.7)

export type EffectKey =
  | "journal" // GL журнал үүсгэнэ / буцаана / устгана
  | "voucher_no" // шинэ журнал nextVoucherNo-оор (tests/voucher-numbers-coverage)
  | "hook:beforeJournalPost"; // fork hook — батлагдсан журнал бүрд DB trigger-ээр (M4)

export interface TransitionDef<S extends string = string> {
  /** "create" | "post" | "reverse" | "update" | "delete" | "close" … */
  action: string;
  /** Хоосон = шинэ объект үүсгэх. */
  from: readonly S[];
  /** null = мөр устгагдана. */
  to: S | null;
  permission: { module: ModuleKey | "ar|ap"; level: "write" | "post" };
  guards: readonly GuardKey[];
  effects?: readonly EffectKey[];
  /** AI-д харагдах MCP tool (байхгүй бол зөвхөн вэб / систем). */
  tool?: { name: string; aliases?: readonly string[] };
  /** Хэн эхлүүлэх — «system» = webhook / хуваарьт ажил / өөр баримтын үр дүн. */
  actor?: "user" | "system";
  /** AI-д зориулсан нэг өгүүлбэр. */
  note?: string;
}

export interface RelationDef {
  name: string;
  /** SQL хүснэгт (drift тест FK-г schema-тай тулгана). */
  targetTable: string;
  /**
   * SQL багана: cardinality "one" — ЭНЭ хүснэгтийнх (→ targetTable);
   * "many" — targetTable-ийнх (→ энэ хүснэгт).
   */
  column: string;
  /** fk = DB foreign key; soft = FK-гүй uuid; polymorphic = төрлийн баганатай. */
  kind: "fk" | "soft" | "polymorphic";
  cardinality: "one" | "many";
}

export interface ObjectDef<S extends string = string> {
  /** "journal_voucher" */
  key: string;
  label: string;
  layer: Layer;
  /** Модуль; «ar|ap» = баримтын төрлөөр (lib/arap/document-kind.ts). */
  module: ModuleKey | "ar|ap";
  /** SQL хүснэгт — schema-тай drift тестээр тулгана. */
  table: string;
  statusColumn: string;
  states: Record<S, StateDef>;
  /** Үүсэх үеийн төлөв. */
  initial: readonly S[];
  transitions: readonly TransitionDef<S>[];
  relations: readonly RelationDef[];
  idempotency?: { column: "external_ref"; prefixes?: readonly string[] };
  /** docs/ontology-audit.md §7.2-ын шалгалтын ID. */
  invariants?: readonly string[];
  /** Объектын түвшний AI тэмдэглэл (1–3 өгүүлбэр). */
  note?: string;
}
