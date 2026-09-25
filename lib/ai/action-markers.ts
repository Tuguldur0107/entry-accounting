// AI tool-ийн үр дүнд хавсрах "action" — үүссэн/өөрчлөгдсөн бизнес объектын
// танигдахуун (lib/ai/tools.ts AiToolResult.action, lib/ai-logging record-tool).
// ЦЭВЭР төрөл — DB/server хамааралгүй. Апп доторх чат (карт зурдаг байсан)
// 2026-09-25-нд хасагдсан; MCP/REST клиент tool-ийн текст хариуг л уншина.

export interface AiAction {
  kind:
    | "voucher"
    | "arap"
    | "cash"
    | "inventory"
    | "fa"
    /** Хангамж: худалдан авалтын захиалга (PO). */
    | "purchase_order"
    /** Хангамж: барааны хүлээн авалт (GR). */
    | "goods_receipt"
    /** POS борлуулалт / буцаалт. */
    | "pos_sale";
  id: string;
  title: string;
  status:
    | "draft"
    | "posted"
    | "confirmed"
    | "active"
    /** PO батлагдаж нээлттэй болсон. */
    | "open"
    /** PO хаагдсан (түр дансууд тэгширсэн). */
    | "closed"
    /** Буцаагдсан баримт (хүлээн авалт, хуваарилалт). */
    | "reversed"
    /** Цуцлагдсан захиалга. */
    | "cancelled";
}
