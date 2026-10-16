import { CLOUDINARY_CLOUD_NAME } from "@/app/lib/cloudinary";
import { getDocxThumbnail } from "@/app/lib/docx-thumbnail";

const CLOUDINARY_HOST = "res.cloudinary.com";
const MAX_DOCX_SIZE = 50 * 1024 * 1024;

function isCloudinaryRawUrl(value: string): URL | null {
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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const assetUrl = isCloudinaryRawUrl(requestUrl.searchParams.get("url") ?? "");
  const fileName = requestUrl.searchParams.get("filename") ?? "";

  if (!assetUrl || !/\.docx$/i.test(fileName)) {
    return Response.json(
      { error: "Seuls les documents DOCX stockés dans Cloudinary ont un aperçu." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(assetUrl, {
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      return Response.json(
        { error: `Cloudinary n’a pas pu fournir le document (${response.status}).` },
        { status: 502 },
      );
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_DOCX_SIZE) {
      return Response.json({ error: "Le document dépasse la limite de 50 Mo." }, { status: 413 });
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_DOCX_SIZE) {
      return Response.json({ error: "Le document dépasse la limite de 50 Mo." }, { status: 413 });
    }
    const thumbnail = getDocxThumbnail(bytes);
    if (!thumbnail) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(thumbnail.bytes), {
      headers: {
        "Content-Type": thumbnail.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Unable to create a DOCX history preview", error);
    return Response.json(
      { error: "Impossible de créer l’aperçu du document." },
      { status: 502 },
    );
  }
}
