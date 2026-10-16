import Docxtemplater from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module";
import PizZip from "pizzip";

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function validateTemplateFile(file: File): void {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    throw new TemplateError("Sélectionnez un document au format .docx.");
  }

  if (file.size === 0) {
    throw new TemplateError("Le document sélectionné est vide.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new TemplateError("Le document ne peut pas dépasser 10 Mo.");
  }
}

function loadTemplate(bytes: Uint8Array): {
  doc: Docxtemplater;
  tags: Record<string, unknown>;
} {
  const inspectModule = new InspectModule();

  try {
    const zip = new PizZip(bytes);
    const doc = new Docxtemplater(zip, {
      modules: [inspectModule],
      paragraphLoop: true,
      linebreaks: true,
    });

    return { doc, tags: inspectModule.getAllTags() };
  } catch {
    throw new TemplateError(
      "Impossible de lire ce document. Vérifiez qu’il s’agit d’un fichier DOCX valide avec des variables écrites comme {date}.",
    );
  }
}

function collectPlaceholders(tags: Record<string, unknown>): string[] {
  return Object.keys(tags)
    .filter((name) => name.trim().length > 0)
    .sort((left, right) => left.localeCompare(right, "fr"));
}

export function inspectTemplate(bytes: Uint8Array): string[] {
  const { tags } = loadTemplate(bytes);
  const placeholders = collectPlaceholders(tags);

  if (placeholders.length === 0) {
    throw new TemplateError(
      "Aucune variable n’a été trouvée. Ajoutez des variables simples entre accolades, par exemple {date} ou {nom}.",
    );
  }

  return placeholders;
}

export function generateDocument(
  bytes: Uint8Array,
  values: Record<string, string>,
): Buffer {
  const { doc, tags } = loadTemplate(bytes);
  const placeholders = collectPlaceholders(tags);

  if (placeholders.length === 0) {
    throw new TemplateError("Aucune variable n’a été trouvée dans ce document.");
  }

  const missingValues = placeholders.filter(
    (placeholder) => !values[placeholder]?.trim(),
  );

  if (missingValues.length > 0) {
    throw new TemplateError(
      `Renseignez toutes les variables avant de générer le document : ${missingValues.join(", ")}.`,
    );
  }

  try {
    doc.render(values);
    return doc.toBuffer();
  } catch {
    throw new TemplateError(
      "Impossible de générer le document. Vérifiez que les variables du modèle sont correctement écrites.",
    );
  }
}
