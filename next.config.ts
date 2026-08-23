import type { NextConfig } from "next";

// П2 хэмжилт (2026-08): cacheComponents: true туршихад route handler-уудын
// "export const runtime" (16 файл) хориглогдож, cookie-д суурилсан бүрэн
// динамик хуудсууд Suspense/"use cache" бүтцийн өөрчлөлт шаардсан. Апп бүхэлдээ
// хэрэглэгч-тусгай динамик тул ашиг багатай, эрсдэл өндөр — асаагаагүй.
// reactCompiler нь babel-plugin-react-compiler dependency шаарддаг — мөн хойшлуулав.
const nextConfig: NextConfig = {
  experimental: {
    // Barrel файлтай том сангуудын import-ыг задалж dev compile болон
    // bundle-ийг хөнгөлнө (хуудас шилжихэд "rendering" удаан байсан асуудал).
    optimizePackageImports: ["ag-grid-community", "ag-grid-react", "exceljs"],
  },
};

export default nextConfig;
