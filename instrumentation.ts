// Next.js instrumentation — сервер асахад НЭГ удаа ажиллана (nodejs runtime).
// Beacon-ийг эндээс эхлүүлнэ: deployment "би энд ажиллаж байна" гэж Entry
// Console руу дохио өгнө (зөвшөөрөлгүй хуулбарыг илрүүлэх, lib/licensing/beacon.ts).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBeacon } = await import("@/lib/licensing/beacon");
  startBeacon();
}
