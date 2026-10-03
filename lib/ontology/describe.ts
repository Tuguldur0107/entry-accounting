// describe_ontology tool-ын гаралт — ЦЭВЭР (docs/ontology-audit.md §6.6).
// AI-д «энэ объект ямар төлөвтэй, энэ төлөвөөс юу хийж болох, ямар tool-оор,
// ямар шалгалттай» гэдгийг нэг дуудлагаар хэлнэ. Сервер шалгалтыг ДАХИН хийдэг —
// энэ нь зөвхөн чиглүүлэг (ажиглах шат P2).

import { ONTOLOGY_OBJECTS, ontologyObject, transitionsFrom } from "./index";
import type { EffectKey, GuardKey, ObjectDef, TransitionDef } from "./types";

export const GUARD_LABELS: Record<Exclude<GuardKey, `custom:${string}`>, string> = {
  period_open: "тайлант үе нээлттэй",
  not_future_period: "ирээдүйн сар биш",
  journal_balanced: "Дт = Кт",
  control_account: "хяналтын дансны хориг",
  not_source_locked: "эх модулийн баримт биш (POS, дэд дэвтэр, цалин)",
  no_open_settlements: "төлөлт / кредит / суутгалгүй",
  ebarimt_not_sent: "eBarimt-д бүртгэгдээгүй",
  ai_post_mode: "AI: «Шууд бичих» горим",
  ai_post_limit: "AI: батлах хязгаар",
};

const EFFECT_LABELS: Record<EffectKey, string> = {
  journal: "GL журнал",
  voucher_no: "журналын дугаар",
  "hook:beforeJournalPost": "fork hook",
};

function guardLabel(guard: GuardKey): string {
  return guard.startsWith("custom:") ? `fork: ${guard.slice(7)}` : GUARD_LABELS[guard as keyof typeof GUARD_LABELS];
}

function stateLine(object: ObjectDef): string {
  return Object.entries(object.states)
    .map(([key, state]) => {
      const flags = [
        state.editable ? "засагдана" : null,
        state.ledger === "posted" ? "дэвтэрт" : null,
        state.terminal ? "эцсийн" : null,
      ].filter(Boolean);
      return `${key} (${[state.label, ...flags].join(", ")})`;
    })
    .join(" · ");
}

function transitionLine(transition: TransitionDef): string {
  const from = transition.from.length === 0 ? "шинэ" : transition.from.join("|");
  const to = transition.to ?? "устгагдана";
  const parts = [`• ${transition.action}: ${from} → ${to}`];
  if (transition.tool) {
    const aliases = transition.tool.aliases?.length ? ` (+ ${transition.tool.aliases.join(", ")})` : "";
    parts.push(`tool ${transition.tool.name}${aliases}`);
  } else parts.push(transition.actor === "system" ? "систем (webhook / хуваарь / өөр баримт)" : "вэбээс л");
  parts.push(`эрх ${transition.permission.module}:${transition.permission.level}`);
  if (transition.guards.length > 0) parts.push(`шалгалт: ${transition.guards.map(guardLabel).join(", ")}`);
  if (transition.effects?.length) parts.push(`үр дүн: ${transition.effects.map((effect) => EFFECT_LABELS[effect]).join(", ")}`);
  return parts.join(" · ") + (transition.note ? `\n    ${transition.note}` : "");
}

function relationLine(object: ObjectDef): string {
  return object.relations
    .map((relation) => `${relation.name}→${relation.targetTable}(${relation.cardinality === "one" ? "1" : "n"}${relation.kind === "fk" ? "" : `, ${relation.kind}`})`)
    .join(" · ");
}

export type DescribeOntologyInput = { object?: string; forState?: string; format?: "text" | "json" };

/** `{ text }` — амжилт; `{ error }` — «[CODE] текст» (tool executor «Алдаа:» угтвартай буцаана). */
export function describeOntology(input: DescribeOntologyInput = {}): { text: string } | { error: string } {
  const json = input.format === "json";
  const key = input.object?.trim();
  if (!key) {
    if (input.forState) return { error: "[OBJECT_REQUIRED] forState-ийг object-той хамт өгнө" };
    if (json)
      return {
        text: JSON.stringify(
          ONTOLOGY_OBJECTS.map((object) => ({ key: object.key, label: object.label, module: object.module, table: object.table, states: Object.keys(object.states) }))
        ),
      };
    return {
      text: [
        `ONTOLOGY — ${ONTOLOGY_OBJECTS.length} объект (одоогийн зан төлөв; сервер шалгалтаа ДАХИН хийнэ):`,
        ...ONTOLOGY_OBJECTS.map(
          (object) => `• ${object.key} — «${object.label}» · модуль ${object.module} · төлөв: ${Object.keys(object.states).join(", ")}`
        ),
        "Дэлгэрэнгүй: describe_ontology object=<key> (forState=<төлөв> — тэр төлөвөөс юу хийж болох).",
      ].join("\n"),
    };
  }

  const object = ontologyObject(key);
  if (!object)
    return { error: `[NOT_FOUND] «${key}» объект бүртгэгдээгүй. Байгаа: ${ONTOLOGY_OBJECTS.map((item) => item.key).join(", ")}` };
  const state = input.forState?.trim();
  if (state && !(state in object.states))
    return { error: `[INVALID_STATE] ${object.key}-д «${state}» төлөв алга. Байгаа: ${Object.keys(object.states).join(", ")}` };

  const allowed = state ? transitionsFrom(object, state) : object.transitions;
  if (json) return { text: JSON.stringify(state ? { ...object, forState: state, transitions: allowed } : object) };

  const lines = [
    `${object.key} — «${object.label}» · модуль ${object.module} · хүснэгт ${object.table}`,
    `Төлөв: ${stateLine(object)}`,
    `Үүсэх төлөв: ${object.initial.join(", ")}`,
  ];
  if (state) {
    lines.push(`«${state}» (${object.states[state as keyof typeof object.states].label}) төлөвөөс:`);
    if (allowed.length === 0) lines.push("  шилжилт алга — эцсийн төлөв");
    else lines.push(...allowed.map(transitionLine));
    const blocked = [...new Set(object.transitions.filter((transition) => transition.from.length > 0 && !allowed.includes(transition)).map((transition) => transition.action))].filter(
      (action) => !allowed.some((transition) => transition.action === action)
    );
    if (blocked.length > 0)
      lines.push(
        `Энэ төлөвт БОЛОМЖГҮЙ: ${blocked
          .map((action) => `${action} (зөвхөн ${[...new Set(object.transitions.filter((transition) => transition.action === action).flatMap((transition) => transition.from))].join("|")})`)
          .join(", ")}`
      );
  } else {
    lines.push("Шилжилт:", ...allowed.map(transitionLine));
  }
  if (object.relations.length > 0) lines.push(`Холбоо: ${relationLine(object)}`);
  if (object.idempotency)
    lines.push(
      `Idempotency: externalRef — ижил ref-ээр дахин дуудахад шинэ баримт үүсэхгүй${object.idempotency.prefixes?.length ? ` (системийн угтвар: ${object.idempotency.prefixes.join(", ")})` : ""}`
    );
  if (object.invariants?.length) lines.push(`Invariant (docs/ontology-audit.md §7.2): ${object.invariants.join(", ")}`);
  if (object.note) lines.push(object.note);
  return { text: lines.join("\n") };
}
