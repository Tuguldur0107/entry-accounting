CREATE TABLE IF NOT EXISTS "ai_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "api_key" text,
  "model" text NOT NULL DEFAULT 'claude-opus-4-8',
  "effort" text NOT NULL DEFAULT 'high',
  "custom_instructions" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "ai_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL REFERENCES "ai_messages"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "media_type" text NOT NULL,
  "data" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_attachments_message_idx" ON "ai_attachments" ("message_id");
