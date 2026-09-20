import { ModuleGuard } from "@/components/layout/access-guard";

// АР/АП-ийн хамтарсан хуудсууд — аль нэг модульд унших эрхтэй бол нээгдэнэ.
export default function ArApLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys={["ar", "ap"]}>{children}</ModuleGuard>;
}
