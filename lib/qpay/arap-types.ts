// Нэхэмжлэхийн QPay-ийн нээлттэй хуудасны төрөл — DB-гүй (client component-д).
import type { QpayIntentStatus } from "./constants";

export interface InvoiceQpayView {
  intentId: string;
  status: QpayIntentStatus;
  amount: number;
  qrText: string | null;
  qrImage: string | null;
  urls: { name: string; logo: string; link: string }[];
  expiresAt: string;
  paid: boolean;
}
