import PizZip from "pizzip";
import { readBundledDocxTemplate } from "@/app/lib/bundled-docx-templates";
import {
  inspectTemplate,
  generateDocument,
  TemplateError,
  validateTemplateFile,
} from "@/app/lib/docx-template";
import { readSpreadsheetRows } from "@/app/lib/spreadsheet";
import {
  getTemplateAccess,
  getStoredTemplate,
  readStoredTemplateFile,
} from "@/app/lib/template-store";

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

export async function POST(request: Request) {
  const access = getTemplateAccess(request);
  const formData = await request.formData();
  const file = formData.get("file");
  const templateId = formData.get("templateId");
  const rawValues = formData.get("values");
  const rawAnonymousAllowance = formData.get("anonymousDocumentAllowance");
  let anonymousAllowance: number | null = null;
  if (rawAnonymousAllowance !== null) {
    const parsedAllowance = Number(rawAnonymousAllowance);
    if (
      typeof rawAnonymousAllowance !== "string" ||
      !Number.isSafeInteger(parsedAllowance) ||
      parsedAllowance < 0 ||
      parsedAllowance > 5
    ) {
      return Response.json(
        { error: "La limite anonyme transmise n’est pas valide." },
        { status: 400 },
      );
    }
    anonymousAllowance = parsedAllowance;
  }

  let templateBytes: Buffer;
  let templateName: string;
  if (typeof templateId === "string") {
    const bundledTemplate = await readBundledDocxTemplate(templateId);
    if (bundledTemplate) {
      templateBytes = bundledTemplate.bytes;
      templateName = bundledTemplate.name;
    } else {
      const [template, storedFile] = await Promise.all([
        getStoredTemplate(templateId, access),
        readStoredTemplateFile(templateId, access),
      ]);
      if (!template || !storedFile) {
        return Response.json(
          { error: "Ce modèle n’existe plus. Importez-le à nouveau." },
          { status: 404 },
        );
      }
      templateBytes = storedFile;
      templateName = template.name;
    }
  } else if (file instanceof File) {
    try {
      validateTemplateFile(file);
    } catch (error) {
      if (error instanceof TemplateError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    templateBytes = Buffer.from(await file.arrayBuffer());
    templateName = file.name;
  } else {
    return Response.json(
      { error: "Choisissez un document DOCX à générer." },
      { status: 400 },
    );
  }

  const spreadsheet = formData.get("spreadsheet");
  if (spreadsheet instanceof File) {
    try {
      const placeholders = inspectTemplate(templateBytes);
      const rows = await readSpreadsheetRows(spreadsheet, placeholders);
      if (anonymousAllowance !== null && rows.length > anonymousAllowance) {
        return Response.json(
          {
            error:
              "Cette génération dépasse votre quota gratuit restant. Connectez-vous pour générer ces documents.",
            code: "AUTH_REQUIRED",
          },
          { status: 403 },
        );
      }
      const archive = new PizZip();
      const baseName = templateName.replace(/\.docx$/i, "");

      rows.forEach((values, index) => {
        const output = generateDocument(templateBytes, values);
        archive.file(
          `${baseName}-${String(index + 1).padStart(3, "0")}.docx`,
          output,
        );
      });

      const zip = archive.generate({
        type: "nodebuffer",
        compression: "DEFLATE",
      });
      return new Response(new Uint8Array(zip), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="documents-generes.zip"',
          "X-Generated-Document-Count": String(rows.length),
        },
      });
    } catch (error) {
      if (error instanceof TemplateError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  if (typeof rawValues !== "string") {
    return Response.json(
      { error: "Les valeurs du document sont manquantes." },
      { status: 400 },
    );
  }

  let values: unknown;
  try {
    values = JSON.parse(rawValues);
  } catch {
    return Response.json(
      { error: "Les valeurs transmises ne sont pas valides." },
      { status: 400 },
    );
  }

  if (!isStringRecord(values)) {
    return Response.json(
      { error: "Les valeurs transmises ne sont pas valides." },
      { status: 400 },
    );
  }

  if (anonymousAllowance !== null && anonymousAllowance < 1) {
    return Response.json(
      {
        error:
          "Vous avez utilisé vos documents gratuits. Connectez-vous pour continuer.",
        code: "AUTH_REQUIRED",
      },
      { status: 403 },
    );
  }

  try {
    const output = generateDocument(templateBytes, values);
    const filename = templateName.replace(/\.docx$/i, "-complete.docx");

    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Generated-Document-Count": "1",
      },
    });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
}
