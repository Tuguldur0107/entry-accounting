ALTER TABLE "journal_vouchers" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "costing_account_settings" ADD COLUMN "fx_gain_account_number" text DEFAULT '51800001' NOT NULL;--> statement-breakpoint
ALTER TABLE "costing_account_settings" ADD COLUMN "fx_loss_account_number" text DEFAULT '87000003' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_vouchers" ADD COLUMN "reversal_of_voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_reversal_of_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("reversal_of_voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ar_ap_documents_user_status_ix" ON "ar_ap_documents" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ar_ap_documents_user_date_ix" ON "ar_ap_documents" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "ar_ap_settlements_document_ix" ON "ar_ap_settlements" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ar_ap_settlements_cash_document_ix" ON "ar_ap_settlements" USING btree ("cash_document_id") WHERE "ar_ap_settlements"."cash_document_id" is not null;--> statement-breakpoint
CREATE INDEX "cash_documents_user_status_ix" ON "cash_documents" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "cash_documents_user_date_ix" ON "cash_documents" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_entries_movement_active_uq" ON "cost_entries" USING btree ("movement_id") WHERE "cost_entries"."movement_id" is not null and "cost_entries"."status" <> 'reversed' and "cost_entries"."entry_type" <> 'landed_cost';--> statement-breakpoint
CREATE INDEX "cost_entries_user_status_ix" ON "cost_entries" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "fa_dep_entries_asset_month_active_uq" ON "fa_depreciation_entries" USING btree ("asset_id","period_month") WHERE "fa_depreciation_entries"."status" <> 'reversed';--> statement-breakpoint
CREATE INDEX "inventory_movements_user_status_ix" ON "inventory_movements" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "inventory_movements_user_date_ix" ON "inventory_movements" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "journal_lines_voucher_ix" ON "journal_lines" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "journal_lines_cost_entry_ix" ON "journal_lines" USING btree ("cost_entry_id") WHERE "journal_lines"."cost_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_lines_inventory_movement_ix" ON "journal_lines" USING btree ("inventory_movement_id") WHERE "journal_lines"."inventory_movement_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_vouchers_user_date_ix" ON "journal_vouchers" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "journal_vouchers_user_status_ix" ON "journal_vouchers" USING btree ("user_id","status");