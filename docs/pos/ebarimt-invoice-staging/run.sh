#!/usr/bin/env bash
# eBarimt НЭХЭМЖЛЭХИЙН staging тест — docs/pos/05-ebarimt-invoice-plan.md §4.
#
# ЗӨВХӨН STAGING PosAPI-д (st-operator / stg-invoice орчинд бүртгэсэн тест
# мерчант). Production PosAPI-д ХЭЗЭЭ Ч ажиллуулахгүй — бодит нэхэмжлэх ТЕГ-д
# бүртгэгдэнэ. Монголын сүлжээнээс (api.ebarimt.mn гео-хязгаар).
#
# Суурь payload (invoice-b2b.json) нь Entry-ийн buildEbarimtReceipt-ийн гаралт
# (lib/ebarimt/receipt.ts) — бодит хүсэлттэй ижил бүтэц.
#
# Хариунаас сугалаа (lottery) ба QR (qrData)-г ХАДГАЛАХГҮЙ (гарын авлага §5
# хориглодог) — зөвхөн «сугалаа ирсэн эсэх»-ийг тэмдэглэнэ.
#
# Ашиглах:
#   STAGING=yes POSAPI=http://localhost:7080 MERCHANT_TIN=... BUYER_TIN=... \
#     POS_NO=... DISTRICT=2301 ./run.sh
# Үр дүн: ./results/<тест>.json (+ summary.txt) — энэ хавтсыг Entry багт илгээнэ.
set -euo pipefail

[ "${STAGING:-}" = "yes" ] || { echo "STAGING=yes заавал — зөвхөн staging PosAPI-д ажиллуулна" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq суулгана уу" >&2; exit 1; }
POSAPI=${POSAPI:-http://localhost:7080}
: "${MERCHANT_TIN:?staging мерчантын ТТД}"
: "${BUYER_TIN:?staging худалдан авагч байгууллагын ТТД (B2B)}"
: "${POS_NO:?staging PosAPI-ийн posNo (/rest/info)}"
DISTRICT=${DISTRICT:-2301}
DIR=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-./results}
mkdir -p "$OUT"
STAMP=$(date +%m%d)
# Тоолуур ФАЙЛД — $(...) дэд shell дотор ч billIdSuffix давтагдахгүй
: > "$OUT/.counter"

base() {
  jq --arg m "$MERCHANT_TIN" --arg b "$BUYER_TIN" --arg p "$POS_NO" --arg d "$DISTRICT" \
    '.merchantTin=$m | .receipts[0].merchantTin=$m | .customerTin=$b | .posNo=$p | .districtCode=$d' \
    "$DIR/invoice-b2b.json"
}

# $1 тестийн нэр, stdin payload → POST, сугалаа/QR-гүй хариу хадгална, ДДТД-г хэвлэнэ
post() {
  local name=$1 payload n
  echo x >> "$OUT/.counter"; n=$(wc -l < "$OUT/.counter" | tr -d ' ')
  payload=$(jq --arg s "8${STAMP}$(printf '%03d' "$n")" '.billIdSuffix=$s')
  echo "$payload" > "$OUT/$name.request.json"
  # Нэг хувилбар унасан ч бусад нь үргэлжилнэ: curl алдаа / JSON биш хариуг ил тэмдэглэнэ
  local raw http
  raw=$(mktemp)
  http=$(curl -sS -o "$raw" -w '%{http_code}' -X POST "$POSAPI/rest/receipt" \
    -H 'Content-Type: application/json' -d "$payload" 2>>"$OUT/curl-errors.log" || echo "000")
  if jq -e . "$raw" >/dev/null 2>&1; then
    jq --arg h "$http" '{http: $h, hasLottery: ((.lottery // "") | length > 0)} + (del(.lottery, .qrData)
          | if (.receipts | type) == "array" then .receipts |= map(del(.lottery, .qrData)) else . end)' \
      "$raw" > "$OUT/$name.json"
  else
    jq -n --arg h "$http" --arg b "$(head -c 500 "$raw")" '{http: $h, status: "NOT_JSON", message: $b, hasLottery: false}' \
      > "$OUT/$name.json"
  fi
  rm -f "$raw"
  printf '%-34s status=%s id=%s lottery=%s message=%s\n' "$name" \
    "$(jq -r '.status // "-"' "$OUT/$name.json")" "$(jq -r '.id // "-"' "$OUT/$name.json")" \
    "$(jq -r '.hasLottery' "$OUT/$name.json")" "$(jq -r '.message // ""' "$OUT/$name.json")" | tee -a "$OUT/summary.txt"
}
ddtd() { jq -r '.id // empty' "$OUT/$1.json"; }

echo "== $(date -Iseconds) $POSAPI" | tee -a "$OUT/summary.txt"
curl -sS "$POSAPI/rest/info" | jq '{operatorTIN, posNo, version: .appInfo.version, merchants: [.merchants[]?.tin]}' | tee "$OUT/info.json"

# Q2 — төлөгдөөгүй хэсгийн payments[].code ба status
base | post T1a_b2b_invoice_code_INVOICE_PAY
base | jq '.payments[0].code="BANK_TRANSFER"' | post T1b_b2b_invoice_code_BANK_TRANSFER_PAY
base | jq '.payments[0].code="CASH"' | post T1c_b2b_invoice_code_CASH_PAY
base | jq 'del(.payments)' | post T1d_b2b_invoice_no_payments

# Амжилттай болсон анхны нэхэмжлэхийг сонгоно (T1a → T1b → T1c → T1d)
INV=""; INV_TEST=""
for t in T1a_b2b_invoice_code_INVOICE_PAY T1b_b2b_invoice_code_BANK_TRANSFER_PAY T1c_b2b_invoice_code_CASH_PAY T1d_b2b_invoice_no_payments; do
  id=$(ddtd "$t"); if [ -n "$id" ]; then INV=$id; INV_TEST=$t; break; fi
done
if [ -z "$INV" ]; then echo "Нэхэмжлэх нэг ч амжилттай үүссэнгүй — T3–T5 алгаслаа" | tee -a "$OUT/summary.txt"; exit 0; fi
echo "Суурь нэхэмжлэх: $INV_TEST ($INV)" | tee -a "$OUT/summary.txt"
INV_REQ="$OUT/$INV_TEST.request.json"

# Q4 — иргэнд нэхэмжлэх (амжилттай болсон төлбөрийн бүтцээр): сугалаа ирэх үү
jq 'del(.customerTin) | .type="B2C_INVOICE"' "$INV_REQ" | post T2_b2c_invoice_lottery

# Q1/Q3 — төлөлт. Хувилбар бүрийг ӨӨР нэхэмжлэх дээр (хоорондоо нөлөөлөхгүй)
new_invoice() { jq 'del(.billIdSuffix)' "$INV_REQ" | post "$1" >&2; ddtd "$1"; }

I1=$(new_invoice T3a_base)
[ -n "$I1" ] && jq --arg i "$I1" '.inactiveId=$i | .type="B2B_RECEIPT" | .payments=[{code:"BANK_TRANSFER",status:"PAID",paidAmount:1100000}]' "$INV_REQ" \
  | post T3a_pay_full_as_B2B_RECEIPT_inactiveId

I2=$(new_invoice T3b_base)
[ -n "$I2" ] && jq --arg i "$I2" '.inactiveId=$i | .payments=[{code:"BANK_TRANSFER",status:"PAID",paidAmount:1100000}]' "$INV_REQ" \
  | post T3b_pay_full_as_INVOICE_PAID_inactiveId

I3=$(new_invoice T4_base)
[ -n "$I3" ] && jq --arg i "$I3" --arg c "$(jq -r '.payments[0].code // "INVOICE"' "$INV_REQ")" \
  '.inactiveId=$i | .payments=[{code:"BANK_TRANSFER",status:"PAID",paidAmount:440000},{code:$c,status:"PAY",paidAmount:660000}]' "$INV_REQ" \
  | post T4_pay_partial_440k_inactiveId

# Q5 — нэхэмжлэхийг цуцлах (DELETE)
I4=$(new_invoice T5_base)
if [ -n "$I4" ]; then
  D=$(jq -r '.date // empty' "$OUT/T5_base.json")
  code=$(curl -sS -o "$OUT/T5_delete.body" -w '%{http_code}' -X DELETE "$POSAPI/rest/receipt" \
    -H 'Content-Type: application/json' -d "{\"id\":\"$I4\",\"date\":\"$D\"}" 2>>"$OUT/curl-errors.log" || echo "000")
  echo "T5_delete_invoice                  http=$code body=$(head -c 300 "$OUT/T5_delete.body")" | tee -a "$OUT/summary.txt"
fi

# Q6 — өмнөх сараар (reportMonth) төлөлт
I5=$(new_invoice T6_base)
PREV=$(date -d "$(date +%Y-%m-01) -1 day" +%Y-%m-01 2>/dev/null || date -v1d -v-1m +%Y-%m-01)
[ -n "$I5" ] && jq --arg i "$I5" --arg r "$PREV" '.inactiveId=$i | .reportMonth=$r | .payments=[{code:"BANK_TRANSFER",status:"PAID",paidAmount:1100000}]' "$INV_REQ" \
  | post T6_pay_reportMonth_prev

curl -sS -X GET "$POSAPI/rest/sendData" >/dev/null 2>&1 || true
echo "Дууслаа. stg-invoice.ebarimt.mn-д нэвтэрч §4.3-ийн гар шалгалтыг хийгээд $OUT хавтсыг илгээнэ үү." | tee -a "$OUT/summary.txt"
