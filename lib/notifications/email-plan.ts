// И-мэйл хүргэлтийн ЦЭВЭР төлөвлөгч (тесттэй): илгээгдээгүй мэдэгдлүүдийг
// хэрэглэгч бүрийн тохиргоогоор (instant / digest / off) ангилна.
//   instant — одоо илгээнэ (хэрэглэгч тус бүр нэг и-мэйлд нэгтгэнэ)
//   digest  — өдрийн нэгтгэлийн цаг болсон + өнөөдөр илгээгээгүй бол одоо;
//             үгүй бол хүлээнэ (hold)
//   off     — илгээхгүй (хүлээлгэнэ, хуучирвал query-ийн цонхноос гарна)
// Танигдахгүй төрөл (custom/, хуучин) → off (таамаглахгүй).

import { isNotificationType } from "./catalog";
import { emailModeFor, type ChannelPrefs } from "./preferences";

export interface PendingEmailRow {
  id: string;
  userId: string;
  type: string;
}

export interface EmailPlanInput {
  pending: PendingEmailRow[];
  /** userId → тохиргоо (мөргүй хэрэглэгч Map-д байхгүй → default). */
  prefsByUser: Map<string, { channels: ChannelPrefs; digestHour: number }>;
  /** Улаанбаатарын одоогийн цаг (0–23). */
  hourUb: number;
  /** Өнөөдөр digest аль хэдийн илгээсэн хэрэглэгчид. */
  digestSentToday: Set<string>;
}

export interface EmailPlan {
  instant: Map<string, string[]>;
  digest: Map<string, string[]>;
  /** Одоо илгээхгүй (digest цаг болоогүй / off). */
  held: string[];
}

export function planEmailDelivery(input: EmailPlanInput): EmailPlan {
  const plan: EmailPlan = { instant: new Map(), digest: new Map(), held: [] };
  const push = (bucket: Map<string, string[]>, userId: string, id: string) => {
    const list = bucket.get(userId);
    if (list) list.push(id);
    else bucket.set(userId, [id]);
  };

  for (const row of input.pending) {
    if (!isNotificationType(row.type)) {
      plan.held.push(row.id);
      continue;
    }
    const prefs = input.prefsByUser.get(row.userId);
    const mode = emailModeFor(prefs?.channels ?? {}, row.type);
    if (mode === "instant") {
      push(plan.instant, row.userId, row.id);
      continue;
    }
    if (mode === "digest") {
      const digestHour = prefs?.digestHour ?? 8;
      if (input.hourUb >= digestHour && !input.digestSentToday.has(row.userId))
        push(plan.digest, row.userId, row.id);
      else plan.held.push(row.id);
      continue;
    }
    plan.held.push(row.id);
  }
  return plan;
}
