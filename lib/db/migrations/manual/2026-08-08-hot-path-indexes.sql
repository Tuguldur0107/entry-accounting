-- Аудит 2026-08-08: hot path индексүүд + draft-first default.
-- Schema.ts-тэй ижил агуулгатай — `npm run db:push` ЭСВЭЛ энэ файлыг шууд
-- ажиллуулж болно (IF NOT EXISTS тул давхар ажиллуулахад аюулгүй).

CREATE INDEX IF NOT EXISTS journal_vouchers_user_date_ix
  ON journal_vouchers (user_id, date);
CREATE INDEX IF NOT EXISTS journal_vouchers_user_status_ix
  ON journal_vouchers (user_id, status);

CREATE INDEX IF NOT EXISTS journal_lines_voucher_ix
  ON journal_lines (voucher_id);
CREATE INDEX IF NOT EXISTS journal_lines_cost_entry_ix
  ON journal_lines (cost_entry_id) WHERE cost_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_lines_inventory_movement_ix
  ON journal_lines (inventory_movement_id) WHERE inventory_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_documents_user_status_ix
  ON cash_documents (user_id, status);
CREATE INDEX IF NOT EXISTS cash_documents_user_date_ix
  ON cash_documents (user_id, date);

CREATE INDEX IF NOT EXISTS ar_ap_documents_user_status_ix
  ON ar_ap_documents (user_id, status);
CREATE INDEX IF NOT EXISTS ar_ap_documents_user_date_ix
  ON ar_ap_documents (user_id, date);

CREATE INDEX IF NOT EXISTS ar_ap_settlements_document_ix
  ON ar_ap_settlements (document_id);
CREATE INDEX IF NOT EXISTS ar_ap_settlements_cash_document_ix
  ON ar_ap_settlements (cash_document_id) WHERE cash_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_user_status_ix
  ON inventory_movements (user_id, status);
CREATE INDEX IF NOT EXISTS inventory_movements_user_date_ix
  ON inventory_movements (user_id, date);

-- Draft-first систем: status-аа мартсан insert аюулгүй талдаа унана.
ALTER TABLE journal_vouchers ALTER COLUMN status SET DEFAULT 'draft';

-- ─── 2-р шат (аудитын үлдсэн засварууд) ─────────────────────────────────────

-- "1 хөдөлгөөнд 1 идэвхтэй үндсэн үнэлгээ" дүрмийн DB backstop.
CREATE UNIQUE INDEX IF NOT EXISTS cost_entries_movement_active_uq
  ON cost_entries (movement_id)
  WHERE movement_id IS NOT NULL AND status <> 'reversed' AND entry_type <> 'landed_cost';
CREATE INDEX IF NOT EXISTS cost_entries_user_status_ix
  ON cost_entries (user_id, status);

-- "Нэг сард 1 идэвхтэй элэгдлийн бичилт" дүрмийн DB backstop.
CREATE UNIQUE INDEX IF NOT EXISTS fa_dep_entries_asset_month_active_uq
  ON fa_depreciation_entries (asset_id, period_month) WHERE status <> 'reversed';

-- GL unpost-ийн буцаалтын журнал эхдээ хамааралтай (cascade хосолсон устгал).
ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS reversal_of_voucher_id uuid;
DO $$ BEGIN
  ALTER TABLE journal_vouchers
    ADD CONSTRAINT journal_vouchers_reversal_of_voucher_id_journal_vouchers_id_fk
    FOREIGN KEY (reversal_of_voucher_id) REFERENCES journal_vouchers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Валютын settlement-ийн ханшийн олз/гарзын данс тохиргоонд (кодод хатуу байсан).
ALTER TABLE costing_account_settings
  ADD COLUMN IF NOT EXISTS fx_gain_account_number text NOT NULL DEFAULT '51800001';
ALTER TABLE costing_account_settings
  ADD COLUMN IF NOT EXISTS fx_loss_account_number text NOT NULL DEFAULT '87000003';

-- ─── НӨАТ модуль (0016_dizzy_corsair-тай ижил) ──────────────────────────────

CREATE TABLE IF NOT EXISTS vat_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  output_vat_account_number text NOT NULL DEFAULT '31410000',
  input_vat_account_number text NOT NULL DEFAULT '13620000',
  vat_rate_percent numeric(5,2) NOT NULL DEFAULT '10',
  updated_at timestamp NOT NULL DEFAULT now()
);
