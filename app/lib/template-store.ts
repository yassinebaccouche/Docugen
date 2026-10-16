import { randomUUID } from "node:crypto";
import { get, list, put } from "@vercel/blob";
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
  cloudinaryRawPublicId,
  uploadDocumentThumbnailToCloudinary,
  uploadRawFileToCloudinary,
  type CloudinaryAsset,
} from "./cloudinary";
import { getDocxThumbnail } from "./docx-thumbnail";
import { validateTemplateFile } from "./docx-template";
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
  cloudinary?: CloudinaryAsset;
  thumbnailUrl?: string;
}

export interface OnlyOfficeEditorConfig {
  documentServerUrl: string;
  config: Record<string, unknown>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEMPLATE_SIZE = 10 * 1024 * 1024;
const BLOB_METADATA_PREFIX = "docugen/templates/";
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function usesBlobStorage(): boolean {
  if (process.env.BLOB_READ_WRITE_TOKEN) return true;
  if (process.env.VERCEL === "1") {
    throw new Error(
      "Template storage is not configured. Connect a Vercel Blob store and add its BLOB_READ_WRITE_TOKEN to this deployment.",
    );
  }
  return false;
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

async function readMetadata(id: string): Promise<StoredTemplate | null> {
  if (usesBlobStorage()) {
    const result = await get(`${BLOB_METADATA_PREFIX}${id}.json`, {
      access: "private",
    });
    if (!result) return null;
    if (result.statusCode !== 200) {
      throw new Error(`Unable to read metadata for template "${id}".`);
    }
    return parseMetadata(await new Response(result.stream).text(), id);
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
    (!("thumbnailUrl" in value) || typeof value.thumbnailUrl === "string") &&
    (!("cloudinary" in value) ||
      (typeof value.cloudinary === "object" &&
        value.cloudinary !== null &&
        "publicId" in value.cloudinary &&
        typeof value.cloudinary.publicId === "string" &&
        "url" in value.cloudinary &&
        typeof value.cloudinary.url === "string"))
  ) {
    return value as StoredTemplate;
  }
  throw new Error("Invalid stored template metadata.");
}

async function writeMetadata(metadata: StoredTemplate): Promise<void> {
  if (usesBlobStorage()) {
    await put(
      `${BLOB_METADATA_PREFIX}${metadata.id}.json`,
      JSON.stringify(metadata),
      {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
      },
    );
    return;
  }

  await mkdir(storeDirectory(), { recursive: true });
  await writeFile(metadataPath(metadata.id), JSON.stringify(metadata));
}

/** Stores a validated DOCX in Cloudinary and metadata in persistent storage. */
export async function saveUploadedTemplate(file: File): Promise<StoredTemplate> {
  validateTemplateFile(file);
  const useBlobStorage = usesBlobStorage();
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

  if (useBlobStorage) {
    await writeMetadata(metadata);
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
export async function listStoredTemplates(): Promise<StoredTemplate[]> {
  if (usesBlobStorage()) {
    const records: StoredTemplate[] = [];
    let cursor: string | undefined;
    do {
      const result = await list({
        prefix: BLOB_METADATA_PREFIX,
        ...(cursor ? { cursor } : {}),
      });
      const pageRecords = await Promise.all(
        result.blobs
          .map((blob) => blob.pathname.slice(BLOB_METADATA_PREFIX.length))
          .filter((name) => /^[0-9a-f-]+\.json$/i.test(name))
          .map((name) => readMetadata(name.slice(0, -5))),
      );
      records.push(
        ...pageRecords.filter(
          (record): record is StoredTemplate => record !== null,
        ),
      );
      if (result.hasMore && !result.cursor) {
        throw new Error("Vercel Blob did not return a template-list cursor.");
      }
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    return records
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

export async function getStoredTemplate(id: string): Promise<StoredTemplate | null> {
  if (!isTemplateId(id)) return null;
  return readMetadata(id);
}

export async function readStoredTemplateFile(id: string): Promise<Buffer | null> {
  if (!isTemplateId(id)) return null;
  if (usesBlobStorage()) {
    const metadata = await readMetadata(id);
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
): Promise<StoredTemplate> {
  if (!isTemplateId(id)) {
    throw new Error("Invalid template identifier.");
  }
  if (bytes.length === 0 || bytes.length > MAX_TEMPLATE_SIZE) {
    throw new Error("The updated DOCX template is empty or exceeds the 10 MB limit.");
  }

  const metadata = await readMetadata(id);
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
  if (usesBlobStorage()) {
    await writeMetadata(nextMetadata);
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
