import { listBundledDocxTemplates } from "@/app/lib/bundled-docx-templates";

export async function GET() {
  return Response.json({ templates: await listBundledDocxTemplates() });
}
