import { getStoredTemplate } from "@/app/lib/template-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const template = await getStoredTemplate(id);
  if (!template) {
    return Response.json({ error: "Ce modèle n’existe plus." }, { status: 404 });
  }
  return Response.json({ template });
}
