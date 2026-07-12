ALTER TABLE "cash_fx_revaluations" DROP CONSTRAINT "cash_fx_revaluations_user_id_cash_account_id_valuation_date_unique";--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD COLUMN "exchange_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD COLUMN "base_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "currency" text DEFAULT 'MNT' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD COLUMN "currency" text DEFAULT 'MNT' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD COLUMN "exchange_rate" numeric(18, 8) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD COLUMN "base_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "rate_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "rate_basis" text DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "source_date" text;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "manual_override_reason" text;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "status" text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "reversal_voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "reversed_at" timestamp;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "cash_account_id" uuid;--> statement-breakpoint
UPDATE "cash_documents" AS cd
SET
  "currency" = ca."currency",
  "exchange_rate" = 1,
  "base_amount" = cd."amount"
FROM "cash_accounts" AS ca
WHERE ca."id" = COALESCE(cd."to_cash_account_id", cd."from_cash_account_id");--> statement-breakpoint
UPDATE "bank_statements" AS bs
SET "currency" = ca."currency"
FROM "cash_accounts" AS ca
WHERE ca."id" = bs."cash_account_id";--> statement-breakpoint
UPDATE "bank_statement_lines" AS bsl
SET
  "exchange_rate" = cd."exchange_rate",
  "base_amount" = cd."base_amount"
FROM "cash_documents" AS cd
WHERE cd."id" = bsl."cash_document_id";--> statement-breakpoint
UPDATE "journal_lines" AS jl
SET "cash_account_id" = CASE
  WHEN cd."document_type" = 'receipt' AND jl."debit" <> 0 THEN cd."to_cash_account_id"
  WHEN cd."document_type" = 'payment' AND jl."credit" <> 0 THEN cd."from_cash_account_id"
  WHEN cd."document_type" = 'transfer' AND jl."debit" <> 0 THEN cd."to_cash_account_id"
  WHEN cd."document_type" = 'transfer' AND jl."credit" <> 0 THEN cd."from_cash_account_id"
  ELSE NULL
END
FROM "cash_documents" AS cd
WHERE jl."voucher_id" = cd."voucher_id";--> statement-breakpoint
UPDATE "journal_lines" AS jl
SET "cash_account_id" = CASE
  WHEN cd."document_type" = 'receipt' AND jl."credit" <> 0 THEN cd."to_cash_account_id"
  WHEN cd."document_type" = 'payment' AND jl."debit" <> 0 THEN cd."from_cash_account_id"
  WHEN cd."document_type" = 'transfer' AND jl."credit" <> 0 THEN cd."to_cash_account_id"
  WHEN cd."document_type" = 'transfer' AND jl."debit" <> 0 THEN cd."from_cash_account_id"
  ELSE NULL
END
FROM "cash_documents" AS cd
WHERE jl."voucher_id" = cd."reversal_voucher_id";--> statement-breakpoint
UPDATE "journal_lines" AS jl
SET "cash_account_id" = fx."cash_account_id"
FROM "cash_fx_revaluations" AS fx
JOIN "cash_accounts" AS ca ON ca."id" = fx."cash_account_id"
WHERE
  jl."voucher_id" = fx."voucher_id"
  AND split_part(jl."account_number", '.', 3) = ca."gl_account_number";--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD CONSTRAINT "cash_fx_revaluations_reversal_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("reversal_voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD CONSTRAINT "cash_fx_revaluations_user_id_cash_account_id_valuation_date_revision_unique" UNIQUE("user_id","cash_account_id","valuation_date","revision");
