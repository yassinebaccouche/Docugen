export const ANONYMOUS_UPLOAD_LIMIT = 2;
export const ANONYMOUS_GENERATED_DOCUMENT_LIMIT = 5;

const STORAGE_KEY = "docugen-anonymous-usage-v1";

export interface AnonymousUsage {
  uploads: number;
  generatedDocuments: number;
}

function isUsage(value: unknown): value is AnonymousUsage {
  return (
    value !== null &&
    typeof value === "object" &&
    "uploads" in value &&
    typeof value.uploads === "number" &&
    Number.isSafeInteger(value.uploads) &&
    value.uploads >= 0 &&
    "generatedDocuments" in value &&
    typeof value.generatedDocuments === "number" &&
    Number.isSafeInteger(value.generatedDocuments) &&
    value.generatedDocuments >= 0
  );
}

export function getAnonymousUsage(): AnonymousUsage {
  let savedValue: string | null;
  try {
    savedValue = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    throw new Error("Impossible de vérifier la limite d’utilisation anonyme.");
  }

  if (savedValue === null) {
    return { uploads: 0, generatedDocuments: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(savedValue);
  } catch {
    throw new Error("Les compteurs d’utilisation enregistrés sont invalides.");
  }

  if (!isUsage(parsed)) {
    throw new Error("Les compteurs d’utilisation enregistrés sont invalides.");
  }
  return parsed;
}

function saveUsage(usage: AnonymousUsage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  } catch {
    throw new Error("Impossible d’enregistrer votre utilisation anonyme.");
  }
}

export function recordAnonymousUpload(): AnonymousUsage {
  const usage = getAnonymousUsage();
  if (usage.uploads >= ANONYMOUS_UPLOAD_LIMIT) {
    throw new Error("Connectez-vous pour importer d’autres documents.");
  }

  const nextUsage = { ...usage, uploads: usage.uploads + 1 };
  saveUsage(nextUsage);
  return nextUsage;
}

export function recordAnonymousGeneration(count: number): AnonymousUsage {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Le nombre de documents générés n’est pas valide.");
  }

  const usage = getAnonymousUsage();
  if (usage.generatedDocuments + count > ANONYMOUS_GENERATED_DOCUMENT_LIMIT) {
    throw new Error("Connectez-vous pour générer d’autres documents.");
  }

  const nextUsage = {
    ...usage,
    generatedDocuments: usage.generatedDocuments + count,
  };
  saveUsage(nextUsage);
  return nextUsage;
}
