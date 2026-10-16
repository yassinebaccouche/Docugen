import {
  createEditorConfig,
  getTemplateAccess,
  getStoredTemplate,
} from "@/app/lib/template-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const template = await getStoredTemplate(id, getTemplateAccess(request));
  if (!template) {
    return Response.json({ error: "Ce modèle n’existe plus." }, { status: 404 });
  }

  try {
    return Response.json({
      template,
      editor: createEditorConfig(template),
    });
  } catch (error) {
    console.error("Unable to configure the Word editor", error);
    return Response.json(
      {
        error:
          "L’éditeur Word n’est pas configuré. Vérifiez l’adresse du serveur ONLYOFFICE et son secret JWT.",
      },
      { status: 503 },
    );
  }
}
