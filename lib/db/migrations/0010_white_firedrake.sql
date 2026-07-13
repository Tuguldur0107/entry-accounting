ALTER TABLE "inventory_movements" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "warehouse_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_ap_document_lines" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "ar_ap_document_lines" ADD COLUMN "quantity" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "ar_ap_document_lines" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "ar_ap_document_lines" ADD CONSTRAINT "ar_ap_document_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_ap_document_lines" ADD CONSTRAINT "ar_ap_document_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;