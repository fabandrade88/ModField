"use client";
import { describeRtuFrame, toHex } from "@modfield/protocol";
import type { TrafficFrame } from "@modfield/transport";
import { useMemo, useState } from "react";
import { Button, cx } from "@/components/controls";
import { useT } from "@/components/i18n";
import { traffic, useConnection } from "@/store/connection";

/** Rendered rows; the full 50,000-frame buffer stays available for copy/export. */
const VISIBLE = 500;

function time(t: number): string {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function line(f: TrafficFrame): string {
  const d = describeRtuFrame(f.bytes, f.dir);
  return `${time(f.t)} ${f.dir.toUpperCase()} ${toHex(f.bytes) || "—"}  ${d.text}${f.error ? `  [${f.error}]` : ""}`;
}

export function TrafficModule() {
  const t = useT();
  const version = useConnection((s) => s.trafficVersion);
  const clear = useConnection((s) => s.clearTraffic);
  const [paused, setPaused] = useState<TrafficFrame[] | undefined>();
  const [onlyErrors, setOnlyErrors] = useState(false);

  const frames = useMemo(() => {
    void version;
    const all = paused ?? traffic.last(onlyErrors ? traffic.size : VISIBLE);
    const filtered = onlyErrors ? all.filter((f) => f.error) : all;
    return filtered.slice(-VISIBLE).reverse();
  }, [version, paused, onlyErrors]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <Button onClick={() => setPaused((p) => (p ? undefined : traffic.last(traffic.size)))} aria-pressed={Boolean(paused)}>
          {paused ? t("traffic.resume") : t("traffic.pause")}
        </Button>
        <Button onClick={clear}>{t("traffic.clear")}</Button>
        <Button onClick={() => void navigator.clipboard?.writeText(traffic.last(traffic.size).map(line).join("\n"))}>
          {t("traffic.copy")}
        </Button>
        <label className="flex min-h-8 items-center gap-2 text-muted">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="size-4" />
          {t("traffic.onlyErrors")}
        </label>
        <span className="ml-auto text-muted tabular-nums">
          {t("traffic.count", { shown: frames.length, total: traffic.total })}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {frames.length === 0 ? (
          <p className="p-3 text-muted">{t("traffic.empty")}</p>
        ) : (
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr>
                <th className="px-2 py-1 font-normal">{t("traffic.time")}</th>
                <th className="px-2 py-1 font-normal">{t("traffic.dir")}</th>
                <th className="px-2 py-1 font-normal">{t("traffic.bytes")}</th>
                <th className="px-2 py-1 font-normal">{t("traffic.decoded")}</th>
              </tr>
            </thead>
            <tbody>
              {frames.map((f, i) => {
                const d = describeRtuFrame(f.bytes, f.dir);
                return (
                  <tr key={`${f.t}-${i}`} className="border-b border-border/40 align-top">
                    <td className="px-2 py-0.5 whitespace-nowrap text-muted tabular-nums">{time(f.t)}</td>
                    <td className={cx("px-2 py-0.5", f.dir === "tx" ? "text-muted" : "")}>{f.dir.toUpperCase()}</td>
                    <td className="px-2 py-0.5 tabular-nums">{toHex(f.bytes) || "—"}</td>
                    <td className="px-2 py-0.5">
                      {f.bytes.length > 0 && <span>{d.text}</span>}
                      {f.error && (
                        <span className={cx("ml-2", f.error === "MODBUS_EXCEPTION" ? "text-warning" : "text-comm")}>
                          ! {f.error}
                        </span>
                      )}
                      {d.crcOk === false && !f.error && <span className="ml-2 text-comm">! CRC</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
