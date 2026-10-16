import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  CLOUDINARY_CLOUD_NAME,
  cloudinaryRawPublicId,
  uploadDocumentThumbnailToCloudinary,
  uploadRawFileToCloudinary,
  type CloudinaryAsset,
} from "./cloudinary";
import { getDocxThumbnail } from "./docx-thumbnail";
import { validateTemplateFile } from "./docx-template";
import {
  getFirestoreTemplate,
  listFirestoreTemplates,
  writeFirestoreTemplate,
} from "./firebase-firestore-rest";
import {
  getDocumentServerPublicAppUrl,
  getEditorServerUrl,
  signOnlyOfficeToken,
} from "./onlyoffice";

export interface StoredTemplate {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  saveVersion: number;
  ownerId?: string;
  cloudinary?: CloudinaryAsset;
  thumbnailUrl?: string;
}

export interface TemplateAccess {
  idToken?: string;
  ownerId?: string;
  localTemplate?: StoredTemplate;
}

export interface OnlyOfficeEditorConfig {
  documentServerUrl: string;
  config: Record<string, unknown>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEMPLATE_SIZE = 10 * 1024 * 1024;
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function usesFirestoreMetadata(): boolean {
  return process.env.VERCEL === "1";
}

function tokenOwnerId(idToken: string): string {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Firebase sign-in is required to save templates.");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("The Firebase sign-in token is invalid.");
  }
  if (
    !claims ||
    typeof claims !== "object" ||
    !("sub" in claims) ||
    typeof claims.sub !== "string" ||
    !claims.sub
  ) {
    throw new Error("Firebase sign-in is required to save templates.");
  }
  return claims.sub;
}

export function getTemplateAccess(request: Request): TemplateAccess {
  const authorization = request.headers.get("authorization") ?? "";
  const idToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const rawLocalTemplate = request.headers.get("x-docugen-template");
  let localTemplate: StoredTemplate | undefined;
  if (rawLocalTemplate) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLocalTemplate);
    } catch {
      throw new Error("The local template metadata is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || !("id" in parsed) || typeof parsed.id !== "string") {
      throw new Error("The local template metadata is invalid.");
    }
    localTemplate = parseMetadata(JSON.stringify(parsed), parsed.id);
  }
  return {
    ...(idToken ? { idToken, ownerId: tokenOwnerId(idToken) } : {}),
    ...(localTemplate ? { localTemplate } : {}),
  };
}

function storeDirectory(): string {
  // Keep template data local by default; deployments can point this at a persistent disk.
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.DOCUGEN_DATA_DIR?.trim() ||
      path.join(process.cwd(), ".docugen-data"),
  );
}

function isTemplateId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

function isCloudinaryAssetUrl(value: string, resourceType: "raw" | "image"): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "res.cloudinary.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/`)
    );
  } catch {
    return false;
  }
}

function templatePath(id: string): string {
  if (!isTemplateId(id)) {
    throw new Error("Invalid template identifier.");
  }
  return path.join(storeDirectory(), `${id}.docx`);
}

function metadataPath(id: string): string {
  if (!isTemplateId(id)) {
    throw new Error("Invalid template identifier.");
  }
  return path.join(storeDirectory(), `${id}.json`);
}

async function readMetadata(
  id: string,
  access: TemplateAccess = {},
): Promise<StoredTemplate | null> {
  if (usesFirestoreMetadata()) {
    if (access.idToken) {
      const value = access.ownerId
        ? await getFirestoreTemplate(access.ownerId, id, access.idToken)
        : null;
      if (value) return parseMetadata(JSON.stringify(value), id);
      return access.localTemplate?.id === id ? access.localTemplate : null;
    }
    if (access.localTemplate?.id === id) return access.localTemplate;
    return null;
  }

  try {
    const json = await readFile(metadataPath(id), "utf8");
    return parseMetadata(json, id);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseMetadata(json: string, id: string): StoredTemplate {
  const value: unknown = JSON.parse(json);
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    value.id === id &&
    "name" in value &&
    typeof value.name === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string" &&
    "saveVersion" in value &&
    typeof value.saveVersion === "number" &&
    (!("ownerId" in value) || typeof value.ownerId === "string") &&
    (!("thumbnailUrl" in value) ||
      (typeof value.thumbnailUrl === "string" &&
        isCloudinaryAssetUrl(value.thumbnailUrl, "image"))) &&
    (!("cloudinary" in value) ||
      (typeof value.cloudinary === "object" &&
        value.cloudinary !== null &&
        "publicId" in value.cloudinary &&
        typeof value.cloudinary.publicId === "string" &&
        "url" in value.cloudinary &&
        typeof value.cloudinary.url === "string" &&
        isCloudinaryAssetUrl(value.cloudinary.url, "raw")))
  ) {
    return value as StoredTemplate;
  }
  throw new Error("Invalid stored template metadata.");
}

async function writeMetadata(
  metadata: StoredTemplate,
  access: TemplateAccess = {},
): Promise<void> {
  if (usesFirestoreMetadata()) {
    if (access.idToken) {
      const ownerId = access.ownerId ?? tokenOwnerId(access.idToken);
      await writeFirestoreTemplate(
        ownerId,
        metadata.id,
        { ...metadata, ownerId },
        access.idToken,
      );
    }
    return;
  }

  await mkdir(storeDirectory(), { recursive: true });
  await writeFile(metadataPath(metadata.id), JSON.stringify(metadata));
}

/** Stores a validated DOCX in Cloudinary and metadata in persistent storage. */
export async function saveUploadedTemplate(
  file: File,
  access: TemplateAccess = {},
): Promise<StoredTemplate> {
  validateTemplateFile(file);
  const useFirestore = usesFirestoreMetadata();
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_TEMPLATE_SIZE) {
    throw new Error("The DOCX template exceeds the 10 MB limit.");
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const metadata: StoredTemplate = {
    id,
    name: path.basename(file.name),
    createdAt: now,
    updatedAt: now,
    saveVersion: 0,
    ...(access.ownerId ? { ownerId: access.ownerId } : {}),
  };
  const cloudinary = await uploadRawFileToCloudinary(
    new Uint8Array(bytes),
    metadata.name,
    cloudinaryRawPublicId("templates", id, metadata.name),
    DOCX_CONTENT_TYPE,
  );
  metadata.cloudinary = cloudinary;
  const thumbnail = getDocxThumbnail(bytes);
  if (thumbnail) {
    const thumbnailAsset = await uploadDocumentThumbnailToCloudinary(
      new Uint8Array(thumbnail.bytes),
      metadata.name,
      id,
      thumbnail.contentType,
    );
    metadata.thumbnailUrl = thumbnailAsset.url;
  }

  if (useFirestore) {
    if (access.idToken) {
      try {
        await writeMetadata(metadata, access);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Firestore write failed.";
        throw new Error(
          `Le fichier a été téléversé sur Cloudinary, mais Firestore n’a pas pu enregistrer ses métadonnées : ${reason}`,
        );
      }
    }
  } else {
    await mkdir(storeDirectory(), { recursive: true });
    try {
      await writeFile(templatePath(id), bytes, { flag: "wx" });
      await writeFile(metadataPath(id), JSON.stringify(metadata), { flag: "wx" });
    } catch (error) {
      await Promise.all([
        unlink(templatePath(id)).catch(() => undefined),
        unlink(metadataPath(id)).catch(() => undefined),
      ]);
      throw error;
    }
  }
  return metadata;
}

/** Lists templates newest first; an empty storage directory is a first-run store. */
export async function listStoredTemplates(
  access: TemplateAccess = {},
): Promise<StoredTemplate[]> {
  if (usesFirestoreMetadata()) {
    if (!access.idToken || !access.ownerId) return [];
    return (await listFirestoreTemplates(access.idToken, access.ownerId))
      .map((value) => parseMetadata(JSON.stringify(value), String(value.id ?? "")))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  let files: string[];
  try {
    files = await readdir(/*turbopackIgnore: true*/ storeDirectory());
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records = await Promise.all(
    files
      .filter((name) => UUID_PATTERN.test(name.replace(/\.json$/i, "")) && name.endsWith(".json"))
      .map((name) => readMetadata(name.slice(0, -5))),
  );
  return records
    .filter((record): record is StoredTemplate => record !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getStoredTemplate(
  id: string,
  access: TemplateAccess = {},
): Promise<StoredTemplate | null> {
  if (!isTemplateId(id)) return null;
  return readMetadata(id, access);
}

export async function readStoredTemplateFile(
  id: string,
  access: TemplateAccess = {},
): Promise<Buffer | null> {
  if (!isTemplateId(id)) return null;
  if (usesFirestoreMetadata()) {
    const metadata = await readMetadata(id, access);
    if (!metadata?.cloudinary?.url) return null;
    const response = await fetch(metadata.cloudinary.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `Unable to download template "${id}" from Cloudinary (${response.status}).`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  try {
    return await readFile(templatePath(id));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** Persists an edited DOCX and advances its metadata version. */
export async function saveEditedTemplate(
  id: string,
  bytes: Buffer,
  access: TemplateAccess = {},
): Promise<StoredTemplate> {
  if (!isTemplateId(id)) {
    throw new Error("Invalid template identifier.");
  }
  if (bytes.length === 0 || bytes.length > MAX_TEMPLATE_SIZE) {
    throw new Error("The updated DOCX template is empty or exceeds the 10 MB limit.");
  }

  const metadata = await readMetadata(id, access);
  if (!metadata) throw new Error("The template no longer exists.");

  const nextMetadata: StoredTemplate = {
    ...metadata,
    updatedAt: new Date().toISOString(),
    saveVersion: metadata.saveVersion + 1,
  };
  nextMetadata.cloudinary = await uploadRawFileToCloudinary(
    new Uint8Array(bytes),
    metadata.name,
    cloudinaryRawPublicId(
      "templates",
      `${id}-v${nextMetadata.saveVersion}`,
      metadata.name,
    ),
    DOCX_CONTENT_TYPE,
  );
  const thumbnail = getDocxThumbnail(bytes);
  if (thumbnail) {
    const thumbnailAsset = await uploadDocumentThumbnailToCloudinary(
      new Uint8Array(thumbnail.bytes),
      metadata.name,
      `${id}-v${nextMetadata.saveVersion}`,
      thumbnail.contentType,
    );
    nextMetadata.thumbnailUrl = thumbnailAsset.url;
  }
  if (usesFirestoreMetadata()) {
    if (access.idToken) {
      try {
        await writeMetadata(nextMetadata, access);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Firestore write failed.";
        throw new Error(
          `La nouvelle version a été téléversée sur Cloudinary, mais Firestore n’a pas pu enregistrer ses métadonnées : ${reason}`,
        );
      }
    }
  } else {
    const temporaryFile = `${templatePath(id)}.${randomUUID()}.tmp`;

    await writeFile(temporaryFile, bytes, { flag: "wx" });
    try {
      await rename(temporaryFile, templatePath(id));
    } catch (error) {
      await unlink(temporaryFile).catch(() => undefined);
      throw error;
    }
    await writeFile(metadataPath(id), JSON.stringify(nextMetadata));
  }
  return nextMetadata;
}

export function createEditorConfig(
  template: StoredTemplate,
): OnlyOfficeEditorConfig {
  const expiresInSeconds = 60 * 60;
  const baseUrl = getDocumentServerPublicAppUrl();
  const editorUrl = getEditorServerUrl();
  const documentToken = signOnlyOfficeToken({
    templateId: template.id,
    purpose: "document",
    expiresInSeconds,
  });
  const versionKey = `${template.id}-${template.saveVersion}-${Date.now()}`;
  const config: Record<string, unknown> = {
    documentType: "word",
    document: {
      fileType: "docx",
      key: versionKey,
      title: template.name,
      url: `${baseUrl}/api/templates/${template.id}/file?token=${encodeURIComponent(documentToken)}`,
      permissions: {
        edit: true,
        download: true,
        print: true,
      },
    },
    editorConfig: {
      mode: "edit",
      lang: "fr",
      callbackUrl: `${baseUrl}/api/templates/${template.id}/callback`,
      user: {
        id: "docugen-user",
        name: "Utilisateur DocuGen",
      },
      customization: {
        autosave: true,
        forcesave: true,
        compactHeader: true,
        compactToolbar: true,
      },
    },
  };
  const token = signOnlyOfficeToken({
    templateId: template.id,
    purpose: "editor",
    expiresInSeconds,
  });

  return {
    documentServerUrl: editorUrl,
    config: {
      ...config,
      token,
    },
  };
}
