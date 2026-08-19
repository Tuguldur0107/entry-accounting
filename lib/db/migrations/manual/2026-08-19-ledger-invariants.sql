-- Ledger-ийн DB түвшний invariant-ууд (П26) — UI-г тойрдог бүх замыг
-- (AI, MCP, Excel импорт, batch, гар SQL) хамгаална.
--
-- Тэмдэглэл:
--   * Дүнгийн ТЭМДГИЙГ хязгаарлахгүй — GL-ийн буцаалт улаан сторно
--     (сөрөг дүн) ашигладаг тул debit>=0 CHECK зориуд ТАВИХГҮЙ.
--   * Батлагдсан журналын мөрийг ШИНЭЭР нэмэхийг хориглохгүй — post
--     урсгалууд "posted" ваучер үүсгээд мөрөө дараа нь нэг транзакцад
--     оруулдаг. Тэнцвэрийг commit үед deferred trigger шалгана.
--   * Батлагдсан ваучерыг БҮХЛЭЭР нь устгах нь зөвшөөрөгдсөн урсгал
--     (integrity guard-тай) тул cascade устгалтыг саадгүй өнгөрүүлж,
--     зөвхөн МӨРИЙГ дангаар нь өөрчлөх/устгахыг хориглоно.

-- 1. Нэг мөрөнд Дт, Кт зэрэг бөглөгдөхгүй.
ALTER TABLE journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_dr_xor_cr;
ALTER TABLE journal_lines
  ADD CONSTRAINT journal_lines_dr_xor_cr
  CHECK (NOT (debit <> 0 AND credit <> 0));

-- 2. Батлагдсан/буцаагдсан ваучер бүр commit үед ΣДт=ΣКт (±0.011) байна.
CREATE OR REPLACE FUNCTION ea_assert_voucher_balanced() RETURNS trigger AS $$
DECLARE
  v_id uuid;
  v_status text;
  imbalance numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_vouchers' THEN
    v_id := NEW.id;
  ELSE
    v_id := COALESCE(NEW.voucher_id, OLD.voucher_id);
  END IF;

  SELECT status INTO v_status FROM journal_vouchers WHERE id = v_id;
  -- Ваучер устсан (cascade) эсвэл ноорог — шалгах зүйлгүй.
  IF v_status IS NULL OR v_status NOT IN ('posted', 'reversed') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit - credit), 0) INTO imbalance
  FROM journal_lines WHERE voucher_id = v_id;

  IF ABS(imbalance) > 0.011 THEN
    RAISE EXCEPTION
      'Журнал тэнцэхгүй байна: ваучер %, ΣДт−ΣКт = %', v_id, imbalance;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ea_journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER ea_journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ea_assert_voucher_balanced();

-- Ноорог батлагдах мөч (status UPDATE) мөн шалгагдана.
DROP TRIGGER IF EXISTS ea_journal_vouchers_balanced ON journal_vouchers;
CREATE CONSTRAINT TRIGGER ea_journal_vouchers_balanced
  AFTER UPDATE OF status ON journal_vouchers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('posted', 'reversed'))
  EXECUTE FUNCTION ea_assert_voucher_balanced();

-- 3. Батлагдсан/буцаагдсан ваучерын мөрийг дангаар өөрчлөх/устгахыг хориглоно.
--    (Ваучераа БҮХЛЭЭР нь устгахад эцэг мөр эхэлж устдаг тул доорх SELECT
--    юу ч олохгүй → cascade саадгүй.)
CREATE OR REPLACE FUNCTION ea_protect_posted_lines() RETURNS trigger AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM journal_vouchers WHERE id = OLD.voucher_id;
  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION
      'Батлагдсан журналын мөрийг өөрчлөх/устгах хориотой — буцаалтаар засна (voucher %)',
      OLD.voucher_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ea_journal_lines_protect ON journal_lines;
CREATE TRIGGER ea_journal_lines_protect
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION ea_protect_posted_lines();
