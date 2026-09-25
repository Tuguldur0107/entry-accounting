"use client";

// «AI нягтлан» — ChatGPT / Claude-д холбох 3 алхам (таб).
import { useState } from "react";

import { PageTabs } from "@/components/ui/tabs";

type Client = "claude" | "chatgpt";

const STEPS: Record<Client, string[]> = {
  claude: [
    "claude.ai → Settings → Connectors → Add custom connector",
    "Нэр: Entry, хаяг: дээрх хаяг → Add",
    "Connect дарж Entry-ийн и-мэйл, нууц үгээрээ нэвтэрч зөвшөөрнө",
  ],
  chatgpt: [
    "ChatGPT → Settings → Apps & Connectors → Advanced → Developer mode асаана",
    "Create → нэр: Entry, хаяг: дээрх хаяг, нэвтрэлт: OAuth",
    "Entry-ийн и-мэйл, нууц үгээрээ нэвтэрч зөвшөөрнө",
  ],
};

export function ConnectGuide() {
  const [client, setClient] = useState<Client>("claude");
  return (
    <div className="space-y-3">
      <PageTabs<Client>
        tabs={[
          { value: "claude", label: "Claude" },
          { value: "chatgpt", label: "ChatGPT" },
        ]}
        value={client}
        onChange={setClient}
      />
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[var(--ea-text-2)]">
        {STEPS[client].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
