// Next.js instrumentation — сервер асахад НЭГ удаа ажиллана (nodejs runtime).
// Beacon-ийг эндээс эхлүүлнэ: deployment "би энд ажиллаж байна" гэж Entry
// Console руу дохио өгнө (зөвшөөрөлгүй хуулбарыг илрүүлэх, lib/licensing/beacon.ts).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBeacon } = await import("@/lib/licensing/beacon");
  startBeacon();
  // Хуваарьт мэдэгдлийн default ticker (docs/notifications §4.2, D7) —
  // байгууллага × өдөрт нэг удаа; NOTIFICATIONS_TICKER=off бол унтарна.
  const { startNotificationTicker } = await import("@/lib/notifications/ticker");
  startNotificationTicker();
  // eBarimt worker (server горим): 20 сек тутам PosAPI руу илгээнэ; EBARIMT_WORKER=off бол унтарна.
  const { startEbarimtWorker } = await import("@/lib/ebarimt/ticker");
  startEbarimtWorker();
}
