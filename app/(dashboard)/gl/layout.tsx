import { GlTabs } from "@/components/gl/gl-tabs";

export default function GlLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <GlTabs />
      {children}
    </div>
  );
}
