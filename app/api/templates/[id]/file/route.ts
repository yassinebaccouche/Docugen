import {
  getStoredTemplate,
  readStoredTemplateFile,
} from "@/app/lib/template-store";
import { verifyOnlyOfficeToken } from "@/app/lib/onlyoffice";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const claims = verifyOnlyOfficeToken(token);
  if (!claims || claims.purpose !== "document" || claims.templateId !== id) {
    return Response.json({ error: "Accès au document non autorisé." }, { status: 401 });
  }

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
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(template.name)}`,
      "Cache-Control": "no-store",
    },
  });
}
