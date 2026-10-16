import { TemplateError } from "@/app/lib/docx-template";
import {
  listStoredTemplates,
  saveUploadedTemplate,
} from "@/app/lib/template-store";

export async function GET() {
  return Response.json({ templates: await listStoredTemplates() });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { error: "Choisissez un document Word au format DOCX." },
      { status: 400 },
    );
  }

  try {
    const template = await saveUploadedTemplate(file);
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
