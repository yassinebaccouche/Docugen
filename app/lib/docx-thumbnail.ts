import path from "node:path";
import PizZip from "pizzip";
import { TemplateError } from "./docx-template";

export interface DocxThumbnail {
  contentType: string;
  bytes: Buffer;
}

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function attribute(tag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\b${escapedName}=(["'])(.*?)\\1`))?.[2] ?? null;
}

function documentImagePaths(zip: PizZip): string[] {
  const documentXml = zip.file("word/document.xml")?.asText();
  const relationshipsXml = zip.file("word/_rels/document.xml.rels")?.asText();
  if (!documentXml || !relationshipsXml) return [];

  const imageTargets = new Map<string, string>();
  for (const relationship of relationshipsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    const type = attribute(relationship, "Type");
    if (id && target && type?.endsWith("/image")) {
      const imagePath = target.startsWith("/")
        ? target.slice(1)
        : pathPosixNormalize(path.posix.join("word", target));
      imageTargets.set(id, imagePath);
    }
  }

  const imageIds: string[] = [];
  for (const drawing of documentXml.match(/<w:drawing\b[\s\S]*?<\/w:drawing>/g) ?? []) {
    for (const image of drawing.match(/<a:blip\b[^>]*\/?>/g) ?? []) {
      const id = attribute(image, "r:embed");
      if (id && !imageIds.includes(id)) imageIds.push(id);
    }
  }

  return imageIds
    .map((id) => imageTargets.get(id))
    .filter((target): target is string => Boolean(target));
}

function thumbnailPaths(zip: PizZip): string[] {
  return Object.keys(zip.files).filter((fileName) =>
    /^docProps\/thumbnail\.(?:gif|jpe?g|png|webp)$/i.test(fileName),
  );
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "'": "&apos;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function documentTextLines(zip: PizZip): string[] {
  const xml = zip.file("word/document.xml")?.asText();
  if (!xml) return [];
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) =>
    [...match[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((text) =>
        text[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'"),
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return paragraphs.filter(Boolean).slice(0, 9);
}

function makeDocumentPreview(lines: string[]): DocxThumbnail {
  const visibleLines = lines.length ? lines : ["Document généré avec DocuGen"];
  const textElements = visibleLines
    .map((line, index) => {
      const compact = line.length > 32 ? `${line.slice(0, 29)}…` : line;
      const y = 112 + index * 30;
      return `<text x="44" y="${y}" font-family="Arial,sans-serif" font-size="12" fill="#344238">${escapeXml(compact)}</text>`;
    })
    .join("");
  const lineElements = Array.from(
    { length: Math.max(0, 10 - visibleLines.length) },
    (_, index) =>
      `<path d="M44 ${122 + (visibleLines.length + index) * 30}h${index % 3 === 0 ? 226 : 260}" stroke="#e2e8e2" stroke-width="2"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420" viewBox="0 0 320 420"><rect width="320" height="420" rx="12" fill="#eef2ee"/><rect x="25" y="18" width="270" height="384" rx="4" fill="#fff" stroke="#dfe6df"/><path d="M44 65h232" stroke="#e1e8e1" stroke-width="2"/><text x="44" y="48" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#527a59">DOCUMENT GÉNÉRÉ</text>${textElements}${lineElements}</svg>`;
  return { contentType: "image/svg+xml", bytes: Buffer.from(svg) };
}

function pathPosixNormalize(target: string): string {
  const normalized = path.posix.normalize(target);
  return normalized.startsWith("../") ? "" : normalized;
}

/**
 * Returns Word's embedded preview or the first supported raster image in the document body.
 */
export function getDocxThumbnail(bytes: Uint8Array): DocxThumbnail | null {
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch {
    throw new TemplateError("Impossible de lire l’image du modèle DOCX.");
  }

  for (const imagePath of [...thumbnailPaths(zip), ...documentImagePaths(zip)]) {
    const extension = path.posix.extname(imagePath).toLowerCase();
    const contentType = IMAGE_CONTENT_TYPES[extension];
    const image = contentType ? zip.file(imagePath) : null;
    if (image) {
      return {
        contentType,
        bytes: Buffer.from(image.asUint8Array()),
      };
    }
  }

  return makeDocumentPreview(documentTextLines(zip));
}
