// ENT-074: монгол UI дотор англи товч/шошго («Costing run», «Subledger»)
// үлдэхээс сэргийлнэ. JSX ТЕКСТ зангилааг (JsxText) TypeScript AST-ээр уншиж,
// латин үг бүрийг зөвшөөрөгдсөн жагсаалттай (товчлол, брэнд, техникийн нэр)
// тулгана. Шинэ зөвшөөрөгдөх нэр томьёо бол ALLOW-д нэмнэ.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ALLOW = new Set(
  [
    // Нягтлан бодох / татварын товчлол
    "GL", "AP", "AR", "VAT", "POS", "PO", "COGS", "NBV", "NRV", "IFRS", "IAS", "FX", "PWA", "IBAN", "TIN",
    "PTD", "QTD", "YTD", "MNT", "USD", "EUR", "CNY", "RUB", "JPY", "KRW", "GBP",
    // Брэнд / бүтээгдэхүүн
    "Entry", "Accounting", "QPay", "eBarimt", "PosAPI", "Excel", "Claude", "Cowork", "Code", "Anthropic",
    "OpenAI", "GPT", "Haiku", "Sonnet", "Opus", "Fable", "Telegram", "Resend", "Railway", "Console",
    "GitHub", "Google", "Veritech", "Mongolbank",
    // Техникийн нэр
    "AI", "API", "MCP", "REST", "OAuth", "URL", "UI", "Kit", "CSV", "XLSX", "PDF", "PNG", "JPG", "SVG",
    "QR", "HTTP", "HTTPS", "JSON", "ID", "PIN", "SMS", "OK", "MB", "KB", "ISO", "WCAG", "Bearer",
    "Token", "token", "Webhook", "webhook", "Bot", "bot", "Server", "Authentication", "GET", "POST",
    "Ctrl", "Cmd", "Shift", "Enter", "Esc", "Tab", "Delete", "From", "Keys", "keys", "terminal",
    "BNPL", "SaaS", "IP", "Plus", "Pro", "Max", "localhost", "reply", "cut", "off",
    // Гадны бүтээгдэхүүний цэс/тохиргооны нэр (интеграцийн заавар)
    "ChatGPT", "Codex", "Connectors", "Developer", "mode", "Authorization", "header", "SocialPay", "MonPay",
    "Merchants", "key", "secret", "service", "kind", "fork", "Actions", "Upstream", "sync", "verify",
    // Стандартын албан нэр (PWA) — монгол тайлбартайгаа хамт
    "Periodic", "Weighted", "Average", "name", "eak",
  ].map((word) => word.toLowerCase())
);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

function latinViolations(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      // HTML entity (&quot;) ба бүхэлдээ ТОМ үсэгтэй код (CASH, NEXT_PUBLIC_APP_URL) үг биш.
      const text = node.text
        .replace(/&[a-z]+;/g, " ")
        // Техникийн нийлмэл нэр (qpay-dashboard, reply-to) — бүтээгдэхүүн/тохиргооны нэр.
        .replace(/[A-Za-z]+(?:-[A-Za-z]+)+/g, " ")
        .replace(/\b[A-Z][A-Z0-9_]{1,}\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // Домэйн/хаяг/зам (anthropic.com, /api/v1) — техникийн лавлагаа.
      const words = (text.replace(/\S*[./@]\S*/g, " ").match(/[A-Za-z][A-Za-z]{2,}/g) ?? []).filter(
        (word) => !ALLOW.has(word.toLowerCase())
      );
      if (words.length > 0) found.push(`${file}: «${text.slice(0, 60)}» → ${words.join(", ")}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("ENT-074: JSX текстэд англи үг үлдээгүй (зөвшөөрөгдсөн товчлолоос бусад)", () => {
  const files = [...walk("components"), ...walk("app")].filter((file) => !file.includes("ui-kit"));
  const violations = files.flatMap(latinViolations);
  assert.deepEqual(violations, []);
});
