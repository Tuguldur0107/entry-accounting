ALTER TABLE "cost_entries" ALTER COLUMN "movement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;