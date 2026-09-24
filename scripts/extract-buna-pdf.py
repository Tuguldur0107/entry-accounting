#!/usr/bin/env python3
"""ҮСХ-ын АЛБАН «Бүтээгдэхүүн, үйлчилгээний нэгдсэн ангилал» (БҮНА, 2011) PDF-ээс
eBarimt-ийн 7 оронтой ангиллын кодыг CSV болгон гаргана.

    pip install pymupdf
    python3 scripts/extract-buna-pdf.py "buteegdehuun uilchilgeenii negdsen angilal.pdf" buna.csv
    node scripts/build-ebarimt-classifications.mjs buna.csv

Яагаад PDF: мерчантын багцын `gs1_gs1.xlsx` нь PDF-ээс хөрвүүлсэн, алдагдалтай —
Excel тэргүүлэх 0-ийг хассан (0111100 → 111100), урт нэрс мөрийн дундаас
тасарсан, «Revised» хуудсанд хуудасны дугаар / хуваагдсан үг холилдсон.

PDF-ийн хүснэгт (хуудас 4–91) баганын X байрлалаар тогтмол: бүлэг (3) · анги (4) ·
дэд анги (5) · 7 оронтой код · нэр. Олон мөр дамнасан нэрийг нийлүүлнэ, хуудасны
дугаарыг (доод хүрээ) хасна. Код ЗОХИОХГҮЙ — хэвлэгдсэн кодыг яг хэвээр нь авна;
эх баримтын зөрчлийг (давхардсан код, дэд ангийн угтвартай таарахгүй код) ИЛ
хэвлэнэ. Давхардсан кодоос дэд ангийнхаа угтвартай ТААРСАН мөр үлдэнэ.
"""

import csv
import re
import sys

import pymupdf

TABLE_PAGES = range(3, 91)  # 0-based: хуудас 4..91 — 92-оос тайлбарын хэсэг
NAME_X = 165  # нэрийн багана ≈173pt, кодын баганууд < 140pt
FOOTER_Y = 750  # хуудасны дугаар ≈768pt
ROW_TOLERANCE = 3
# PDF-ийн глифийн задрал: «т өрлийн», «б үтээлэг» → нэг үг (гийгүүлэгч + ү/ө).
SPLIT_WORD = re.compile(r"(?<![а-яөүёА-ЯӨҮЁ])([бвгджзклмнпрстфхцчшщ]) ([үө][а-яөүё])")


def page_rows(page):
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            if not text.strip() or line["bbox"][1] > FOOTER_Y:
                continue
            lines.append((round(line["bbox"][1]), line["bbox"][0], text))
    lines.sort()
    rows = []
    for y, x, text in lines:
        if rows and abs(rows[-1][0] - y) <= ROW_TOLERANCE:
            rows[-1][1].append((x, text))
        else:
            rows.append([y, [(x, text)]])
    return [sorted(parts) for _, parts in rows]


def extract(path):
    doc = pymupdf.open(path)
    records, current, subclass = [], None, None
    for page_no in TABLE_PAGES:
        for parts in page_rows(doc[page_no]):
            codes, name, header = [], [], False
            for x, text in parts:
                if x >= NAME_X:
                    name.append(text.strip())
                    continue
                tokens = text.split()
                k = 0
                while k < len(tokens) and tokens[k].isdigit():
                    k += 1
                if k == 0 and tokens:
                    header = True  # «ДЭД САЛБАР 02» г.м.
                codes += tokens[:k]
                if tokens[k:]:
                    name.append(" ".join(tokens[k:]))  # код + нэр нэг span-д
            name = " ".join(name).strip()
            if header:
                current = None
                continue
            if not codes:
                if current is not None and name:
                    current["name"] += " " + name  # олон мөрт нэр
                continue
            fives = [c for c in codes if len(c) == 5]
            if fives:
                subclass = fives[-1]
            sevens = [c for c in codes if len(c) == 7]
            if not sevens:
                current = None
                continue
            current = {"code": sevens[0], "name": name, "page": page_no + 1, "subclass": subclass}
            records.append(current)
    for record in records:
        record["name"] = SPLIT_WORD.sub(r"\1\2", re.sub(r"\s+", " ", record["name"]).strip())
    return records


def main():
    if len(sys.argv) != 3:
        sys.exit("Хэрэглээ: python3 scripts/extract-buna-pdf.py <БҮНА.pdf> <гаралт.csv>")
    records = extract(sys.argv[1])
    by_code = {}
    for record in records:
        record["fits"] = bool(record["subclass"]) and record["code"].startswith(record["subclass"][:4])
        if not record["fits"]:
            print(f"  эх баримтад: {record['code']} дэд анги {record['subclass']}-тай таарахгүй (х.{record['page']}) — хэвлэснээр нь авав")
        previous = by_code.get(record["code"])
        if previous is None:
            by_code[record["code"]] = record
            continue
        keep, drop = (record, previous) if record["fits"] and not previous["fits"] else (previous, record)
        print(f"  эх баримтад давхардсан {record['code']}: «{keep['name']}» үлдээж, «{drop['name']}» хасав (х.{record['page']})")
        by_code[record["code"]] = keep
    empty = [r for r in by_code.values() if not r["name"]]
    if empty:
        sys.exit(f"Нэргүй код: {[r['code'] for r in empty]}")
    with open(sys.argv[2], "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(["code", "name"])
        for code in sorted(by_code):
            writer.writerow([code, by_code[code]["name"]])
    print(f"✔ {len(by_code)} код ({len(records)} мөр) → {sys.argv[2]}")


if __name__ == "__main__":
    main()
