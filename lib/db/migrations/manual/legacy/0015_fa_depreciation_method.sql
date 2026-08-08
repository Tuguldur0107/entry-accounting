ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "depreciation_method" text NOT NULL DEFAULT 'straight_line';
