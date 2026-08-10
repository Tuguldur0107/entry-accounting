-- Урилга: бүртгэлгүй и-мэйл рүү илгээж, register үед token-оор гишүүнчлэл идэвхжинэ.
CREATE TABLE IF NOT EXISTS "org_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "email" text NOT NULL,
  "role" text DEFAULT 'accountant' NOT NULL,
  "token" uuid DEFAULT gen_random_uuid() NOT NULL,
  "invited_by" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "accepted_at" timestamp,
  CONSTRAINT "org_invitations_token_unique" UNIQUE("token")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_invitations_pending_ux"
  ON "org_invitations" ("organization_id", "email")
  WHERE "accepted_at" is null;
