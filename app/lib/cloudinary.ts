interface CloudinaryUploadResponse {
  public_id?: unknown;
  secure_url?: unknown;
  error?: {
    message?: unknown;
  };
}

export interface CloudinaryAsset {
  publicId: string;
  url: string;
}

export const CLOUDINARY_CLOUD_NAME =
  process.env.CLOUDINARY_CLOUD_NAME?.trim() || "yal4swpi";
const CLOUDINARY_UPLOAD_PRESET =
  process.env.CLOUDINARY_UPLOAD_PRESET?.trim() || "ml_default";

export async function uploadRawFileToCloudinary(
  bytes: Uint8Array,
  filename: string,
  publicId: string,
  contentType: string,
  resourceType: "raw" | "image" = "raw",
): Promise<CloudinaryAsset> {
  const formData = new FormData();
  const blobBytes = new Uint8Array(bytes);
  formData.append(
    "file",
    new Blob([blobBytes.buffer], { type: contentType }),
    filename,
  );
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("public_id", publicId);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    { method: "POST", body: formData },
  );
  const result = (await response.json()) as CloudinaryUploadResponse;

  if (
    !response.ok ||
    typeof result.public_id !== "string" ||
    typeof result.secure_url !== "string"
  ) {
    const message =
      typeof result.error?.message === "string"
        ? result.error.message
        : `Cloudinary upload failed (${response.status}).`;
    throw new Error(message);
  }

  return { publicId: result.public_id, url: result.secure_url };
}

export async function uploadDocumentThumbnailToCloudinary(
  bytes: Uint8Array,
  filename: string,
  id: string,
  contentType: string,
): Promise<CloudinaryAsset> {
  const extension =
    contentType === "image/svg+xml"
      ? "svg"
      : contentType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return uploadRawFileToCloudinary(
    bytes,
    `${filename}.${extension}`,
    cloudinaryRawPublicId("thumbnails", id, filename),
    contentType,
    "image",
  );
}

export function cloudinaryRawPublicId(
  folder: string,
  id: string,
  filename: string,
) {
  const safeFilename = filename
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return `docugen/${folder}/${id}-${safeFilename}`;
}
