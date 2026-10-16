import { inspectTemplate, TemplateError, validateTemplateFile } from "@/app/lib/docx-template";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { error: "Choisissez un document DOCX à analyser." },
      { status: 400 },
    );
  }

  try {
    validateTemplateFile(file);
    const placeholders = inspectTemplate(new Uint8Array(await file.arrayBuffer()));
    return Response.json({ placeholders });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
}
