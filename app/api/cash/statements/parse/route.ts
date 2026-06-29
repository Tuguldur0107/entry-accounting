import { auth } from "@/lib/auth";
import { parseBankStatementFile } from "@/lib/cash/bank-statement-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File))
      return Response.json({ error: "Файл сонгоно уу" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024)
      return Response.json(
        { error: "Файлын хэмжээ 10MB-аас их байна" },
        { status: 400 }
      );

    const parsed = await parseBankStatementFile(
      file.name,
      await file.arrayBuffer()
    );
    return Response.json(parsed);
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof Error ? caught.message : "Хуулга уншиж чадсангүй",
      },
      { status: 400 }
    );
  }
}

