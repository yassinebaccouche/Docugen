import { readBundledDocxTemplate } from "@/app/lib/bundled-docx-templates";
import { saveUploadedTemplate } from "@/app/lib/template-store";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bundledTemplate = await readBundledDocxTemplate(id);
  if (!bundledTemplate) {
    return Response.json({ error: "Ce modèle DOCX n’existe plus." }, { status: 404 });
  }

  try {
    const file = new File(
      [new Uint8Array(bundledTemplate.bytes)],
      bundledTemplate.name,
      {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    );
    const template = await saveUploadedTemplate(file);
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    console.error("Unable to add a bundled DOCX template to the document library", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? `Impossible d’ajouter le modèle à votre bibliothèque : ${error.message}`
            : "Impossible d’ajouter le modèle à votre bibliothèque.",
      },
      { status: 502 },
    );
  }
}
