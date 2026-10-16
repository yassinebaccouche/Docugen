import type { DocumentItem } from "../data/documents";

const STORAGE_KEY = "docugen-recent-documents-v1";
const MAX_RECENT_DOCUMENTS = 50;

export interface RecentDocument extends DocumentItem {
  id: string;
  templateId: string | null;
  url: string;
  createdAt: string;
  thumbnailUrl?: string | null;
}

function isRecentDocument(value: unknown): value is RecentDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "date" in value &&
    typeof value.date === "string" &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "templateId" in value &&
    (value.templateId === null || typeof value.templateId === "string") &&
    "url" in value &&
    typeof value.url === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    (!("thumbnailUrl" in value) ||
      value.thumbnailUrl === null ||
      typeof value.thumbnailUrl === "string")
  );
}

export function readRecentDocuments(): RecentDocument[] {
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    throw new Error("Impossible de lire les documents récents enregistrés localement.");
  }
  if (saved === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch {
    throw new Error("Les documents récents enregistrés localement sont invalides.");
  }
  if (!Array.isArray(parsed) || !parsed.every(isRecentDocument)) {
    throw new Error("Les documents récents enregistrés localement sont invalides.");
  }
  return parsed;
}

export function saveRecentDocument(
  document: RecentDocument,
): RecentDocument[] {
  const next = [
    document,
    ...readRecentDocuments().filter((item) => item.id !== document.id),
  ].slice(0, MAX_RECENT_DOCUMENTS);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error("Impossible d’enregistrer le document récent localement.");
  }
  return next;
}

export function deleteRecentDocuments(ids: string[]): RecentDocument[] {
  const idsToDelete = new Set(ids);
  const next = readRecentDocuments().filter((document) => !idsToDelete.has(document.id));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error("Impossible de supprimer les documents récents localement.");
  }
  return next;
}
