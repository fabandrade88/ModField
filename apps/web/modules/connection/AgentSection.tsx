"use client";
import { useEffect, useState } from "react";
import { Button, ErrorBox, Input, Notice, Section } from "@/components/controls";
import { useT } from "@/components/i18n";
import { useAgent } from "@/store/agent";

const isLoopback = () => typeof location !== "undefined" && ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);

/** Agent status, discovery and pairing. The code is shown by the agent, typed here. */
export function AgentSection() {
  const t = useT();
  const a = useAgent();
  const [code, setCode] = useState("");
  const [loopback, setLoopback] = useState(true);
  useEffect(() => setLoopback(isLoopback()), []);
  const v = a.endpoint?.hello.agentVersion ?? "";
  const fp = a.endpoint?.hello.fingerprint ?? "";

  return (
    <Section title={t("agent.title")}>
      {(a.status === "idle" || a.status === "absent") && (
        <div className="flex flex-col gap-2">
          <p>{a.status === "absent" ? t("agent.absent") : t("agent.idle")}</p>
          {!loopback && <Notice>{t("agent.lna")}</Notice>}
          <div>
            <Button onClick={() => void a.discover()}>{t("agent.search")}</Button>
          </div>
          {a.status === "absent" && <p className="text-[12px] text-muted">{t("agent.install")}</p>}
        </div>
      )}
      {a.status === "searching" && <p className="text-muted">{t("agent.searching")}</p>}
      {a.status === "found" && (
        <div className="flex flex-wrap items-center gap-3">
          <span>{t("agent.found", { v, fp })}</span>
          <Button variant="primary" onClick={() => void a.beginPairing()}>
            {t("agent.pair")}
          </Button>
        </div>
      )}
      {a.status === "pairing" && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void a.completePairing(code).then((ok) => ok && setCode(""));
          }}
        >
          <p>{t("agent.pairing.help")}</p>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              aria-label={t("agent.pairing.code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-32 text-[18px] tracking-[0.3em]"
            />
            <Button type="submit" variant="primary" disabled={code.length !== 6}>
              {t("agent.pairing.confirm")}
            </Button>
          </div>
          <a
            href={`http://127.0.0.1:${a.endpoint?.port ?? 47807}/pair`}
            target="_blank"
            rel="noopener"
            className="text-[12px] text-accent underline"
          >
            {t("agent.pairing.openCode")}
          </a>
          {a.pairError && <Notice tone="warning">{t("agent.pairing.failed")}</Notice>}
          <p className="text-[12px] text-muted">{t("agent.pairing.headless")}</p>
        </form>
      )}
      {a.status === "paired" && (
        <div className="flex flex-wrap items-center gap-3">
          <span>● {t("agent.paired", { v, fp })}</span>
          <Button onClick={() => void a.forget()}>{t("agent.forget")}</Button>
        </div>
      )}
      {a.status === "impostor" && (
        <ErrorBox tag="NOT_PAIRED" message={t("agent.impostor", { port: a.endpoint?.port ?? "" })}>
          <div>
            <Button onClick={() => void a.forget()}>{t("agent.forget")}</Button>
          </div>
        </ErrorBox>
      )}
      {a.status === "incompatible" && (
        <ErrorBox tag="PROTOCOL_MISMATCH" message={t("agent.incompatible", { v, url: `http://127.0.0.1:${a.endpoint?.port ?? 47807}/` })} />
      )}
      {a.status === "rejected" && (
        <div className="flex flex-col gap-2">
          <Notice tone="warning">{t("agent.rejected")}</Notice>
          <div>
            <Button variant="primary" onClick={() => void a.beginPairing()}>
              {t("agent.pair")}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
