"use client";
import { BookOpen, Cable, ClipboardCopy, Download, FileText, LineChart, Network, PlayCircle, Plug, Table2, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Kbd, Section, cx } from "@/components/controls";
import { Credit } from "@/components/Credit";
import { DOWNLOADS_PATH, SITE_URL } from "@/lib/site";
import { useLang, useT } from "@/components/i18n";
import type { Key, Lang } from "@/lib/i18n";
import { NUMBERED_MODULES } from "@/lib/modules";
import { detectPlatform, loadDownloads, mb, type DownloadFile, type DownloadManifest, type OsId } from "@/lib/platform";
import { DEMO_PROFILE_ID } from "@/lib/seed";
import { useAgent } from "@/store/agent";
import { useConnection } from "@/store/connection";
import { useUi } from "@/store/ui";

function DocLink({ slug, children }: { slug: string; children: ReactNode }) {
  const lang = useLang();
  return (
    <a href={`/${lang}/docs/${slug}`} target="_blank" rel="noopener" className="text-accent underline">
      {children} ↗
    </a>
  );
}

/** The first thing a visitor sees: what it is, how to start, where to get the agent, where help is. */
export function HomeModule() {
  const t = useT();
  const lang = useLang();
  const state = useConnection((s) => s.state);
  const agent = useAgent((s) => s.status);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <h1 className="text-[20px]">{t("home.title")}</h1>
        <p className="max-w-3xl text-muted">{t("home.lead")}</p>
        <div className="flex flex-wrap gap-4 text-[12px]">
          <span>
            <span className="text-muted">{t("home.status.connection")} </span>
            {state === "connected" ? `● ${t("state.connected")}` : `○ ${t("state.disconnected")}`}
          </span>
          <span>
            <span className="text-muted">{t("home.status.agent")} </span>
            {agent === "paired" ? `● ${t("home.agent.paired")}` : agent === "found" || agent === "pairing" ? `○ ${t("home.agent.found")}` : `? ${t("home.agent.unknown")}`}
          </span>
        </div>
      </header>

      <StartPaths />
      <Diagram />
      <AgentDownload />
      <FourSteps />
      <ModulesTable />

      <Section title={t("home.help")}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p>{t("home.help.lead")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.open(`/${lang}/docs/`, "_blank", "noopener")}>
                <BookOpen size={16} strokeWidth={1.5} aria-hidden /> {t("docs.open")} ↗
              </Button>
              <Button onClick={() => useUi.getState().set({ helpOpen: true })} shortcut="?">
                {t("help.title")}
              </Button>
            </div>
          </div>
          <ul className="flex flex-col gap-1">
            <li>
              <DocLink slug="troubleshooting">{t("home.help.troubleshooting")}</DocLink>
            </li>
            <li>
              <DocLink slug="hardware">{t("home.help.hardware")}</DocLink>
            </li>
            <li>
              <DocLink slug="modbus-reference">{t("home.help.reference")}</DocLink>
            </li>
          </ul>
        </div>
      </Section>

      <div className="border-t border-border pt-3">
        <Credit label={t("credit.by")} />
      </div>
    </div>
  );
}

function Path({
  icon: Icon,
  title,
  desc,
  needs,
  action,
  guide,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  needs: string;
  action: ReactNode;
  guide: ReactNode;
  testId: string;
}) {
  return (
    <div data-path={testId} className="flex flex-col gap-2 border border-border bg-surface p-3">
      <h3 className="flex items-center gap-2 text-[14px]">
        <Icon size={18} strokeWidth={1.5} aria-hidden className="text-muted" />
        {title}
      </h3>
      <p className="flex-1">{desc}</p>
      <p className="text-[12px] text-muted">{needs}</p>
      <div className="flex flex-wrap items-center gap-3">
        {action}
        <span className="text-[12px]">{guide}</span>
      </div>
    </div>
  );
}

function StartPaths() {
  const t = useT();
  const ui = useUi();
  const connectDemo = useConnection((s) => s.connectDemo);
  const open = (tab: "rtu" | "tcp") => {
    // Connection beside the traffic monitor: the frames show at once whether the bus answers.
    ui.set({ connTab: tab });
    ui.setLayout(2);
    ui.setPane(0, "connection");
    ui.setPane(1, "traffic");
    ui.focusPane(0);
  };
  return (
    <Section title={t("first.title")}>
      <div className="grid gap-3 md:grid-cols-3">
        <Path
          testId="usb"
          icon={Cable}
          title={t("first.usb")}
          desc={t("home.usb.desc")}
          needs={t("home.usb.needs")}
          action={
            <Button variant="primary" onClick={() => open("rtu")}>
              {t("home.usb.go")}
            </Button>
          }
          guide={<DocLink slug="quick-start-usb">{t("home.guide")}</DocLink>}
        />
        <Path
          testId="tcp"
          icon={Network}
          title={t("first.tcp")}
          desc={t("home.tcp.desc")}
          needs={t("home.tcp.needs")}
          action={
            <Button variant="primary" onClick={() => open("tcp")}>
              {t("home.tcp.go")}
            </Button>
          }
          guide={<DocLink slug="quick-start-tcp">{t("home.guide")}</DocLink>}
        />
        <Path
          testId="demo"
          icon={PlayCircle}
          title={t("first.demo")}
          desc={t("home.demo.desc")}
          needs={t("home.demo.needs")}
          action={
            <Button
              variant="primary"
              onClick={() => {
                ui.set({ connTab: "demo", profileId: DEMO_PROFILE_ID, readTab: "tags" });
                ui.setLayout(2);
                ui.setPane(1, "traffic");
                ui.setPane(0, "read");
                void connectDemo();
              }}
            >
              {t("home.demo.go")}
            </Button>
          }
          guide={<DocLink slug="guides/simulator">{t("home.guide")}</DocLink>}
        />
      </div>
    </Section>
  );
}

/** Where things run: the browser alone, or with the local agent. */
function Diagram() {
  const t = useT();
  const box = (x: number, y: number, w: number, label: string, sub?: string) => (
    <g>
      <rect x={x} y={y} width={w} height={44} fill="var(--c-surface-2)" stroke="var(--c-border)" />
      <text x={x + w / 2} y={y + (sub ? 19 : 27)} textAnchor="middle" fill="var(--c-fg)" fontSize="13">
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + 35} textAnchor="middle" fill="var(--c-muted)" fontSize="11">
          {sub}
        </text>
      )}
    </g>
  );
  const wire = (x1: number, x2: number, y: number, label: string, dashed = false) => (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--c-muted)" strokeWidth={1.5} strokeDasharray={dashed ? "5 4" : undefined} />
      <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fill="var(--c-muted)" fontSize="11">
        {label}
      </text>
    </g>
  );
  return (
    <Section title={t("home.how")}>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 860 170" role="img" aria-label={t("home.how.alt")} className="min-w-[640px] font-mono">
          <text x={0} y={14} fill="var(--c-muted)" fontSize="11">
            {t("home.how.noAgent")}
          </text>
          {box(0, 24, 170, t("home.how.browser"), "Chrome · Edge · Firefox")}
          {wire(170, 330, 46, "USB · Web Serial")}
          {box(330, 24, 170, t("home.how.converter"))}
          {wire(500, 660, 46, "RS-485 · A/B")}
          {box(660, 24, 200, t("home.how.device"), "RTU")}

          <text x={0} y={104} fill="var(--c-muted)" fontSize="11">
            {t("home.how.withAgent")}
          </text>
          {box(0, 114, 170, t("home.how.browser"))}
          {wire(170, 330, 136, "127.0.0.1 · WebSocket", true)}
          {box(330, 114, 170, t("home.how.agent"), t("home.how.agent.sub"))}
          {wire(500, 660, 136, "TCP 502 · RS-485")}
          {box(660, 114, 200, t("home.how.devices"), "TCP · RTU")}
        </svg>
      </div>
      <p className="text-[12px] text-muted">{t("home.how.note")}</p>
    </Section>
  );
}

const OS_LABEL: Record<OsId, string> = { windows: "Windows", darwin: "macOS", linux: "Linux" };

function AgentDownload() {
  const t = useT();
  const agent = useAgent((s) => s.status);
  const [manifest, setManifest] = useState<DownloadManifest | null>();
  const [platform, setPlatform] = useState<ReturnType<typeof detectPlatform>>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setPlatform(detectPlatform());
    void loadDownloads().then((m) => setManifest(m ?? null));
  }, []);

  const origin = typeof location === "undefined" ? "" : location.origin;
  // install.sh defaults to the official site; a self-hosted copy points it at itself.
  const command =
    origin === SITE_URL
      ? `curl -fsSL ${SITE_URL}${DOWNLOADS_PATH}/latest/install.sh | sh`
      : `curl -fsSL ${origin}${DOWNLOADS_PATH}/latest/install.sh | MODFIELD_BASE=${origin}${DOWNLOADS_PATH} sh`;
  const files = manifest?.files ?? [];
  // Windows: the installer first, else the portable ZIP; elsewhere the plain binary.
  const pick = (os: OsId, arch: string): DownloadFile | undefined => {
    const wanted = os === "windows" ? (["installer", "portable"] as const) : (["binary"] as const);
    for (const kind of wanted) {
      const f = files.find((x) => x.os === os && x.arch === arch && x.kind === kind);
      if (f) return f;
    }
    return undefined;
  };
  const recommended = platform?.os ? pick(platform.os, platform.arch) : undefined;
  // Offer every option except the raw Windows binary (that one only feeds auto-update).
  const others = files.filter((f) => f !== recommended && (f.os !== "windows" || f.kind !== "binary"));
  const kindLabel = (f: DownloadFile) =>
    f.kind === "portable" ? ` · ${t("home.dl.portable")}` : f.kind === "installer" ? ` · ${t("home.dl.installer")}` : "";
  const label = (f: DownloadFile) => `${OS_LABEL[f.os]} ${f.arch === "arm64" ? "ARM64" : "x64"}${kindLabel(f)} · ${mb(f.bytes)}`;

  return (
    <Section title={t("home.dl.title")}>
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-2">
          <p>{t("home.dl.lead")}</p>
          <ul className="ml-5 list-disc text-muted">
            <li>{t("home.dl.why.tcp")}</li>
            <li>{t("home.dl.why.ports")}</li>
            <li>{t("home.dl.why.log")}</li>
            <li>{t("home.dl.why.sim")}</li>
          </ul>
          <p className="text-[12px] text-muted">{t("home.dl.safe")}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 self-start border border-border bg-surface p-3">
          {agent === "paired" ? (
            <p>● {t("home.dl.already")}</p>
          ) : manifest === undefined ? (
            <p className="text-muted">…</p>
          ) : manifest === null ? (
            <p className="text-muted">{t("home.dl.unpublished")}</p>
          ) : (
            <>
              <span className="text-[12px] text-muted">
                {t("home.dl.version", { v: manifest.version })}
                {platform?.os ? ` · ${t("home.dl.detected", { os: OS_LABEL[platform.os] })}` : ""}
              </span>
              {recommended && (
                <a href={`/downloads/${recommended.name}`} download className="inline-flex min-h-8 items-center gap-2 border border-accent bg-surface-2 px-3">
                  <Download size={16} strokeWidth={1.5} aria-hidden />
                  {t("home.dl.for", { what: label(recommended) })}
                </a>
              )}
              {platform?.os === "windows" && (
                <p className="border-l-2 border-border pl-2 text-[12px] text-muted">{t("home.dl.winNote")}</p>
              )}
              {platform?.os === "linux" && (
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] text-muted">{t("home.dl.linuxCmd")}</span>
                  <div className="flex items-stretch gap-1">
                    <code className="min-w-0 flex-1 overflow-x-auto border border-border bg-surface-2 px-2 py-1 text-[11px] whitespace-nowrap">{command}</code>
                    <Button
                      variant="ghost"
                      aria-label={t("traffic.copy")}
                      onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true))}
                    >
                      <ClipboardCopy size={14} strokeWidth={1.5} aria-hidden />
                      {copied ? "✓" : ""}
                    </Button>
                  </div>
                </div>
              )}
              <details>
                <summary className="min-h-8 cursor-pointer py-1 text-[12px] text-muted">{t("home.dl.others")}</summary>
                <ul className="flex flex-col gap-1 text-[12px]">
                  {others.map((f) => (
                    <li key={f.name}>
                      <a href={`/downloads/${f.name}`} download className="text-accent underline">
                        {label(f)}
                      </a>
                    </li>
                  ))}
                  <li>
                    <a href="/downloads/checksums.txt" className="text-muted underline">
                      checksums.txt (SHA-256)
                    </a>
                  </li>
                </ul>
              </details>
              {files.some((f) => f.os === "darwin") && platform?.os === "darwin" && <p className="text-[12px] text-muted">{t("home.dl.macNote")}</p>}
            </>
          )}
          <span className="text-[12px]">
            <DocLink slug="install-agent">{t("home.dl.guide")}</DocLink>
          </span>
        </div>
      </div>
    </Section>
  );
}

function FourSteps() {
  const t = useT();
  const open = (m: (typeof NUMBERED_MODULES)[number]) => useUi.getState().openModule(m);
  const steps: { icon: LucideIcon; title: Key; desc: Key; keys: string[]; module: (typeof NUMBERED_MODULES)[number]; doc: string }[] = [
    { icon: Plug, title: "home.step.connect", desc: "home.step.connect.desc", keys: ["1", "Ctrl+Enter"], module: "connection", doc: "quick-start-usb" },
    { icon: Table2, title: "home.step.read", desc: "home.step.read.desc", keys: ["2", "R", "P"], module: "read", doc: "guides/float32" },
    { icon: LineChart, title: "home.step.log", desc: "home.step.log.desc", keys: ["7", "L", "M"], module: "logger", doc: "guides/log-24h" },
    { icon: FileText, title: "home.step.report", desc: "home.step.report.desc", keys: ["8", "G"], module: "report", doc: "guides/report" },
  ];
  return (
    <Section title={t("home.steps")}>
      <ol className="grid gap-3 md:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 border border-border p-3">
            <span className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center border border-border text-[12px] text-muted">{i + 1}</span>
              <s.icon size={16} strokeWidth={1.5} aria-hidden className="text-muted" />
              <span>{t(s.title)}</span>
            </span>
            <span className="flex-1 text-[12px] text-muted">{t(s.desc)}</span>
            <span className="flex flex-wrap gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
            <span className="flex flex-wrap items-center gap-3 text-[12px]">
              <button type="button" className="min-h-8 text-accent underline" onClick={() => open(s.module)}>
                {t("home.step.open")}
              </button>
              <DocLink slug={s.doc}>{t("home.guide")}</DocLink>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function ModulesTable() {
  const t = useT();
  const lang = useLang();
  return (
    <Section title={t("home.modules")}>
      <table className="w-full text-left">
        <tbody>
          {NUMBERED_MODULES.map((m, i) => (
            <tr key={m} className="h-8 border-b border-border/50">
              <td className="w-10">
                <Kbd>{i + 1}</Kbd>
              </td>
              <td className="w-40 pr-3">
                <button type="button" className={cx("min-h-8 text-left text-accent underline")} onClick={() => useUi.getState().openModule(m)}>
                  {t(`module.${m}`)}
                </button>
              </td>
              <td className="text-muted">{t(`home.mod.${m}` as Key)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[12px] text-muted">
        {t("home.modules.hint")} <a className="text-accent underline" href={`/${lang}/docs/shortcuts`} target="_blank" rel="noopener">{t("help.title")} ↗</a>
      </p>
    </Section>
  );
}

export type { Lang };
