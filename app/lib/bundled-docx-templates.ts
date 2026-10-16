import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const DOCX_DIRECTORY = path.resolve(process.cwd(), "app", "Docx");
const ID_PREFIX = "docx-";

export interface BundledDocxTemplate {
  id: string;
  name: string;
}

function templateId(fileName: string): string {
  return `${ID_PREFIX}${Buffer.from(fileName, "utf8").toString("base64url")}`;
}

function fileNameFromId(id: string): string | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  try {
    const fileName = Buffer.from(id.slice(ID_PREFIX.length), "base64url").toString("utf8");
    if (
      !fileName.toLowerCase().endsWith(".docx") ||
      path.basename(fileName) !== fileName ||
      fileName.includes("\0")
    ) {
      return null;
    }
    return fileName;
  } catch {
    return null;
  }
}

export async function listBundledDocxTemplates(): Promise<BundledDocxTemplate[]> {
  const entries = await readdir(DOCX_DIRECTORY, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".docx"))
    .map((entry) => ({ id: templateId(entry.name), name: entry.name }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

export async function readBundledDocxTemplate(id: string): Promise<{
  name: string;
  bytes: Buffer;
} | null> {
  const fileName = fileNameFromId(id);
  if (!fileName) return null;

  const availableTemplates = await listBundledDocxTemplates();
  if (!availableTemplates.some((template) => template.id === id)) return null;

  try {
    return {
      name: fileName,
      bytes: await readFile(path.join(DOCX_DIRECTORY, fileName)),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}
