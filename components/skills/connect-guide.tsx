"use client";

// «AI нягтлан» — ChatGPT / Claude-д холбох 3 алхам (таб).
// `mcpUrl` өгвөл «Хаягийг хуулаад … нээх» товч: хаягийг clipboard-д хуулж
// тэдний connector-ийн тохиргоог шинэ табд нээнэ (автоматаар нэмдэг deep link
// байхгүй — lib/ai/connector-clients.ts). `connections` өгвөл холбогдсон эсэх ил.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageTabs } from "@/components/ui/tabs";
import {
  CONNECTOR_TARGETS,
  relativeTimeMn,
  type AiConnectionView,
  type ConnectorClient,
} from "@/lib/ai/connector-clients";
import { useCopyFlash } from "@/lib/hooks/use-copy-flash";

const STEPS: Record<ConnectorClient, string[]> = {
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

export function ConnectGuide({
  mcpUrl,
  connections,
}: {
  /** Өгвөл «Хаягийг хуулаад … нээх» товч гарна. */
  mcpUrl?: string;
  /** Энэ хэрэглэгч × байгууллагын OAuth холболт (lib/ai/connector-status.ts). */
  connections?: AiConnectionView[];
} = {}) {
  const [client, setClient] = useState<ConnectorClient>("claude");
  const { copiedKey, copy } = useCopyFlash();
  const target = CONNECTOR_TARGETS[client];
  const connection = connections?.find((entry) => entry.client === client) ?? null;
  const opened = copiedKey === `open:${client}`;

  function openSettings() {
    if (!mcpUrl) return;
    // Popup blocker-оос сэргийлж табыг даралтын мөчид НЭЭНЭ, хуулалт араас.
    window.open(target.settingsUrl, "_blank", "noopener,noreferrer");
    void copy(mcpUrl, `open:${client}`);
  }

  return (
    <div className="space-y-3">
      <PageTabs<ConnectorClient>
        tabs={(["claude", "chatgpt"] as const).map((value) => ({
          value,
          label: connections?.some((entry) => entry.client === value)
            ? `${CONNECTOR_TARGETS[value].label} ✓`
            : CONNECTOR_TARGETS[value].label,
        }))}
        value={client}
        onChange={setClient}
      />
      {connection ? (
        <p className="flex items-center gap-1.5 text-xs text-[var(--ea-success-fg)]">
          <Icon name="success" size="xs" />
          {connection.label} холбогдсон
          {connection.lastUsedAt
            ? ` · сүүлд ашигласан ${relativeTimeMn(connection.lastUsedAt, new Date())}`
            : " · хараахан асуугаагүй байна"}
        </p>
      ) : null}
      <p className="flex items-start gap-1.5 text-xs text-[var(--ea-warning-fg)]">
        <Icon name="warning" size="xs" className="mt-0.5 shrink-0" />
        {target.requirement}
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[var(--ea-text-2)]">
        {STEPS[client].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {mcpUrl ? (
        <div className="space-y-1">
          <Button type="button" variant={connection ? "outline" : "default"} size="sm" onClick={openSettings}>
            <Icon name={opened ? "approve" : "openExternal"} size="xs" />
            {opened ? "Хаяг хуулагдлаа — тэнд буулгана уу" : `Хаягийг хуулаад ${target.label}-ийн тохиргоог нээх`}
          </Button>
          <p className="text-[11px] text-[var(--ea-text-4)]">
            Шинэ табд {target.label}-ийн холболтын тохиргоо нээгдэнэ — хаягийг буулгаад (Ctrl/Cmd+V) холбоно.
          </p>
        </div>
      ) : null}
    </div>
  );
}
