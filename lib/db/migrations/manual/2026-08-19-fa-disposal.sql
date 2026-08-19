-- ҮХ данснаас хасалт (актлах/борлуулах/бэлэглэх) — fixed_assets-д хасалтын талбарууд.
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_type" text;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_date" text;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_proceeds" numeric(18,2);
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_voucher_id" uuid REFERENCES "journal_vouchers"("id") ON DELETE set null;
