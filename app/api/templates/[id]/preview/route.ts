import { readBundledDocxTemplate } from "@/app/lib/bundled-docx-templates";
import {
  getTemplateAccess,
  getStoredTemplate,
  readStoredTemplateFile,
} from "@/app/lib/template-store";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = getTemplateAccess(request);
  const [template, storedFile] = await Promise.all([
    getStoredTemplate(id, access),
    readStoredTemplateFile(id, access),
  ]);
  const bundledTemplate = storedFile
    ? null
    : await readBundledDocxTemplate(id);
  const file = storedFile ?? bundledTemplate?.bytes ?? null;
  const fileName = template?.name ?? bundledTemplate?.name;

  if (!file || !fileName) {
    return Response.json({ error: "Ce modèle n’existe plus." }, { status: 404 });
  }

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": DOCX_CONTENT_TYPE,
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
