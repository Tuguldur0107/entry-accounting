// Мэдэгдлийн и-мэйлийн ЦЭВЭР загвар (тесттэй) — Resend клиентээс хараат бус.
// Дүрэм (docs/notifications §4.4): ГАРЧИГТ ДҮН БИЧИХГҮЙ (и-мэйл нь нууцлалгүй
// суваг) — гарчиг нь зөвхөн мэдэгдлийн нэр/тоо; дэлгэрэнгүй нь body-д, линк
// нь нэвтрэлт шаардсан програмын зам. Текст + энгийн HTML хоёулаа.

export interface NotificationEmailItem {
  title: string;
  body: string;
  severity: "info" | "warning" | "danger";
  /** Програмын дотоод зам (/notifications, /tax/vat?period=…) — appUrl-тай нийлнэ. */
  href: string | null;
  /** ISO. */
  createdAt: string;
}

export interface NotificationEmailInput {
  to: string;
  from: string;
  replyTo?: string;
  orgName: string;
  /** Суурь URL, төгсгөлд налуу зураасгүй. */
  appUrl: string;
  items: NotificationEmailItem[];
  kind: "instant" | "digest";
  /** Нэгтгэлийн өдөр (YYYY-MM-DD) — kind=digest үед гарчигт. */
  date?: string;
}

const SEVERITY_MARK: Record<NotificationEmailItem["severity"], string> = {
  info: "•",
  warning: "⚠",
  danger: "‼",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Гарчигт мөнгөн дүн орохоос сэргийлнэ (₮, тоо+таслал) — хамгаалалтын давхарга. */
export function stripAmounts(text: string): string {
  return text.replace(/\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?\s*₮?|\d+\s*₮/g, "…").trim();
}

export function notificationEmailSubject(input: Pick<NotificationEmailInput, "orgName" | "items" | "kind" | "date">): string {
  if (input.kind === "digest")
    return `[Entry] Өдрийн нэгтгэл ${input.date ?? ""} — ${input.orgName} (${input.items.length})`.replace("  ", " ");
  if (input.items.length === 1)
    return `[Entry] ${stripAmounts(input.items[0].title)} — ${input.orgName}`;
  return `[Entry] ${input.items.length} мэдэгдэл — ${input.orgName}`;
}

export function buildNotificationEmailPayload(input: NotificationEmailInput) {
  const link = (item: NotificationEmailItem) =>
    `${input.appUrl}${item.href && item.href.startsWith("/") ? item.href : "/notifications"}`;

  const textLines: string[] = [
    input.kind === "digest"
      ? `${input.orgName} — ${input.date ?? ""} өдрийн мэдэгдлийн нэгтгэл:`
      : `${input.orgName} — шинэ мэдэгдэл:`,
    "",
  ];
  for (const item of input.items) {
    textLines.push(`${SEVERITY_MARK[item.severity]} ${item.title}`);
    if (item.body) textLines.push(`   ${item.body}`);
    textLines.push(`   ${link(item)}`);
    textLines.push("");
  }
  textLines.push(`Бүх мэдэгдэл: ${input.appUrl}/notifications`);
  textLines.push(`Тохиргоо: ${input.appUrl}/settings/notifications`);

  const htmlItems = input.items
    .map(
      (item) =>
        `<li style="margin:0 0 12px 0">` +
        `<strong>${escapeHtml(SEVERITY_MARK[item.severity])} ${escapeHtml(item.title)}</strong>` +
        (item.body ? `<br/><span style="color:#555">${escapeHtml(item.body)}</span>` : "") +
        `<br/><a href="${escapeHtml(link(item))}">Нээх</a></li>`
    )
    .join("");
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:600px">` +
    `<p>${escapeHtml(textLines[0])}</p>` +
    `<ul style="padding-left:18px">${htmlItems}</ul>` +
    `<p style="font-size:12px;color:#777">` +
    `<a href="${escapeHtml(input.appUrl)}/notifications">Бүх мэдэгдэл</a> · ` +
    `<a href="${escapeHtml(input.appUrl)}/settings/notifications">Тохиргоо</a></p></div>`;

  return {
    from: input.from,
    to: input.to,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    subject: notificationEmailSubject(input),
    text: textLines.join("\n"),
    html,
  };
}
