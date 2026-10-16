import PizZip from "pizzip";
import { TemplateError } from "./docx-template";

export interface EditableParagraph {
  text: string;
  style: string;
  alignment: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Keeps unchanged leading/trailing text in its original Word runs so their formatting survives edits.
 */
function preserveRunText(oldParts: string[], newText: string): string[] {
  const oldText = oldParts.join("");
  let prefixLength = 0;
  while (
    prefixLength < oldText.length &&
    prefixLength < newText.length &&
    oldText[prefixLength] === newText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldText.length - prefixLength &&
    suffixLength < newText.length - prefixLength &&
    oldText[oldText.length - suffixLength - 1] ===
      newText[newText.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const prefixParts = oldParts.map(() => "");
  let offset = 0;
  for (let index = 0; index < oldParts.length; index += 1) {
    const part = oldParts[index];
    const retained = Math.max(0, Math.min(part.length, prefixLength - offset));
    prefixParts[index] = part.slice(0, retained);
    offset += part.length;
  }

  let targetIndex = oldParts.length - 1;
  offset = 0;
  for (let index = 0; index < oldParts.length; index += 1) {
    const nextOffset = offset + oldParts[index].length;
    if (prefixLength <= nextOffset) {
      targetIndex = index;
      break;
    }
    offset = nextOffset;
  }
  const replacement = newText.slice(prefixLength, newText.length - suffixLength);

  let remainingSuffix = suffixLength;
  const suffixParts = oldParts.map(() => "");
  for (let index = oldParts.length - 1; index >= 0; index -= 1) {
    const retained = Math.min(oldParts[index].length, remainingSuffix);
    suffixParts[index] = oldParts[index].slice(oldParts[index].length - retained);
    remainingSuffix -= retained;
  }

  return oldParts.map(
    (_, index) =>
      prefixParts[index] +
      (index === targetIndex ? replacement : "") +
      suffixParts[index],
  );
}

function getDocumentXml(bytes: Uint8Array): {
  zip: PizZip;
  xml: string;
} {
  try {
    const zip = new PizZip(bytes);
    const document = zip.file("word/document.xml");
    if (!document) throw new Error("Missing document.xml");
    return { zip, xml: document.asText() };
  } catch {
    throw new TemplateError("Impossible d’ouvrir ce document DOCX.");
  }
}

/** Reads the editable text and basic paragraph presentation from the DOCX body. */
export function readEditableParagraphs(bytes: Uint8Array): EditableParagraph[] {
  const { xml } = getDocumentXml(bytes);
  const paragraphXml = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];

  return paragraphXml.map((paragraph) => {
    const text = Array.from(
      paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),
      (match) => decodeXml(match[1]),
    ).join("");
    const style = paragraph.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] ?? "";
    const alignment =
      paragraph.match(/<w:jc\b[^>]*w:val="([^"]+)"/)?.[1] ?? "left";

    return { text, style, alignment };
  });
}

/** Replaces paragraph text while leaving the rest of the DOCX package untouched. */
export function updateEditableParagraphs(
  bytes: Uint8Array,
  paragraphs: string[],
): Buffer {
  const { zip, xml } = getDocumentXml(bytes);
  let index = 0;
  const updatedXml = xml.replace(
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
    (paragraphXml) => {
      const newText = paragraphs[index];
      index += 1;
      if (typeof newText !== "string") {
        throw new TemplateError("Le document a reçu un contenu de paragraphe invalide.");
      }

      const textNodes = Array.from(
        paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),
      );
      const oldParts = textNodes.map((match) => decodeXml(match[1]));
      const oldText = oldParts.join("");
      if (oldText === newText) return paragraphXml;

      if (textNodes.length === 0) {
        const run = `<w:r><w:t xml:space="preserve">${encodeXml(newText)}</w:t></w:r>`;
        return paragraphXml.replace(/<\/w:pPr>/, `</w:pPr>${run}`).replace(
          /^(<w:p(?:\s[^>]*)?>)/,
          (start) => (paragraphXml.includes("</w:pPr>") ? start : `${start}${run}`),
        );
      }

      const newParts = preserveRunText(oldParts, newText);
      let nodeIndex = 0;
      const updatedParagraph = paragraphXml.replace(
        /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g,
        () => {
          const content = `<w:t xml:space="preserve">${encodeXml(newParts[nodeIndex])}</w:t>`;
          nodeIndex += 1;
          return content;
        },
      );
      return updatedParagraph;
    },
  );

  if (index !== paragraphs.length) {
    throw new TemplateError("Le contenu reçu ne correspond plus au document.");
  }

  zip.file("word/document.xml", updatedXml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
