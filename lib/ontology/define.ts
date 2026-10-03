// defineObject — бүтцийн шалгалт + гүн freeze (core объектыг fork засахгүй, §6.7). ЦЭВЭР.

import type { ObjectDef } from "./types";

/** Объектын дотоод зөрчлүүд (хоосон = зөв). Тестэд ч ашиглана. */
export function objectProblems(object: ObjectDef): string[] {
  const states = new Set(Object.keys(object.states));
  const problems: string[] = [];
  const known = (state: string, where: string) => {
    if (!states.has(state)) problems.push(`${object.key}: ${where} — «${state}» төлөв бүртгэгдээгүй`);
  };
  if (object.initial.length === 0) problems.push(`${object.key}: initial хоосон`);
  for (const state of object.initial) known(state, "initial");
  const seen = new Set<string>();
  for (const transition of object.transitions) {
    const id = `${transition.action}:${transition.from.join("|")}`;
    if (seen.has(id)) problems.push(`${object.key}: «${id}» шилжилт давхардсан`);
    seen.add(id);
    for (const state of transition.from) {
      known(state, transition.action);
      if (object.states[state as keyof typeof object.states]?.terminal)
        problems.push(`${object.key}: эцсийн «${state}» төлөвөөс «${transition.action}» гарч болохгүй`);
    }
    if (transition.to !== null) known(transition.to, transition.action);
    if (transition.from.length === 0 && transition.to === null)
      problems.push(`${object.key}: «${transition.action}» — from хоосон атлаа to null`);
    if (transition.from.length === 0 && transition.to !== null && !object.initial.includes(transition.to))
      problems.push(`${object.key}: «${transition.action}» үүсгэлтийн төлөв «${transition.to}» initial-д алга`);
  }
  // Эцсийн бус төлөв бүрээс ядаж нэг шилжилт байх (эс бөгөөс terminal гэж тэмдэглэ).
  for (const [state, def] of Object.entries(object.states)) {
    if (def.terminal) continue;
    if (!object.transitions.some((transition) => transition.from.includes(state)))
      problems.push(`${object.key}: «${state}» төлөвөөс шилжилт алга — terminal гэж тэмдэглэнэ үү`);
  }
  return problems;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function defineObject<S extends string>(object: ObjectDef<S>): Readonly<ObjectDef<S>> {
  const problems = objectProblems(object as ObjectDef);
  if (problems.length > 0) throw new Error(`[ONTOLOGY] ${problems.join("; ")}`);
  return deepFreeze(object);
}
