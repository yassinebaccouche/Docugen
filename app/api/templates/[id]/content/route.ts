import {
  readEditableParagraphs,
  updateEditableParagraphs,
} from "@/app/lib/docx-editor";
import { TemplateError } from "@/app/lib/docx-template";
import {
  getStoredTemplate,
  readStoredTemplateFile,
  saveEditedTemplate,
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

  try {
    return Response.json({
      template,
      paragraphs: readEditableParagraphs(file),
    });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const template = await getStoredTemplate(id);
  const file = await readStoredTemplateFile(id);
  if (!template || !file) {
    return Response.json({ error: "Ce modèle n’existe plus." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Le contenu transmis n’est pas valide." }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("paragraphs" in body) ||
    !Array.isArray(body.paragraphs) ||
    !body.paragraphs.every(
      (paragraph) => typeof paragraph === "string" && paragraph.length <= 20_000,
    )
  ) {
    return Response.json({ error: "Le contenu transmis n’est pas valide." }, { status: 400 });
  }

  try {
    const updatedFile = updateEditableParagraphs(file, body.paragraphs);
    const savedTemplate = await saveEditedTemplate(id, updatedFile);
    return Response.json({ template: savedTemplate });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
