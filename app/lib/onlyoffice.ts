import { createHmac, timingSafeEqual } from "node:crypto";

export interface OnlyOfficeClaims {
  templateId: string;
  purpose: "document" | "editor";
  exp: number;
}

function secret(): string {
  const value = process.env.ONLYOFFICE_JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("Set ONLYOFFICE_JWT_SECRET to a random value of at least 32 characters.");
  }
  return value;
}

export function signOnlyOfficeToken(
  claims: Omit<OnlyOfficeClaims, "exp"> & { expiresInSeconds?: number },
): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      templateId: claims.templateId,
      purpose: claims.purpose,
      exp: Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? 900),
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", secret()).update(data).digest("base64url");

  return `${data}.${signature}`;
}

export function verifyOnlyOfficeToken(token: string): OnlyOfficeClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const data = `${parts[0]}.${parts[1]}`;
    const expected = createHmac("sha256", secret()).update(data).digest();
    const actual = Buffer.from(parts[2], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }

    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (
      !payload ||
      typeof payload !== "object" ||
      !("templateId" in payload) ||
      typeof payload.templateId !== "string" ||
      !("purpose" in payload) ||
      !["document", "editor"].includes(String(payload.purpose)) ||
      !("exp" in payload) ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload as OnlyOfficeClaims;
  } catch {
    return null;
  }
}

export function verifyOnlyOfficeSignature(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const expected = createHmac("sha256", secret())
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    const actual = Buffer.from(parts[2], "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function getEditorServerUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_ONLYOFFICE_URL?.trim() || "http://localhost:8080";
  return url.replace(/\/+$/, "");
}

export function getDocumentServerPublicAppUrl(): string {
  const url =
    process.env.DOCUGEN_PUBLIC_URL?.trim() || "http://host.docker.internal:3000";
  return url.replace(/\/+$/, "");
}
