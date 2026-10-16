import { firebaseConfig } from "@/app/Firebase/firebase-config";

type FirestoreValue =
  | { nullValue: "NULL_VALUE" }
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { arrayValue: { values: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

const DOCUMENTS_URL =
  `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Firestore values must be finite numbers.");
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) fields[key] = encodeValue(entry);
    }
    return { mapValue: { fields } };
  }
  throw new Error("Unsupported Firestore value.");
}

function decodeValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  return null;
}

function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

async function firestoreRequest(
  path: string,
  idToken: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${DOCUMENTS_URL}/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Firestore template storage failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
  return response;
}

export async function getFirestoreTemplate(
  ownerId: string,
  id: string,
  idToken: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `${DOCUMENTS_URL}/users/${encodeURIComponent(ownerId)}`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${idToken}` },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Firestore template read failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
  const document = (await response.json()) as FirestoreDocument;
  const templates = document.fields?.docugenTemplates;
  if (!templates || !("mapValue" in templates)) return null;
  const value = templates.mapValue.fields[id];
  return value && "mapValue" in value ? decodeFields(value.mapValue.fields) : null;
}

export async function listFirestoreTemplates(
  idToken: string,
  ownerId: string,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `${DOCUMENTS_URL}/users/${encodeURIComponent(ownerId)}`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${idToken}` },
    },
  );
  if (response.status === 404) return [];
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Firestore template read failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
  const document = (await response.json()) as FirestoreDocument;
  const templates = document.fields?.docugenTemplates;
  if (!templates || !("mapValue" in templates)) return [];
  return Object.values(templates.mapValue.fields).flatMap((value) =>
    "mapValue" in value ? [decodeFields(value.mapValue.fields)] : [],
  );
}

export async function writeFirestoreTemplate(
  ownerId: string,
  id: string,
  value: Record<string, unknown>,
  idToken: string,
): Promise<void> {
  const encoded = encodeValue(value);
  if (!("mapValue" in encoded)) {
    throw new Error("Firestore template metadata must be an object.");
  }
  const updateMask = new URLSearchParams();
  updateMask.set("updateMask.fieldPaths", `docugenTemplates.\`${id}\``);
  await firestoreRequest(
    `users/${encodeURIComponent(ownerId)}?${updateMask.toString()}`,
    idToken,
    {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          docugenTemplates: {
            mapValue: { fields: { [id]: encoded } },
          },
        },
      }),
    },
  );
}
