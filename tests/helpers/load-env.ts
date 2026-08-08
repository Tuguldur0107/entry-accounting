// Integration тестүүдэд: lib/db-ээс ӨМНӨ .env.local-ийг ачаална.
// (CJS горимд import-ууд дарааллаараа ажилладаг тул энэ модулийг
// хамгийн ЭХЭНД import хийнэ.)
import { config } from "dotenv";

config({ path: ".env.local" });
