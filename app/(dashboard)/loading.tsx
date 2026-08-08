import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRows } from "@/components/ui/loading";

// Dashboard-ийн БҮХ route-д хуудас шилжих агшинд шууд харагдах skeleton —
// Next.js App Router-ийн loading boundary. Үүнгүйгээр navigation-ий үеэр
// хуучин хуудас "хөшсөн" мэт үлдэж, уншиж байгаа мэдрэмж муу байсан.
// Server Component-ийн өгөгдөл бэлэн болмогц жинхэнэ хуудсаар солигдоно.

export default function DashboardLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true">
      {/* Гарчгийн хэсэг */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-80" />
      </div>
      {/* Toolbar/таб */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-36" />
      </div>
      {/* Агуулгын хүснэгт */}
      <div
        className="flex-1 rounded-md border"
        style={{ borderColor: "var(--ea-border)" }}
      >
        <LoadingRows count={8} />
      </div>
    </div>
  );
}
