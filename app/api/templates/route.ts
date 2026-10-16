import { TemplateError } from "@/app/lib/docx-template";
import {
  getTemplateAccess,
  listStoredTemplates,
  saveUploadedTemplate,
} from "@/app/lib/template-store";

export async function GET(request: Request) {
  try {
    return Response.json({
      templates: await listStoredTemplates(getTemplateAccess(request)),
    });
  } catch (error) {
    console.error("Unable to list stored DOCX templates", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible de charger les modèles enregistrés.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const access = getTemplateAccess(request);
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { error: "Choisissez un document Word au format DOCX." },
      { status: 400 },
    );
  }

  try {
    const template = await saveUploadedTemplate(file, access);
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Unable to store uploaded DOCX template", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible d’enregistrer le modèle.",
      },
      { status: 502 },
    );
  }
}
