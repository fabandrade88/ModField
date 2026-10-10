import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { REPORT_STRINGS, fill } from "./i18n";
import type { ReportData, SignatureBlock, Verdict } from "./types";

/*
 * Print layout: A4, built-in PDF fonts only (nothing to download, works
 * offline), black on white, color only next to text (never color alone).
 */
const ink = "#111111";
const muted = "#555555";
const rule = "#999999";
const VERDICT_COLOR: Record<Verdict, string> = { pass: "#1b5e20", fail: "#b00020", pending: "#6b6b00" };

const s = StyleSheet.create({
  // No lineHeight here: on the Page it pushes absolutely positioned bottom elements (the footer) off the page.
  page: { paddingTop: 92, paddingBottom: 60, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9, color: ink },
  body: { lineHeight: 1.35 },
  header: { position: "absolute", top: 28, left: 40, right: 40, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: ink, paddingBottom: 8 },
  logo: { width: 90, height: 40, objectFit: "contain", marginRight: 12 },
  company: { flexGrow: 1 },
  companyName: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  headRight: { alignItems: "flex-end" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: rule, paddingTop: 6, fontSize: 7, color: muted },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 14, marginBottom: 6, paddingBottom: 2, borderBottomWidth: 0.5, borderBottomColor: rule },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  field: { width: "50%", marginBottom: 4 },
  label: { color: muted, fontSize: 7.5 },
  table: { borderTopWidth: 0.5, borderTopColor: rule },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: rule, paddingVertical: 3 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: muted },
  td: { paddingRight: 4 },
  mono: { fontFamily: "Courier", fontSize: 7.5 },
  note: { color: muted, fontSize: 7.5, marginTop: 3 },
  trendImg: { width: "100%", height: 200, objectFit: "contain", marginVertical: 4 },
  signRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  sign: { flex: 1, borderWidth: 0.5, borderColor: rule, padding: 8, minHeight: 120 },
  signImg: { height: 48, objectFit: "contain", marginBottom: 2 },
  signLine: { borderBottomWidth: 0.75, borderBottomColor: ink, height: 48, marginBottom: 4 },
  box: { borderWidth: 0.5, borderColor: rule, padding: 8, marginTop: 12 },
});

function Table({ cols, rows, empty }: { cols: { title: string; width: string; mono?: boolean }[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <Text style={s.note}>{empty}</Text>;
  return (
    <View style={s.table}>
      <View style={s.tr} fixed>
        {cols.map((c) => (
          <Text key={c.title} style={[s.th, s.td, { width: c.width }]}>
            {c.title}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {r.map((cell, j) => (
            <View key={j} style={[s.td, { width: cols[j]!.width }]}>
              {typeof cell === "string" || typeof cell === "number" ? <Text style={cols[j]!.mono ? s.mono : undefined}>{cell}</Text> : cell}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Text>{value || "—"}</Text>
    </View>
  );
}

function Signature({ b, t }: { b: SignatureBlock; t: (typeof REPORT_STRINGS)["pt"] }) {
  return (
    <View style={s.sign} wrap={false}>
      <Text style={[s.th, { marginBottom: 6 }]}>{t.sign[b.role]}</Text>
      {b.image ? <Image style={s.signImg} src={b.image} /> : <View style={s.signLine} />}
      <Text>
        <Text style={s.label}>{t.sign.name}: </Text>
        {b.name || " "}
      </Text>
      <Text>
        <Text style={s.label}>{t.sign.function}: </Text>
        {b.function || " "}
      </Text>
      <Text>
        <Text style={s.label}>{t.sign.company}: </Text>
        {b.company || " "}
      </Text>
      <Text>
        <Text style={s.label}>{t.sign.date}: </Text>
        {b.date || " "}
      </Text>
    </View>
  );
}

export function ReportDocument({ data }: { data: ReportData }) {
  const t = REPORT_STRINGS[data.lang];
  const on = data.sections;
  const c = data.company;
  const signatures = data.signatures.filter((b) => b.enabled);
  return (
    <Document title={`${t.title} ${data.number}`} author={c.name} creator={`ModField ${data.appVersion}`} producer="ModField" language={data.lang}>
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          {c.logo ? <Image style={s.logo} src={c.logo} /> : null}
          <View style={s.company}>
            <Text style={s.companyName}>{c.name || " "}</Text>
            <Text style={s.label}>{[c.taxId, c.address].filter(Boolean).join(" · ")}</Text>
            <Text style={s.label}>{[c.phone, c.email, c.website].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={s.headRight}>
            <Text style={s.title}>{t.title}</Text>
            <Text>
              {t.number} {data.number} · {t.date} {data.date}
            </Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>
            {t.number} {data.number} · {fill(t.generated, { version: data.appVersion })}
          </Text>
          <Text>{data.integrity ? `SHA-256 ${data.integrity.hash.slice(0, 16)}…` : ""}</Text>
          <Text render={({ pageNumber, totalPages }) => fill(t.page, { n: pageNumber, total: totalPages })} />
        </View>

        <View style={s.body}>
        {on.identification && (
          <View>
            <Text style={s.h2}>{t.section.identification}</Text>
            <View style={s.grid}>
              <Field label={t.client} value={data.identification.client} />
              <Field label={t.plant} value={data.identification.plant} />
              <Field label={t.area} value={data.identification.area} />
              <Field label={t.project} value={data.identification.project} />
              <Field label={t.responsible} value={data.identification.responsible} />
            </View>
          </View>
        )}

        {on.equipment && (
          <View>
            <Text style={s.h2}>{t.section.equipment}</Text>
            <Table
              empty={t.none}
              cols={[
                { title: t.tag, width: "22%" },
                { title: t.manufacturer, width: "18%" },
                { title: t.model, width: "18%" },
                { title: t.serial, width: "16%" },
                { title: t.address, width: "12%" },
                { title: t.firmware, width: "14%" },
              ]}
              rows={data.equipment.map((e) => [e.tag, e.manufacturer, e.model, e.serialNumber, String(e.unitId), e.firmware])}
            />
          </View>
        )}

        {on.communication && (
          <View>
            <Text style={s.h2}>{t.section.communication}</Text>
            <View style={s.grid}>
              {data.communication.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </View>
          </View>
        )}

        {on.tests && (
          <View>
            <Text style={s.h2}>{t.section.tests}</Text>
            <Table
              empty={t.none}
              cols={[
                { title: t.tag, width: "26%" },
                { title: t.expected, width: "14%" },
                { title: t.measured, width: "20%" },
                { title: t.tolerance, width: "14%" },
                { title: t.unit, width: "10%" },
                { title: t.verdict, width: "16%" },
              ]}
              rows={data.tests.map((r) => [
                <View key="tag">
                  <Text>{r.tag}</Text>
                  {r.justification ? <Text style={s.note}>{fill(t.manual, { text: r.justification })}</Text> : null}
                </View>,
                r.expected,
                r.how ? `${r.measured} (${r.how})` : r.measured,
                r.tolerance,
                r.unit,
                <Text key="v" style={{ fontFamily: "Helvetica-Bold", color: VERDICT_COLOR[r.verdict] }}>
                  {t.verdicts[r.verdict]}
                  {r.justification ? " *" : ""}
                </Text>,
              ])}
            />
          </View>
        )}

        {on.writes && (
          <View>
            <Text style={s.h2}>{t.section.writes}</Text>
            <Table
              empty={t.none}
              cols={[
                { title: t.time, width: "20%" },
                { title: t.tag, width: "28%" },
                { title: t.previous, width: "16%" },
                { title: t.next, width: "16%" },
                { title: t.result, width: "20%" },
              ]}
              rows={data.writes.map((w) => [w.time, `${w.tag} ${w.address}`.trim(), w.previous, w.next, w.result])}
            />
          </View>
        )}

        {on.scans && data.scans.length > 0 && (
          <View>
            <Text style={s.h2}>{t.section.scans}</Text>
            <Table
              empty={t.none}
              cols={[
                { title: t.time, width: "20%" },
                { title: t.kind, width: "18%" },
                { title: t.params, width: "32%" },
                { title: t.result, width: "30%" },
              ]}
              rows={data.scans.map((x) => [x.time, x.kind, x.params, x.result])}
            />
          </View>
        )}

        {on.trends &&
          data.trends.map((tr, i) => (
            <View key={i} break={i > 0}>
              {/* Heading, period and chart stay together on one page. */}
              <View wrap={false}>
                <Text style={s.h2}>
                  {t.section.trends} · {tr.session}
                </Text>
                <Text style={s.note}>
                  {t.period}: {tr.period}
                </Text>
                {tr.image ? <Image style={s.trendImg} src={tr.image} /> : null}
              </View>
              <Table
                empty={t.none}
                cols={[
                  { title: t.tag, width: "28%" },
                  { title: t.min, width: "12%" },
                  { title: t.max, width: "12%" },
                  { title: t.mean, width: "12%" },
                  { title: t.std, width: "12%" },
                  { title: t.n, width: "12%" },
                  { title: t.gaps, width: "12%" },
                ]}
                rows={tr.stats.map((x) => [x.unit ? `${x.tag} (${x.unit})` : x.tag, x.min, x.max, x.mean, x.std, String(x.n), String(x.gaps)])}
              />
              {tr.markers.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={s.th}>{t.markers}</Text>
                  {tr.markers.map((m, k) => (
                    <Text key={k}>
                      • {m.time} — {m.text}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ))}

        {on.observations && (
          <View wrap={false}>
            <Text style={s.h2}>{t.section.observations}</Text>
            <Text>{data.observations || "—"}</Text>
            {data.pending ? (
              <View style={{ marginTop: 6 }}>
                <Text style={s.th}>{t.pending}</Text>
                <Text>{data.pending}</Text>
              </View>
            ) : null}
          </View>
        )}

        {on.signatures && signatures.length > 0 && (
          <View wrap={false}>
            <Text style={s.h2}>{t.section.signatures}</Text>
            <View style={s.signRow}>
              {signatures.map((b) => (
                <Signature key={b.role} b={b} t={t} />
              ))}
            </View>
            {signatures.some((b) => b.image) && <Text style={s.note}>{t.sign.drawnNote}</Text>}
          </View>
        )}

        {data.integrity && (
          <View style={s.box} wrap={false}>
            <Text style={s.th}>{t.integrity.title}</Text>
            <Text style={{ marginTop: 4 }}>{fill(t.integrity.hash, { rows: data.integrity.rows })}</Text>
            <Text style={s.mono}>{data.integrity.hash}</Text>
            {data.integrity.signature ? (
              <View style={{ marginTop: 4 }}>
                <Text>{fill(t.integrity.signed, { fp: data.integrity.signature.fingerprint })}</Text>
                <Text style={s.mono}>sig {data.integrity.signature.value}</Text>
                <Text style={s.mono}>key {data.integrity.signature.publicKey}</Text>
              </View>
            ) : (
              <Text style={{ marginTop: 4 }}>{t.integrity.unsigned}</Text>
            )}
            {data.csvAttached && <Text style={s.note}>{t.integrity.attached}</Text>}
            <Text style={s.note}>{t.integrity.verify}</Text>
          </View>
        )}
        </View>
      </Page>
    </Document>
  );
}
