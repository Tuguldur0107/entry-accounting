ALTER TABLE "ar_ap_documents" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 8) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_ap_documents" ADD COLUMN IF NOT EXISTS "base_total_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_ap_documents" ADD COLUMN IF NOT EXISTS "base_paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_ap_settlements" ADD COLUMN IF NOT EXISTS "base_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD COLUMN IF NOT EXISTS "ar_ap_document_id" uuid;--> statement-breakpoint
UPDATE "ar_ap_documents"
SET
  "base_total_amount" = ROUND("total_amount" * "exchange_rate", 2),
  "base_paid_amount" = ROUND("paid_amount" * "exchange_rate", 2)
WHERE "base_total_amount" = 0 AND "total_amount" <> 0;--> statement-breakpoint
UPDATE "ar_ap_settlements" AS s
SET "base_amount" = ROUND(s."amount" * d."exchange_rate", 2)
FROM "ar_ap_documents" AS d
WHERE s."document_id" = d."id" AND s."base_amount" = 0;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_ar_ap_document_id_ar_ap_documents_id_fk" FOREIGN KEY ("ar_ap_document_id") REFERENCES "public"."ar_ap_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
