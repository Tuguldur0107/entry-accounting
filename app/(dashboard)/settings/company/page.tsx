export default function CompanyPage() {
  return (
    <section
      style={{
        background: "var(--ea-surface)",
        border: "1px solid var(--ea-border)",
        borderRadius: 8,
        padding: 24,
        maxWidth: 560,
      }}
    >
      <h2 className="text-base font-medium mb-1" style={{ color: "var(--ea-text-1)" }}>
        Компанийн мэдээлэл
      </h2>
      <p className="text-xs mb-5" style={{ color: "var(--ea-text-3)" }}>
        Компанийн нэр, регистрийн дугаар, хаяг гэх мэт.
      </p>

      <p className="text-sm" style={{ color: "var(--ea-text-3)" }}>
        Энэ хэсэг удахгүй нэмэгдэнэ.
      </p>
    </section>
  );
}
