// Нэхэмжлэхийн PDF — @react-pdf/renderer (сервер талд ажиллана).
// Кирилл: NotoSans (LGC) фонтыг файлаас embed хийнэ.
// Тамга + гарын үсэг: autoStamp үед гарын үсгийн зурган дээгүүр тамга
// давхарлан буудаг (монгол баримтын хэвшил).

import path from "node:path";

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import type { InvoicePayload } from "@/lib/arap/invoice-payload";

const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");

Font.register({
  family: "NotoSans",
  fonts: [
    { src: path.join(FONT_DIR, "NotoSans-Regular.ttf"), fontWeight: "normal" },
    { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});

// PDF бол ЦААС — дэлгэцийн theme-ээс хамааралгүй тул энд утга шууд
// бичигдэнэ (ui-kit-ийн "цаас үргэлж цагаан" зарчимтай ижил).
const INK = "#111111";
const MUTED = "#555555";
const RULE = "#999999";

const styles = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 9,
    color: INK,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  companyName: { fontSize: 12, fontWeight: "bold" },
  small: { fontSize: 8, color: MUTED },
  title: {
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 10,
    letterSpacing: 2,
  },
  docNo: { textAlign: "center", color: MUTED, marginTop: 2, marginBottom: 14 },
  metaGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  metaCol: { maxWidth: "48%" },
  metaLabel: { fontSize: 8, color: MUTED },
  metaValue: { marginBottom: 5 },
  table: { borderTopWidth: 1, borderColor: INK },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: RULE,
    paddingVertical: 4,
  },
  th: { fontWeight: "bold", fontSize: 8 },
  cNo: { width: "6%" },
  cDesc: { width: "48%" },
  cItem: { width: "22%" },
  cQty: { width: "8%", textAlign: "right" },
  cAmount: { width: "16%", textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    borderBottomWidth: 1,
    borderColor: INK,
    paddingVertical: 5,
  },
  bankBlock: { marginTop: 16 },
  signBlock: {
    marginTop: 34,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  signCol: { width: 190, position: "relative" },
  signLineRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 0.5,
    borderColor: INK,
    minHeight: 34,
  },
  signImage: { height: 30, objectFit: "contain", marginBottom: -2 },
  stampImage: {
    position: "absolute",
    width: 86,
    height: 86,
    top: -32,
    left: 6,
    opacity: 0.88,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    textAlign: "center",
    fontSize: 7,
    color: MUTED,
  },
});

const fmt = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function InvoiceDocument({ invoice }: { invoice: InvoicePayload }) {
  const { company, counterparty } = invoice;
  const hasItems = invoice.lines.some((line) => line.itemName);
  const withStamp = company.autoStamp;
  const signatures = company.signatures.length
    ? company.signatures
    : [{ name: "", title: "Захирал", image: "" }];

  return (
    <Document
      title={`Нэхэмжлэх ${invoice.documentNo}`}
      author={company.name || "Entry Accounting"}
    >
      <Page size="A4" style={styles.page}>
        {/* Толгой — компанийн реквизит */}
        <View style={styles.headerRow}>
          <View style={{ maxWidth: "60%" }}>
            <Text style={styles.companyName}>{company.name}</Text>
            {company.registerNo && (
              <Text style={styles.small}>Регистр: {company.registerNo}</Text>
            )}
            {company.vatPayerNo && (
              <Text style={styles.small}>НӨАТ: {company.vatPayerNo}</Text>
            )}
            {company.address && (
              <Text style={styles.small}>{company.address}</Text>
            )}
            <Text style={styles.small}>
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </Text>
          </View>
          {company.logo && (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image
              src={`data:image/png;base64,${company.logo}`}
              style={{ maxHeight: 42, maxWidth: 140, objectFit: "contain" }}
            />
          )}
        </View>

        <Text style={styles.title}>НЭХЭМЖЛЭХ</Text>
        <Text style={styles.docNo}>№ {invoice.documentNo}</Text>

        {/* Худалдан авагч + огноо */}
        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Худалдан авагч</Text>
            <Text style={[styles.metaValue, { fontWeight: "bold" }]}>
              {counterparty.name}
            </Text>
            {counterparty.registerNo && (
              <Text style={styles.small}>Регистр: {counterparty.registerNo}</Text>
            )}
            {counterparty.address && (
              <Text style={styles.small}>{counterparty.address}</Text>
            )}
            <Text style={styles.small}>
              {[counterparty.phone, counterparty.email]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Огноо</Text>
            <Text style={styles.metaValue}>{invoice.date}</Text>
            <Text style={styles.metaLabel}>Төлөх огноо</Text>
            <Text style={styles.metaValue}>{invoice.dueDate}</Text>
            <Text style={styles.metaLabel}>Валют</Text>
            <Text style={styles.metaValue}>{invoice.currency}</Text>
          </View>
        </View>

        {invoice.description ? (
          <Text style={{ marginBottom: 8 }}>
            <Text style={{ color: MUTED }}>Утга: </Text>
            {invoice.description}
          </Text>
        ) : null}

        {/* Мөрүүд */}
        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={[styles.th, styles.cNo]}>№</Text>
            <Text style={[styles.th, hasItems ? styles.cDesc : { width: "78%" }]}>
              Тайлбар
            </Text>
            {hasItems && <Text style={[styles.th, styles.cItem]}>Бараа</Text>}
            {hasItems && <Text style={[styles.th, styles.cQty]}>Тоо</Text>}
            <Text style={[styles.th, styles.cAmount]}>
              Дүн ({invoice.currency})
            </Text>
          </View>
          {invoice.lines.map((line, index) => (
            <View key={index} style={styles.tr}>
              <Text style={styles.cNo}>{index + 1}</Text>
              <Text style={hasItems ? styles.cDesc : { width: "78%" }}>
                {line.description || "—"}
              </Text>
              {hasItems && (
                <Text style={styles.cItem}>{line.itemName ?? ""}</Text>
              )}
              {hasItems && (
                <Text style={styles.cQty}>
                  {line.quantity != null ? String(line.quantity) : ""}
                </Text>
              )}
              <Text style={styles.cAmount}>{fmt(line.amount)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={{ fontWeight: "bold", marginRight: 14 }}>
              НИЙТ ДҮН
            </Text>
            <Text style={[styles.cAmount, { fontWeight: "bold" }]}>
              {fmt(invoice.totalAmount)}
            </Text>
          </View>
          {invoice.paidAmount > 0 && (
            <View style={[styles.totalRow, { borderBottomWidth: 0 }]}>
              <Text style={{ color: MUTED, marginRight: 14 }}>
                Төлсөн: {fmt(invoice.paidAmount)} · Үлдэгдэл:
              </Text>
              <Text style={[styles.cAmount, { fontWeight: "bold" }]}>
                {fmt(invoice.totalAmount - invoice.paidAmount)}
              </Text>
            </View>
          )}
        </View>

        {/* Банкны данс */}
        {company.bankAccounts.length > 0 && (
          <View style={styles.bankBlock}>
            <Text style={[styles.th, { marginBottom: 3 }]}>
              Төлбөр хүлээн авах данс
            </Text>
            {company.bankAccounts.map((account, index) => (
              <Text key={index} style={styles.small}>
                {account.bankName} · {account.accountNo}
                {account.accountName ? ` · ${account.accountName}` : ""}
              </Text>
            ))}
          </View>
        )}

        {/* Гарын үсэг + тамга */}
        <View style={styles.signBlock} wrap={false}>
          {signatures.map((signature, index) => (
            <View key={index} style={styles.signCol}>
              {/* Тамга — зөвхөн ЭХНИЙ гарын үсгэн дээр давхарлана */}
              {withStamp && index === 0 && company.stamp && (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image
                  src={`data:image/png;base64,${company.stamp}`}
                  style={styles.stampImage}
                />
              )}
              <View style={styles.signLineRow}>
                <Text style={{ color: MUTED, fontSize: 8, marginRight: 6 }}>
                  {signature.title}:
                </Text>
                {withStamp && signature.image ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <Image
                    src={`data:image/png;base64,${signature.image}`}
                    style={styles.signImage}
                  />
                ) : (
                  <View style={{ flex: 1 }} />
                )}
              </View>
              <Text style={{ fontSize: 8, marginTop: 3, textAlign: "center" }}>
                {signature.name ? `/${signature.name}/` : "/____________________/"}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed>
          {company.name} · Entry Accounting системээс үүсгэв
        </Text>
      </Page>
    </Document>
  );
}

/** Нэхэмжлэхийн PDF-ийг Buffer болгож буцаана (route, и-мэйл хавсралтад). */
export async function renderInvoicePdf(
  invoice: InvoicePayload
): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument invoice={invoice} />);
}
