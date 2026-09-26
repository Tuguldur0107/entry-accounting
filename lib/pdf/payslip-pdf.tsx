// Цалингийн хуудсын PDF — @react-pdf/renderer (сервер талд, и-мэйлийн хавсралт).
//
// Агуулга нь дэлгэцийн / хэвлэх хуудастай (components/payroll/payslip-report-view
// `PayslipSheet`) ИЖИЛ: `buildPayslip`-ийн бүтэц → мөр бүр хадгалагдсан дүн.
// Энд юу ч дахин бодогдохгүй.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import type { Payslip, PayslipCompany, PayslipSection } from "@/lib/payroll/payslip";
import { fmtPeriodLabelMn } from "@/lib/periods/period";
import { PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";

// PDF бол ЦААС — theme-ээс хамааралгүй (invoice-pdf-тэй ижил).
const INK = "#111111";
const MUTED = "#555555";
const RULE = "#999999";

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 9,
    color: INK,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 0.5,
    borderColor: RULE,
    paddingBottom: 6,
    marginBottom: 10,
  },
  companyName: { fontSize: 11, fontWeight: "bold" },
  small: { fontSize: 8, color: MUTED },
  title: { fontSize: 11, fontWeight: "bold", textAlign: "right" },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  metaCell: { width: "50%", marginBottom: 3 },
  metaLabel: { color: MUTED },
  sectionTitle: {
    fontSize: 8,
    fontWeight: "bold",
    textTransform: "uppercase",
    borderBottomWidth: 0.5,
    borderColor: RULE,
    paddingBottom: 2,
    marginTop: 6,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
  },
  subtotal: { borderTopWidth: 0.5, borderColor: RULE, fontWeight: "bold" },
  strong: { fontSize: 11, fontWeight: "bold" },
  note: { fontSize: 7, color: MUTED },
  netBlock: { marginTop: 10, borderTopWidth: 1.5, borderColor: INK, paddingTop: 4 },
  footnote: { marginTop: 10, fontSize: 7.5, color: MUTED },
  signBlock: { marginTop: 30, flexDirection: "row", justifyContent: "space-between" },
});

const fmt = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function Row({
  label,
  note,
  amount,
  strong,
  subtotal,
}: {
  label: string;
  note?: string;
  amount: number;
  strong?: boolean;
  subtotal?: boolean;
}) {
  return (
    <View
      style={[
        styles.row,
        ...(subtotal ? [styles.subtotal] : []),
        ...(strong ? [styles.strong] : []),
      ]}
    >
      <Text>
        {label}
        {note ? <Text style={styles.note}> ({note})</Text> : null}
      </Text>
      <Text>{fmt(amount)}</Text>
    </View>
  );
}

function Section({ section }: { section: PayslipSection }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      {section.lines.map((line) => (
        <Row key={line.label} label={line.label} note={line.note} amount={line.amount} />
      ))}
      <Row label={`${section.title} — нийт`} amount={section.total} subtotal />
    </View>
  );
}

function PayslipDocument({ slip, company }: { slip: Payslip; company: PayslipCompany }) {
  const companyMeta = [
    company.registerNo && `РД: ${company.registerNo}`,
    company.address,
    company.phone,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Document title={`Цалингийн хуудас ${slip.periodMonth}`} author={company.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company.name || "—"}</Text>
            {companyMeta ? <Text style={styles.small}>{companyMeta}</Text> : null}
          </View>
          <View>
            <Text style={styles.title}>ЦАЛИНГИЙН ХУУДАС</Text>
            <Text style={[styles.small, { textAlign: "right" }]}>
              {fmtPeriodLabelMn(slip.periodMonth)}
            </Text>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Ажилтан: </Text>
            {slip.employeeName}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Регистр: </Text>
            {slip.registerNo || "—"}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Албан тушаал: </Text>
            {slip.position || "—"}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Хэлтэс: </Text>
            {slip.department || "—"}
          </Text>
        </View>

        <Section section={slip.earnings} />
        <Section section={slip.deductions} />
        {slip.taxFree ? <Section section={slip.taxFree} /> : null}

        <View style={styles.netBlock}>
          <Row label="ГАРТ ОЛГОХ" amount={slip.netSalary} strong />
          <Row label="Урьдчилгаагаар олгосон" amount={-slip.advanceAmount} />
          <Row label="Сүүл цалин" amount={slip.finalNet} strong />
        </View>

        <Text style={styles.footnote}>
          Ажил олгогчийн НДШ {fmt(slip.employerSi)} (мэдээллийн зорилгоор —
          ажилтнаас суутгагдахгүй).{slip.averageNote ? ` ${slip.averageNote}.` : ""}
        </Text>

        <View style={styles.signBlock}>
          <Text>Нягтлан бодогч: ______________________</Text>
          <Text>Ажилтан: ______________________</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Нэг ажилтны цалингийн хуудсыг PDF Buffer болгоно (и-мэйлийн хавсралт). */
export async function renderPayslipPdf(
  slip: Payslip,
  company: PayslipCompany
): Promise<Buffer> {
  return renderToBuffer(<PayslipDocument slip={slip} company={company} />);
}
