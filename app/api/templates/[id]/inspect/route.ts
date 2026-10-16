import { inspectTemplate, TemplateError } from "@/app/lib/docx-template";
import { readBundledDocxTemplate } from "@/app/lib/bundled-docx-templates";
import {
  getTemplateAccess,
  readStoredTemplateFile,
} from "@/app/lib/template-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file =
    (await readStoredTemplateFile(id, getTemplateAccess(request))) ??
    (await readBundledDocxTemplate(id))?.bytes ??
    null;
  if (!file) {
    return Response.json({ error: "Ce modèle n’existe plus." }, { status: 404 });
  }

  try {
    return Response.json({ placeholders: inspectTemplate(file) });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
