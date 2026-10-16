import { getDocxThumbnail } from "@/app/lib/docx-thumbnail";
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
  const access = getTemplateAccess(request);
  const file =
    (await readStoredTemplateFile(id, access)) ??
    (await readBundledDocxTemplate(id))?.bytes ??
    null;
  if (!file) {
    return Response.json({ error: "Ce modèle n’existe plus." }, { status: 404 });
  }

  const thumbnail = getDocxThumbnail(file);
  if (!thumbnail) {
    return new Response(null, { status: 404 });
  }

  return new Response(new Uint8Array(thumbnail.bytes), {
    headers: {
      "Content-Type": thumbnail.contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
