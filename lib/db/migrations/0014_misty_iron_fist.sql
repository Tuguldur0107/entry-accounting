CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ar_ap_invoice_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"revoked_at" timestamp,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"viewed_at" timestamp,
	CONSTRAINT "ar_ap_invoice_sends_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"register_no" text,
	"vat_payer_no" text,
	"address" text,
	"phone" text,
	"email" text,
	"bank_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo" text,
	"stamp" text,
	"signatures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_stamp" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "cost_allocation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"base_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"cost_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cost_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_no" text NOT NULL,
	"date" text NOT NULL,
	"cost_component_id" uuid NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"allocation_base" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_allocations_user_id_document_no_unique" UNIQUE("user_id","document_no")
);
--> statement-breakpoint
CREATE TABLE "cost_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"classification" text DEFAULT '' NOT NULL,
	"account_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_components_user_id_code_unique" UNIQUE("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "cost_period_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"period_code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"opening_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"opening_amount" numeric(28, 10) DEFAULT '0' NOT NULL,
	"inbound_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"inbound_amount" numeric(28, 10) DEFAULT '0' NOT NULL,
	"outbound_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"average_unit_cost" numeric(28, 10),
	"outbound_amount" numeric(28, 10),
	"closing_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"closing_amount" numeric(28, 10),
	"qty_balanced" boolean DEFAULT false NOT NULL,
	"amount_balanced" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"block_reason" text,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_period_results_user_id_period_code_item_id_warehouse_id_unique" UNIQUE("user_id","period_code","item_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "cost_pool_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pool_id" uuid NOT NULL,
	"cost_center_code" text,
	"account_prefix" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"stage_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"cost_behavior" text DEFAULT 'variable' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_pools_user_id_code_unique" UNIQUE("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "costing_account_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"clearing_account_number" text NOT NULL,
	"adjustment_gain_account_number" text NOT NULL,
	"adjustment_loss_account_number" text NOT NULL,
	"nrv_expense_account_number" text NOT NULL,
	"nrv_reserve_account_number" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "costing_account_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_issue_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"destination_class" text DEFAULT '' NOT NULL,
	"debit_account_source" text DEFAULT 'fixed' NOT NULL,
	"debit_account_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_issue_types_user_id_code_unique" UNIQUE("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"access_expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "oauth_tokens_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "oauth_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "production_run_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(28, 10) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"source_stage_id" uuid
);
--> statement-breakpoint
CREATE TABLE "production_run_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"quantity" numeric(18, 4) NOT NULL,
	"sales_price" numeric(18, 2),
	"manual_amount" numeric(18, 2),
	"allocated_amount" numeric(18, 2),
	"unit_cost" numeric(28, 10),
	"movement_id" uuid,
	"cost_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "production_run_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"matched_line_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_run_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"allocation_base" text DEFAULT 'sales_value' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"period_code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	CONSTRAINT "production_runs_user_id_period_code_unique" UNIQUE("user_id","period_code")
);
--> statement-breakpoint
CREATE TABLE "production_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_stages_user_id_code_unique" UNIQUE("user_id","code")
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "openai_api_key" text;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "write_mode" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_ap_documents" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "period_code" text;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "issue_type_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "cost_component_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "debit_account_number" text;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "credit_account_number" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "issue_type_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "cost_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "inventory_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_vouchers" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_ap_invoice_sends" ADD CONSTRAINT "ar_ap_invoice_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_ap_invoice_sends" ADD CONSTRAINT "ar_ap_invoice_sends_document_id_ar_ap_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."ar_ap_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_allocation_lines" ADD CONSTRAINT "cost_allocation_lines_allocation_id_cost_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."cost_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_allocation_lines" ADD CONSTRAINT "cost_allocation_lines_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_cost_component_id_cost_components_id_fk" FOREIGN KEY ("cost_component_id") REFERENCES "public"."cost_components"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_period_results" ADD CONSTRAINT "cost_period_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_period_results" ADD CONSTRAINT "cost_period_results_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_period_results" ADD CONSTRAINT "cost_period_results_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_pool_rules" ADD CONSTRAINT "cost_pool_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_pool_rules" ADD CONSTRAINT "cost_pool_rules_pool_id_cost_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."cost_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_pools" ADD CONSTRAINT "cost_pools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_pools" ADD CONSTRAINT "cost_pools_stage_id_production_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."production_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costing_account_settings" ADD CONSTRAINT "costing_account_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_issue_types" ADD CONSTRAINT "inventory_issue_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_stage_id_production_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."production_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_source_stage_id_production_stages_id_fk" FOREIGN KEY ("source_stage_id") REFERENCES "public"."production_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_stage_id_production_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."production_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_cost_entry_id_cost_entries_id_fk" FOREIGN KEY ("cost_entry_id") REFERENCES "public"."cost_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_pools" ADD CONSTRAINT "production_run_pools_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_pools" ADD CONSTRAINT "production_run_pools_pool_id_cost_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."cost_pools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_stages" ADD CONSTRAINT "production_run_stages_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_stages" ADD CONSTRAINT "production_run_stages_stage_id_production_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."production_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_issue_type_id_inventory_issue_types_id_fk" FOREIGN KEY ("issue_type_id") REFERENCES "public"."inventory_issue_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_cost_component_id_cost_components_id_fk" FOREIGN KEY ("cost_component_id") REFERENCES "public"."cost_components"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_issue_type_id_inventory_issue_types_id_fk" FOREIGN KEY ("issue_type_id") REFERENCES "public"."inventory_issue_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ar_ap_documents_user_external_ref_uq" ON "ar_ap_documents" USING btree ("user_id","external_ref") WHERE "ar_ap_documents"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_documents_user_external_ref_uq" ON "cash_documents" USING btree ("user_id","external_ref") WHERE "cash_documents"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_vouchers_user_external_ref_uq" ON "journal_vouchers" USING btree ("user_id","external_ref") WHERE "journal_vouchers"."external_ref" is not null;--> statement-breakpoint
ALTER TABLE "costing_item_settings" DROP COLUMN "cost_method";