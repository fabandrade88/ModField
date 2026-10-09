"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Button, Dialog, ErrorBox, Notice, Section, cx } from "@/components/controls";
import { useLang, useT } from "@/components/i18n";
import { db, type LogSession } from "@/lib/db";
import { download, stamp } from "@/lib/download";
import { deleteSession, sessionBytes } from "@/lib/logger";
import { exportProject, importProject } from "@/lib/project";
import { useAgent } from "@/store/agent";
import { useLogger } from "@/store/logger";
import { useUi } from "@/store/ui";

/** "Include sessions" is on by default when they fit in this. */
const INCLUDE_LIMIT = 500 * 2 ** 20;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 2 ** 20) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 2 ** 30) return `${(n / 2 ** 20).toFixed(1)} MB`;
  return `${(n / 2 ** 30).toFixed(2)} GB`;
}

export function StorageModule() {
  const t = useT();
  const lang = useLang();
  const version = useLogger((s) => s.version);
  const running = useLogger((s) => s.session?.id);
  const sessions = useLiveQuery(() => db.sessions.orderBy("startedAt").reverse().toArray(), [version], []);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [confirm, setConfirm] = useState<LogSession>();
  const [include, setInclude] = useState<boolean>();
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(sessions.map(async (s) => [s.id, await sessionBytes(s.id)] as const));
      setSizes(Object.fromEntries(entries));
      const e = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
      setEstimate({ usage: e?.usage, quota: e?.quota, persisted });
    })();
  }, [sessions]);

  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const includeSessions = include ?? total <= INCLUDE_LIMIT;
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? "—";

  const doExport = async () => {
    setError(undefined);
    const blob = await exportProject(includeSessions);
    download(`modfield-projeto-${stamp()}.modfield`, blob, "application/gzip");
  };
  const doImport = async (file: File) => {
    setError(undefined);
    setResult(undefined);
    try {
      const r = await importProject(file);
      setResult(t("storage.imported", { profiles: r.profiles, tags: r.tags, sessions: r.sessions }));
      useLogger.setState((s) => ({ version: s.version + 1 }));
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      <Notice tone="warning">{t("storage.warning")}</Notice>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        <div>
          <dt className="text-[12px] text-muted">{t("storage.used")}</dt>
          <dd className="text-[15px] tabular-nums">{estimate.usage !== undefined ? fmtBytes(estimate.usage) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted">{t("storage.quota")}</dt>
          <dd className="text-[15px] tabular-nums">{estimate.quota !== undefined ? fmtBytes(estimate.quota) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted">{t("storage.persisted")}</dt>
          <dd className={cx("text-[15px]", estimate.persisted === false && "text-warning")}>
            {estimate.persisted === undefined ? "—" : estimate.persisted ? t("storage.persisted.yes") : `! ${t("storage.persisted.no")}`}
          </dd>
        </div>
      </dl>

      <Section title={t("storage.project")}>
        <p className="text-muted">{t("storage.project.help")}</p>
        <label className="flex min-h-8 items-center gap-2">
          <input type="checkbox" className="size-4" checked={includeSessions} onChange={(e) => setInclude(e.target.checked)} />
          {t("storage.includeSessions", { size: fmtBytes(total) })}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void doExport()}>
            {t("storage.export")}
          </Button>
          <label className="inline-flex min-h-8 cursor-pointer items-center border border-border bg-surface-2 px-3 hover:border-muted">
            {t("storage.import")}
            <input
              type="file"
              accept=".modfield,application/gzip"
              className="sr-only"
              aria-label={t("storage.import")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void doImport(f);
              }}
            />
          </label>
        </div>
        {result && <p>{result}</p>}
        {error !== undefined && <ErrorBox tag="!" message={t("storage.import.failed", { detail: error instanceof Error ? error.message : String(error) })} />}
      </Section>

      <Section title={t("storage.sessions")}>
        {sessions.length === 0 ? (
          <p className="text-muted">{t("storage.sessions.empty")}</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="pr-3 font-normal">{t("logger.name")}</th>
                <th className="pr-3 font-normal">{t("profile.label")}</th>
                <th className="pr-3 font-normal">{t("storage.started")}</th>
                <th className="pr-3 font-normal">{t("logger.samples.col")}</th>
                <th className="pr-3 font-normal">{t("storage.size")}</th>
                <th className="pr-3 font-normal">{t("storage.state")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="h-8 border-b border-border/50">
                  <td className="pr-3">{s.name}</td>
                  <td className="pr-3 text-muted">{profileName(s.profileId)}</td>
                  <td className="pr-3 text-muted tabular-nums">{new Date(s.startedAt).toLocaleString(lang, { hour12: false })}</td>
                  <td className="pr-3 tabular-nums">{s.samples}</td>
                  <td className="pr-3 tabular-nums">{fmtBytes(sizes[s.id] ?? 0)}</td>
                  <td className={cx("pr-3", s.status === "interrupted" && "text-warning")}>
                    {s.status === "interrupted" ? "! " : ""}
                    {t(`logger.status.${s.status}`)} · {t(`logger.source.${s.source}`)}
                  </td>
                  <td>
                    <Button variant="ghost" disabled={s.id === running} onClick={() => setConfirm(s)}>
                      {t("common.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <AgentLogs />
      <Dialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(undefined)}
        title={t("storage.delete.title", { name: confirm?.name ?? "" })}
        footer={
          <>
            <Button onClick={() => setConfirm(undefined)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) void deleteSession(confirm).then(() => useLogger.setState((s) => ({ version: s.version + 1 })));
                setConfirm(undefined);
              }}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        {t("storage.delete.body")}
      </Dialog>
    </div>
  );
}

interface AgentLogMeta {
  logId: string;
  name: string;
  startedAt: string;
  running: boolean;
  lastSeq: number;
  ackedSeq: number;
  bytes: number;
}

function AgentLogs() {
  const t = useT();
  const lang = useLang();
  const client = useAgent((s) => (s.status === "paired" ? s.client : undefined));
  const [logs, setLogs] = useState<{ logs: AgentLogMeta[]; freeBytes: number }>();
  const reload = () => client && void client.call<{ logs: AgentLogMeta[]; freeBytes: number }>("log.list").then(setLogs).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [client]);
  if (!client || !logs) return null;
  return (
    <Section title={t("storage.agent", { free: fmtBytes(logs.freeBytes) })}>
      {logs.logs.length === 0 ? (
        <p className="text-muted">{t("storage.agent.empty")}</p>
      ) : (
        <table className="w-full text-left">
          <tbody>
            {logs.logs.map((l) => {
              const synced = l.ackedSeq >= l.lastSeq;
              return (
                <tr key={l.logId} className="h-8 border-b border-border/50">
                  <td className="pr-3">{l.name}</td>
                  <td className="pr-3 text-muted tabular-nums">{new Date(l.startedAt).toLocaleString(lang, { hour12: false })}</td>
                  <td className="pr-3 tabular-nums">{fmtBytes(l.bytes)}</td>
                  <td className={cx("pr-3", !synced && "text-warning")}>{l.running ? t("logger.status.running") : synced ? t("storage.agent.synced") : `! ${t("storage.agent.unsynced")}`}</td>
                  <td>
                    {!l.running && synced && (
                      <Button variant="ghost" onClick={() => void client.call("log.delete", { logId: l.logId }).then(reload)}>
                        {t("common.delete")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-[12px] text-muted">{t("storage.agent.help")}</p>
    </Section>
  );
}
