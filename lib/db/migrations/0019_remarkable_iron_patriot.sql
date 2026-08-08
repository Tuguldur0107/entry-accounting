CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"registry_no" text,
	"plan_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_user_id_unique";--> statement-breakpoint
ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_user_id_unique";--> statement-breakpoint
ALTER TABLE "costing_account_settings" DROP CONSTRAINT "costing_account_settings_user_id_unique";--> statement-breakpoint
ALTER TABLE "payroll_settings" DROP CONSTRAINT "payroll_settings_user_id_unique";--> statement-breakpoint
ALTER TABLE "vat_settings" DROP CONSTRAINT "vat_settings_user_id_unique";--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ar_ap_documents" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ar_ap_invoice_sends" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "ar_ap_settlements" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_allocations" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_components" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_period_results" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_pool_rules" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_pools" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "costing_account_settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "costing_item_settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "costing_runs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "fa_depreciation_entries" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_issue_types" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_vouchers" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "module_configs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "production_stages" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "report_line_mappings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "segment_configs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "segment_values" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "vat_settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_ix" ON "memberships" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_ap_documents" ADD CONSTRAINT "ar_ap_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_ap_invoice_sends" ADD CONSTRAINT "ar_ap_invoice_sends_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_ap_settlements" ADD CONSTRAINT "ar_ap_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD CONSTRAINT "cash_fx_revaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_period_results" ADD CONSTRAINT "cost_period_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_pool_rules" ADD CONSTRAINT "cost_pool_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_pools" ADD CONSTRAINT "cost_pools_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costing_account_settings" ADD CONSTRAINT "costing_account_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costing_item_settings" ADD CONSTRAINT "costing_item_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costing_runs" ADD CONSTRAINT "costing_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_depreciation_entries" ADD CONSTRAINT "fa_depreciation_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issue_types" ADD CONSTRAINT "inventory_issue_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_line_mappings" ADD CONSTRAINT "report_line_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_configs" ADD CONSTRAINT "segment_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_values" ADD CONSTRAINT "segment_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_settings" ADD CONSTRAINT "vat_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ar_ap_documents_org_external_ref_uq" ON "ar_ap_documents" USING btree ("organization_id","external_ref") WHERE "ar_ap_documents"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "ar_ap_documents_org_status_ix" ON "ar_ap_documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ar_ap_documents_org_date_ix" ON "ar_ap_documents" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "audit_events_org_created_ix" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_documents_org_external_ref_uq" ON "cash_documents" USING btree ("organization_id","external_ref") WHERE "cash_documents"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "cash_documents_org_status_ix" ON "cash_documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "cash_documents_org_date_ix" ON "cash_documents" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "cost_entries_org_status_ix" ON "cost_entries" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_status_ix" ON "inventory_movements" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_date_ix" ON "inventory_movements" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_vouchers_org_external_ref_uq" ON "journal_vouchers" USING btree ("organization_id","external_ref") WHERE "journal_vouchers"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "journal_vouchers_org_date_ix" ON "journal_vouchers" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "journal_vouchers_org_status_ix" ON "journal_vouchers" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_organization_id_unique" UNIQUE("user_id","organization_id");--> statement-breakpoint
ALTER TABLE "ar_ap_documents" ADD CONSTRAINT "ar_ap_documents_organization_id_document_no_unique" UNIQUE("organization_id","document_no");--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_organization_id_file_hash_unique" UNIQUE("organization_id","file_hash");--> statement-breakpoint
ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_organization_id_document_no_unique" UNIQUE("organization_id","document_no");--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD CONSTRAINT "cash_fx_revaluations_organization_id_cash_account_id_valuation_date_revision_unique" UNIQUE("organization_id","cash_account_id","valuation_date","revision");--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_number_unique" UNIQUE("organization_id","number");--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_organization_id_unique" UNIQUE("organization_id");--> statement-breakpoint
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_organization_id_document_no_unique" UNIQUE("organization_id","document_no");--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "cost_period_results" ADD CONSTRAINT "cost_period_results_organization_id_period_code_item_id_warehouse_id_unique" UNIQUE("organization_id","period_code","item_id","warehouse_id");--> statement-breakpoint
ALTER TABLE "cost_pools" ADD CONSTRAINT "cost_pools_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "costing_account_settings" ADD CONSTRAINT "costing_account_settings_organization_id_unique" UNIQUE("organization_id");--> statement-breakpoint
ALTER TABLE "costing_item_settings" ADD CONSTRAINT "costing_item_settings_organization_id_item_id_unique" UNIQUE("organization_id","item_id");--> statement-breakpoint
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_organization_id_name_unique" UNIQUE("organization_id","name");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_name_unique" UNIQUE("organization_id","name");--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "inventory_issue_types" ADD CONSTRAINT "inventory_issue_types_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_document_no_unique" UNIQUE("organization_id","document_no");--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_organization_id_module_key_unique" UNIQUE("organization_id","module_key");--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_period_month_unique" UNIQUE("organization_id","period_month");--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_organization_id_unique" UNIQUE("organization_id");--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_organization_id_period_code_unique" UNIQUE("organization_id","period_code");--> statement-breakpoint
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_organization_id_code_unique" UNIQUE("organization_id","code");--> statement-breakpoint
ALTER TABLE "report_line_mappings" ADD CONSTRAINT "report_line_mappings_organization_id_report_type_line_key_unique" UNIQUE("organization_id","report_type","line_key");--> statement-breakpoint
ALTER TABLE "segment_configs" ADD CONSTRAINT "segment_configs_organization_id_segment_id_unique" UNIQUE("organization_id","segment_id");--> statement-breakpoint
ALTER TABLE "segment_values" ADD CONSTRAINT "segment_values_organization_id_segment_id_code_unique" UNIQUE("organization_id","segment_id","code");--> statement-breakpoint
ALTER TABLE "vat_settings" ADD CONSTRAINT "vat_settings_organization_id_unique" UNIQUE("organization_id");--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_code_unique" UNIQUE("organization_id","code");