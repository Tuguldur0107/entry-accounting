import { CashTabs } from "@/components/cash/cash-tabs";

export default function CashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <CashTabs />
      {children}
    </div>
  );
}
