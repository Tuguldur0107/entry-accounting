CREATE TABLE "cash_fx_revaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"valuation_date" text NOT NULL,
	"currency" text NOT NULL,
	"closing_rate" numeric(18, 8) NOT NULL,
	"foreign_balance" numeric(18, 2) NOT NULL,
	"carrying_amount" numeric(18, 2) NOT NULL,
	"revalued_amount" numeric(18, 2) NOT NULL,
	"adjustment_amount" numeric(18, 2) NOT NULL,
	"gain_loss_account_number" text NOT NULL,
	"voucher_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cash_fx_revaluations_user_id_cash_account_id_valuation_date_unique" UNIQUE("user_id","cash_account_id","valuation_date")
);
--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD CONSTRAINT "cash_fx_revaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD CONSTRAINT "cash_fx_revaluations_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_fx_revaluations" ADD CONSTRAINT "cash_fx_revaluations_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE restrict ON UPDATE no action;