import PizZip from "pizzip";
import { CLOUDINARY_CLOUD_NAME } from "@/app/lib/cloudinary";

const CLOUDINARY_HOST = "res.cloudinary.com";
const MAX_FOLDER_FILES = 200;
const MAX_FOLDER_BYTES = 250 * 1024 * 1024;

interface DownloadFileRequest {
  url: string;
  fileName: string;
}

function isDownloadFileRequest(value: unknown): value is DownloadFileRequest {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return typeof file.url === "string" && typeof file.fileName === "string";
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
}

function isAllowedCloudinaryUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== CLOUDINARY_HOST ||
      url.port ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/raw/upload/`)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function uniqueArchiveName(fileName: string, usedNames: Map<string, number>) {
  const previousCount = usedNames.get(fileName) ?? 0;
  usedNames.set(fileName, previousCount + 1);
  if (!previousCount) return fileName;

  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex > 0
    ? fileName.slice(0, extensionIndex)
    : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  return `${baseName} (${previousCount + 1})${extension}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "La demande de téléchargement est invalide." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json(
      { error: "La demande de téléchargement est invalide." },
      { status: 400 },
    );
  }
  const requestBody = body as Record<string, unknown>;
  const requestFiles = requestBody.files;
  if (
    !Array.isArray(requestFiles) ||
    requestFiles.length === 0 ||
    requestFiles.length > MAX_FOLDER_FILES ||
    !requestFiles.every(isDownloadFileRequest)
  ) {
    return Response.json(
      { error: `Le dossier doit contenir entre 1 et ${MAX_FOLDER_FILES} fichiers pour être téléchargé.` },
      { status: 400 },
    );
  }

  const files = requestFiles.map((file) => ({
    url: isAllowedCloudinaryUrl(file.url),
    fileName: safeFileName(file.fileName),
  }));
  if (files.some((file) => !file.url || !file.fileName)) {
    return Response.json(
      { error: "Un des liens ou noms de fichier du dossier n’est pas valide." },
      { status: 400 },
    );
  }

  const rawArchiveName =
    typeof requestBody.archiveName === "string"
      ? safeFileName(requestBody.archiveName)
      : "documents.zip";
  const archiveName = rawArchiveName.toLowerCase().endsWith(".zip")
    ? rawArchiveName
    : `${rawArchiveName || "documents"}.zip`;

  try {
    const archive = new PizZip();
    const usedNames = new Map<string, number>();
    let totalBytes = 0;

    for (const file of files) {
      if (!file.url) throw new Error("Un lien de fichier n’est pas valide.");
      const response = await fetch(file.url, {
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok || !response.body) {
        throw new Error(`Cloudinary n’a pas pu fournir « ${file.fileName} » (${response.status}).`);
      }

      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > MAX_FOLDER_BYTES - totalBytes) {
        return Response.json(
          { error: "Le dossier dépasse la taille maximale de téléchargement de 250 Mo." },
          { status: 413 },
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_FOLDER_BYTES) {
        return Response.json(
          { error: "Le dossier dépasse la taille maximale de téléchargement de 250 Mo." },
          { status: 413 },
        );
      }
      archive.file(uniqueArchiveName(file.fileName, usedNames), bytes);
    }

    const zip = archive.generate({ type: "nodebuffer", compression: "STORE" });
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Unable to create a generation-folder download", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? `Impossible de préparer l’archive : ${error.message}`
            : "Impossible de préparer l’archive du dossier.",
      },
      { status: 502 },
    );
  }
}
