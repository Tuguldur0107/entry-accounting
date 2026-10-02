// Голомт OBI — ACCCHK (данс эзэмшигч шалгах) банк хоорондын шалгалтын ГАР
// туршилт. Entry-ээс ТУСДАА: DB, env, Entry-ийн тохиргоо уншихгүй, юу ч
// хадгалахгүй, ЗӨВХӨН унших сервис (LGIN + ACCCHK) дуудна — мөнгө хөдлөхгүй.
//
//   npx tsx scripts/golomt-accchk-probe.ts
//
// Нууцыг (нууц үг, session key, IV key) терминалд НУУЦЛАГДСАН оролтоор асууна —
// аргумент, env, файлаар өгөхгүй (shell history-д үлдэхгүй). Гаралтад нууц,
// токен ОРОХГҮЙ; банкны хариу (далдлагдсан нэр, vrfctn, rsn) л хэвлэгдэнэ.
// Үр дүнг docs/dev/bank-api.md §3 «ACCCHK»-д тэмдэглэнэ (дансны дугааргүй).

import { createInterface } from "node:readline";
import { GolomtApiError, GolomtClient } from "../lib/bank/golomt/client";
import { isGolomtEnvironment } from "../lib/bank/golomt/constants";

type Json = Record<string, unknown>;

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Бичсэн тэмдэгтийг дэлгэцэнд гаргахгүй (асуултыг л хэвлэнэ).
    const internal = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
    internal._writeToOutput = (text: string) => {
      if (text.startsWith(question)) internal.output.write(question);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    })
  );
}

/** Банкны кодын хувилбарууд: оруулсанаар, 6 оронтой (040000), 2 оронтой (04). */
function bankCodeVariants(input: string): string[] {
  const digits = input.replace(/\D/g, "");
  if (!digits) return [];
  const two = digits.length >= 2 ? digits.slice(0, 2) : digits.padStart(2, "0");
  const six = digits.length === 6 ? digits : `${two}0000`;
  return [...new Set([input.trim(), six, two])];
}

/** Хариуны зөвхөн шалгалтад хэрэгтэй талбарууд (бусад түлхүүрийн НЭРС л). */
function summarize(result: Json): string {
  const pick = ["vrfctn", "rsn", "grpSts", "maskedAccountName", "markedAccountName", "status", "currency"];
  const shown = Object.fromEntries(pick.filter((key) => key in result).map((key) => [key, result[key]]));
  const others = Object.keys(result).filter((key) => !pick.includes(key));
  return `${JSON.stringify(shown)}${others.length ? `  (бусад талбар: ${others.join(", ")})` : ""}`;
}

async function main() {
  console.log("Голомт ACCCHK туршилт — зөвхөн унших. Нууц дэлгэцэнд харагдахгүй.\n");
  const environment = (await ask("Орчин [uat/production] (uat): ")) || "uat";
  if (!isGolomtEnvironment(environment)) throw new Error("Орчин uat эсвэл production");
  const username = await ask("Нэвтрэх нэр: ");
  const password = await ask("Нууц үг: ", true);
  const sessionKey = await ask("Session key: ", true);
  const ivKey = await ask("IV key: ", true);
  const registerNo = await ask("Байгууллагын регистр: ");

  const client = new GolomtClient({ environment, username, password, sessionKey, ivKey, registerNo });
  await client.login();
  console.log("✓ Нэвтэрлээ\n");

  for (;;) {
    const accountId = await ask("Шалгах данс эсвэл IBAN (хоосон = дуусгах): ");
    if (!accountId) break;
    const bankInput = await ask("Банкны код (хоосон = Голомтын данс, ж: 040000 / 05): ");
    const variants = bankInput ? bankCodeVariants(bankInput) : [""];
    for (const bankCode of variants) {
      const payload: Json = bankCode ? { accountId, bankCode } : { accountId };
      const label = bankCode ? `bankCode=${bankCode}` : "bankCode-гүй";
      try {
        const result = await client.call("ACCCHK", "/v1/account/check/account", payload);
        console.log(`  ${label}: ${summarize(result)}`);
      } catch (caught) {
        const message = caught instanceof GolomtApiError ? caught.message : String(caught);
        console.log(`  ${label}: АЛДАА — ${message}`);
      }
    }
    console.log("");
  }
}

main().catch((caught) => {
  console.error(caught instanceof Error ? caught.message : caught);
  process.exit(1);
});
