import {
  getStoredTemplate,
  readStoredTemplateFile,
} from "@/app/lib/template-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [template, file] = await Promise.all([
    getStoredTemplate(id),
    readStoredTemplateFile(id),
  ]);
  if (!template || !file) {
    return Response.json({ error: "Ce modèle n’existe plus." }, { status: 404 });
  }

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.name)}`,
      "Cache-Control": "no-store",
    },
  });
}
