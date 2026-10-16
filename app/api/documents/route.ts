import { randomUUID } from "node:crypto";
import {
  cloudinaryRawPublicId,
  uploadDocumentThumbnailToCloudinary,
  uploadRawFileToCloudinary,
} from "@/app/lib/cloudinary";
import { getDocxThumbnail } from "@/app/lib/docx-thumbnail";

const MAX_GENERATED_FILE_SIZE = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      { error: "Le fichier à enregistrer est vide ou manquant." },
      { status: 400 },
    );
  }
  if (!/\.(docx|zip|xlsx|csv)$/i.test(file.name)) {
    return Response.json(
      { error: "Seuls les fichiers DOCX, ZIP, Excel et CSV sont acceptés." },
      { status: 415 },
    );
  }
  if (file.size > MAX_GENERATED_FILE_SIZE) {
    return Response.json(
      { error: "Le fichier dépasse la limite de 50 Mo." },
      { status: 413 },
    );
  }

  try {
    const id = randomUUID();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cloudinary = await uploadRawFileToCloudinary(
      bytes,
      file.name,
      cloudinaryRawPublicId("documents", id, file.name),
      file.type || "application/octet-stream",
    );
    let thumbnailUrl: string | null = null;
    if (/\.docx$/i.test(file.name)) {
      const thumbnail = getDocxThumbnail(bytes);
      if (thumbnail) {
        const thumbnailAsset = await uploadDocumentThumbnailToCloudinary(
          new Uint8Array(thumbnail.bytes),
          file.name,
          id,
          thumbnail.contentType,
        );
        thumbnailUrl = thumbnailAsset.url;
      }
    }
    return Response.json({
      document: {
        id,
        title: file.name,
        fileName: file.name,
        url: cloudinary.url,
        thumbnailUrl,
        storageProvider: "cloudinary",
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Unable to save generated document to Cloudinary", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? `Impossible d’enregistrer le document dans Cloudinary : ${error.message}`
            : "Impossible d’enregistrer le document dans Cloudinary.",
      },
      { status: 502 },
    );
  }
}
