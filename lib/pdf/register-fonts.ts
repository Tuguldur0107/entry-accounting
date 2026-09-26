// PDF-ийн фонт — кирилл NotoSans (LGC)-ийг файлаас embed хийнэ. Import хийх
// мөчид НЭГ удаа бүртгэгдэнэ; PDF renderer бүр үүнийг л import хийнэ.

import path from "node:path";

import { Font } from "@react-pdf/renderer";

const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");

export const PDF_FONT_FAMILY = "NotoSans";

Font.register({
  family: PDF_FONT_FAMILY,
  fonts: [
    { src: path.join(FONT_DIR, "NotoSans-Regular.ttf"), fontWeight: "normal" },
    { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});
