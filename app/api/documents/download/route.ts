import { CLOUDINARY_CLOUD_NAME } from "@/app/lib/cloudinary";

const CLOUDINARY_HOST = "res.cloudinary.com";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const rawAssetUrl = requestUrl.searchParams.get("url");
  const requestedFileName = requestUrl.searchParams.get("filename");
  if (!rawAssetUrl || !requestedFileName) {
    return Response.json(
      { error: "Le lien ou le nom du fichier est manquant." },
      { status: 400 },
    );
  }

  let assetUrl: URL;
  try {
    assetUrl = new URL(rawAssetUrl);
  } catch {
    return Response.json({ error: "Le lien du fichier n’est pas valide." }, { status: 400 });
  }

  if (
    assetUrl.protocol !== "https:" ||
    assetUrl.hostname !== CLOUDINARY_HOST ||
    assetUrl.port ||
    assetUrl.username ||
    assetUrl.password ||
    !assetUrl.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/raw/upload/`)
  ) {
    return Response.json(
      { error: "Seuls les fichiers Raw enregistrés dans Cloudinary peuvent être téléchargés." },
      { status: 400 },
    );
  }

  const fileName = requestedFileName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  if (!fileName) {
    return Response.json({ error: "Le nom du fichier n’est pas valide." }, { status: 400 });
  }

  try {
    const assetResponse = await fetch(assetUrl, {
      cache: "no-store",
      redirect: "error",
    });
    if (!assetResponse.ok || !assetResponse.body) {
      return Response.json(
        { error: `Cloudinary n’a pas pu fournir le fichier (${assetResponse.status}).` },
        { status: 502 },
      );
    }

    const headers = new Headers({
      "Content-Type":
        assetResponse.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const contentLength = assetResponse.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(assetResponse.body, { headers });
  } catch (error) {
    console.error("Unable to download a Cloudinary document", error);
    return Response.json(
      { error: "Impossible de récupérer le fichier depuis Cloudinary." },
      { status: 502 },
    );
  }
}
