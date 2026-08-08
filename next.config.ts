import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Barrel файлтай том сангуудын import-ыг задалж dev compile болон
    // bundle-ийг хөнгөлнө (хуудас шилжихэд "rendering" удаан байсан асуудал).
    optimizePackageImports: ["ag-grid-community", "ag-grid-react", "exceljs"],
  },
};

export default nextConfig;
