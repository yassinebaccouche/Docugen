import type { StoredTemplate } from "./template-store";

const STORAGE_KEY = "docugen-local-templates-v1";

export function listLocalTemplates(): StoredTemplate[] {
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    throw new Error("Impossible de lire les modèles enregistrés dans ce navigateur.");
  }
  if (!saved) return [];

  let value: unknown;
  try {
    value = JSON.parse(saved);
  } catch {
    throw new Error("La liste locale des modèles est invalide.");
  }
  if (
    !Array.isArray(value) ||
    !value.every(
      (template) =>
        template &&
        typeof template === "object" &&
        typeof template.id === "string" &&
        typeof template.name === "string" &&
        typeof template.createdAt === "string" &&
        typeof template.updatedAt === "string" &&
        typeof template.saveVersion === "number",
    )
  ) {
    throw new Error("La liste locale des modèles est invalide.");
  }
  return value as StoredTemplate[];
}

export function getLocalTemplate(id: string): StoredTemplate | null {
  return listLocalTemplates().find((template) => template.id === id) ?? null;
}

export function saveLocalTemplate(template: StoredTemplate): StoredTemplate[] {
  const next = [
    template,
    ...listLocalTemplates().filter((item) => item.id !== template.id),
  ];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error("Impossible d’enregistrer le modèle dans ce navigateur.");
  }
  return next;
}

export function removeLocalTemplate(id: string): StoredTemplate[] {
  const next = listLocalTemplates().filter((template) => template.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error("Impossible de mettre à jour les modèles de ce navigateur.");
  }
  return next;
}
