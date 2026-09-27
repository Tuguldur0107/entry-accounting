// Тооцоо нийлсэн актын PDF (docs/dev/arap.md §5i) — @react-pdf/renderer, сервер
// талд. Манай бүртгэл (баримт бүр дебит/кредит) + харилцагчийн бүртгэлийн ХООСОН
// багана (гараар бөглөж баталгаажуулна) + дүгнэлт + хоёр талын гарын үсэг.

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { CounterpartyStatement } from "@/lib/arap/statement-db";
import { PDF_FONT_FAMILY } from "@/lib/pdf/register-fonts";

// PDF бол ЦААС — дэлгэцийн theme-ээс хамааралгүй (invoice-pdf.tsx-тэй ижил).
const INK = "#111111";
const MUTED = "#555555";
const RULE = "#999999";

const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 8, color: INK, paddingTop: 36, paddingBottom: 44, paddingHorizontal: 36 },
  title: { fontSize: 14, fontWeight: "bold", textAlign: "center", letterSpacing: 2 },
  subtitle: { textAlign: "center", color: MUTED, marginTop: 3, marginBottom: 12 },
  parties: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  party: { width: "48%" },
  label: { fontSize: 7, color: MUTED },
  strong: { fontWeight: "bold", fontSize: 9 },
  table: { borderTopWidth: 1, borderColor: INK },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: RULE, paddingVertical: 3 },
  th: { fontWeight: "bold", fontSize: 7 },
  group: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: RULE, paddingVertical: 2 },
  cDate: { width: "10%" },
  cRef: { width: "18%", paddingRight: 3 },
  cDesc: { width: "24%", paddingRight: 4 },
  cNum: { width: "12%", textAlign: "right" },
  cTheir: { width: "12%", textAlign: "right", color: MUTED },
  bold: { fontWeight: "bold" },
  conclusion: { marginTop: 12, fontSize: 9 },
  signBlock: { marginTop: 28, flexDirection: "row", justifyContent: "space-between" },
  signCol: { width: "46%" },
  signLine: { marginTop: 20, borderBottomWidth: 0.5, borderColor: INK },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, textAlign: "center", fontSize: 7, color: MUTED },
});

const fmt = (value: number) =>
  value ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const side = (balance: number) => ({ debit: balance > 0 ? balance : 0, credit: balance < 0 ? -balance : 0 });

function Row({
  date,
  reference,
  description,
  debit,
  credit,
  bold,
}: {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  bold?: boolean;
}) {
  const text = bold ? styles.bold : undefined;
  return (
    <View style={styles.tr} wrap={false}>
      <Text style={[styles.cDate, text ?? {}]}>{date}</Text>
      <Text style={[styles.cRef, text ?? {}]}>{reference}</Text>
      <Text style={[styles.cDesc, text ?? {}]}>{description}</Text>
      <Text style={[styles.cNum, text ?? {}]}>{fmt(debit)}</Text>
      <Text style={[styles.cNum, text ?? {}]}>{fmt(credit)}</Text>
      <Text style={styles.cTheir} />
      <Text style={styles.cTheir} />
    </View>
  );
}

function StatementDocument({ statement }: { statement: CounterpartyStatement }) {
  const opening = side(statement.opening);
  const closing = side(statement.closing);
  return (
    <Document title={`Тооцоо нийлсэн акт — ${statement.counterparty.name}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>ТООЦОО НИЙЛСЭН АКТ</Text>
        <Text style={styles.subtitle}>
          {statement.from} — {statement.to} · дүн ₮ (гүйлгээний огнооны ханшаар)
        </Text>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Нэг тал</Text>
            <Text style={styles.strong}>{statement.company.name}</Text>
            {statement.company.registerNo && <Text>Регистр: {statement.company.registerNo}</Text>}
            {statement.company.address && <Text>{statement.company.address}</Text>}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>Нөгөө тал</Text>
            <Text style={styles.strong}>{statement.counterparty.name}</Text>
            {statement.counterparty.registerNo && <Text>Регистр: {statement.counterparty.registerNo}</Text>}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.group}>
            <Text style={[styles.th, { width: "52%" }]} />
            <Text style={[styles.th, { width: "24%", textAlign: "center" }]}>{statement.company.name}-ийн бүртгэлээр</Text>
            <Text style={[styles.th, { width: "24%", textAlign: "center", color: MUTED }]}>
              {statement.counterparty.name}-ийн бүртгэлээр
            </Text>
          </View>
          <View style={styles.tr}>
            <Text style={[styles.cDate, styles.th]}>Огноо</Text>
            <Text style={[styles.cRef, styles.th]}>Баримт</Text>
            <Text style={[styles.cDesc, styles.th]}>Утга</Text>
            <Text style={[styles.cNum, styles.th]}>Дебит</Text>
            <Text style={[styles.cNum, styles.th]}>Кредит</Text>
            <Text style={[styles.cTheir, styles.th]}>Дебит</Text>
            <Text style={[styles.cTheir, styles.th]}>Кредит</Text>
          </View>
          <Row date={statement.from} reference="" description="Эхний үлдэгдэл" debit={opening.debit} credit={opening.credit} bold />
          {statement.rows.map((row, index) => (
            <Row
              key={`${row.reference}-${index}`}
              date={row.date}
              reference={row.reference}
              description={row.description}
              debit={row.debit}
              credit={row.credit}
            />
          ))}
          <Row date="" reference="" description="Гүйлгээний дүн" debit={statement.totalDebit} credit={statement.totalCredit} bold />
          <Row date={statement.to} reference="" description="Эцсийн үлдэгдэл" debit={closing.debit} credit={closing.credit} bold />
        </View>

        <Text style={styles.conclusion}>{statement.conclusion}</Text>
        <Text style={[styles.label, { marginTop: 4 }]}>
          Дебит — {statement.counterparty.name} {statement.company.name}-д өртэй болох, кредит — буурах (төлбөр, буцаалт)
          эсвэл {statement.company.name}-ийн өглөг. Зөрүүтэй бол баруун хоёр баганад өөрийн бүртгэлээр бөглөнө үү.
        </Text>

        <View style={styles.signBlock}>
          {[statement.company.name, statement.counterparty.name].map((name) => (
            <View key={name} style={styles.signCol}>
              <Text style={styles.strong}>{name}</Text>
              <Text style={{ marginTop: 10 }}>Захирал:</Text>
              <View style={styles.signLine} />
              <Text style={{ marginTop: 10 }}>Нягтлан бодогч:</Text>
              <View style={styles.signLine} />
              <Text style={[styles.label, { marginTop: 4 }]}>/тамга/</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed>
          {statement.company.name} · Entry Accounting системээс үүсгэв
        </Text>
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(statement: CounterpartyStatement): Promise<Buffer> {
  return renderToBuffer(<StatementDocument statement={statement} />);
}
