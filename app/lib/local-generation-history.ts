import type {
  GenerationFile,
  GenerationFolder,
} from "../Services/GenerationHistory";

const STORAGE_KEY = "docugen-generation-folders-v1";

interface LocalGenerationFolder extends GenerationFolder {
  files: GenerationFile[];
}

function readFolders(): LocalGenerationFolder[] {
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    throw new Error("Impossible de lire les dossiers de génération locaux.");
  }
  if (saved === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch {
    throw new Error("Les dossiers de génération locaux sont invalides.");
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (folder) =>
        typeof folder === "object" &&
        folder !== null &&
        "id" in folder &&
        typeof folder.id === "string" &&
        "name" in folder &&
        typeof folder.name === "string" &&
        "createdAt" in folder &&
        typeof folder.createdAt === "string" &&
        "updatedAt" in folder &&
        typeof folder.updatedAt === "string" &&
        "files" in folder &&
        Array.isArray(folder.files) &&
        folder.files.every(
          (file: unknown) =>
            typeof file === "object" &&
            file !== null &&
            "id" in file &&
            typeof file.id === "string" &&
            "title" in file &&
            typeof file.title === "string" &&
            "fileName" in file &&
            typeof file.fileName === "string" &&
            "kind" in file &&
            (file.kind === "generated" ||
              file.kind === "source" ||
              file.kind === "archive") &&
            "url" in file &&
            typeof file.url === "string" &&
            "createdAt" in file &&
            typeof file.createdAt === "string",
        ),
    )
  ) {
    throw new Error("Les dossiers de génération locaux sont invalides.");
  }
  return parsed as LocalGenerationFolder[];
}

function writeFolders(folders: LocalGenerationFolder[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
  } catch {
    throw new Error("Impossible d’enregistrer les dossiers de génération localement.");
  }
}

export function listLocalGenerationFolders(): GenerationFolder[] {
  return readFolders()
    .map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createLocalGenerationFolder(name: string): GenerationFolder {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 80) {
    throw new Error("Le nom du dossier doit contenir entre 1 et 80 caractères.");
  }
  const createdAt = new Date().toISOString();
  const folder: LocalGenerationFolder = {
    id: `local-${crypto.randomUUID()}`,
    name: normalizedName,
    createdAt,
    updatedAt: createdAt,
    files: [],
  };
  writeFolders([folder, ...readFolders()]);
  return folder;
}

export function renameLocalGenerationFolder(
  folderId: string,
  name: string,
): void {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 80) {
    throw new Error("Le nom du dossier doit contenir entre 1 et 80 caractères.");
  }
  const folders = readFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) throw new Error("Le dossier local est introuvable.");
  folder.name = normalizedName;
  folder.updatedAt = new Date().toISOString();
  writeFolders(folders);
}

export function listLocalGenerationFiles(folderId: string): GenerationFile[] {
  const folder = readFolders().find((item) => item.id === folderId);
  if (!folder) throw new Error("Le dossier local est introuvable.");
  return [...folder.files].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function saveLocalGenerationFile(
  folderId: string,
  file: GenerationFile,
): void {
  const folders = readFolders();
  const folderIndex = folders.findIndex((item) => item.id === folderId);
  if (folderIndex < 0) throw new Error("Le dossier local est introuvable.");
  const folder = folders[folderIndex];
  folders[folderIndex] = {
    ...folder,
    updatedAt: new Date().toISOString(),
    files: [file, ...folder.files.filter((item) => item.id !== file.id)],
  };
  writeFolders(folders);
}

export function renameLocalGenerationFile(
  folderId: string,
  fileId: string,
  title: string,
  fileName: string,
): void {
  const normalizedTitle = title.trim();
  const normalizedFileName = fileName.trim();
  if (!normalizedTitle || !normalizedFileName) {
    throw new Error("Le nom du fichier ne peut pas être vide.");
  }
  const folders = readFolders();
  const folder = folders.find((item) => item.id === folderId);
  const file = folder?.files.find((item) => item.id === fileId);
  if (!folder || !file) throw new Error("Le fichier local est introuvable.");
  file.title = normalizedTitle;
  file.fileName = normalizedFileName;
  folder.updatedAt = new Date().toISOString();
  writeFolders(folders);
}

export function deleteLocalGenerationFile(
  folderId: string,
  fileId: string,
): void {
  const folders = readFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) throw new Error("Le dossier local est introuvable.");
  folder.files = folder.files.filter((item) => item.id !== fileId);
  folder.updatedAt = new Date().toISOString();
  writeFolders(folders);
}

export function deleteLocalGenerationFolder(folderId: string): void {
  const folders = readFolders();
  if (!folders.some((item) => item.id === folderId)) {
    throw new Error("Le dossier local est introuvable.");
  }
  writeFolders(folders.filter((item) => item.id !== folderId));
}
