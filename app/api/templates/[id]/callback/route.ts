import { saveEditedTemplate } from "@/app/lib/template-store";
import { verifyOnlyOfficeSignature } from "@/app/lib/onlyoffice";

interface EditorCallback {
  status?: number;
  url?: string;
}

function getCallbackToken(request: Request, body: unknown): string {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization) {
    return authorization.replace(/^Bearer\s+/i, "");
  }
  if (
    body &&
    typeof body === "object" &&
    "token" in body &&
    typeof body.token === "string"
  ) {
    return body.token;
  }
  return "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 1 });
  }

  if (!verifyOnlyOfficeSignature(getCallbackToken(request, body))) {
    return Response.json({ error: 1 }, { status: 401 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: 1 });
  }
  const callback = body as EditorCallback;

  if (callback.status === 2 || callback.status === 6) {
    if (!callback.url) {
      return Response.json({ error: 1 });
    }

    const response = await fetch(callback.url, { cache: "no-store" });
    if (!response.ok) {
      console.error("ONLYOFFICE could not return the edited template", response.status);
      return Response.json({ error: 1 });
    }

    try {
      await saveEditedTemplate(id, Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error("Unable to save the edited Word template", error);
      return Response.json({ error: 1 });
    }
  } else if (callback.status === 3 || callback.status === 7) {
    console.error("ONLYOFFICE reported an editing error", callback.status);
    return Response.json({ error: 1 });
  }

  return Response.json({ error: 0 });
}
