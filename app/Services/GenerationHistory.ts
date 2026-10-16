import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { db } from "../Firebase/Config";

export interface GenerationFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationFile {
  id: string;
  title: string;
  fileName: string;
  kind: "generated" | "source" | "archive";
  url: string;
  thumbnailUrl?: string | null;
  createdAt: string;
}

function foldersCollection(userId: string) {
  if (!userId.trim()) throw new Error("Connectez-vous pour ouvrir vos dossiers.");
  return collection(db, "users", userId, "generationFolders");
}

function folderReference(userId: string, folderId: string) {
  if (!folderId.trim()) throw new Error("Choisissez un dossier de génération.");
  return doc(foldersCollection(userId), folderId);
}

export async function listGenerationFolders(
  userId: string,
): Promise<GenerationFolder[]> {
  const snapshot = await getDocs(foldersCollection(userId));
  return snapshot.docs
    .map((folder) => {
      const data = folder.data();
      if (
        typeof data.name !== "string" ||
        typeof data.createdAt !== "string" ||
        typeof data.updatedAt !== "string"
      ) {
        throw new Error(`Le dossier de génération "${folder.id}" est invalide.`);
      }
      return {
        id: folder.id,
        name: data.name,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createGenerationFolder(
  userId: string,
  name: string,
): Promise<GenerationFolder> {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 80) {
    throw new Error("Le nom du dossier doit contenir entre 1 et 80 caractères.");
  }
  const folderRef = doc(foldersCollection(userId));
  const createdAt = new Date().toISOString();
  const folder: GenerationFolder = {
    id: folderRef.id,
    name: normalizedName,
    createdAt,
    updatedAt: createdAt,
  };
  await setDoc(folderRef, folder);
  return folder;
}

export async function renameGenerationFolder(
  userId: string,
  folderId: string,
  name: string,
): Promise<void> {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 80) {
    throw new Error("Le nom du dossier doit contenir entre 1 et 80 caractères.");
  }
  await setDoc(
    folderReference(userId, folderId),
    { name: normalizedName, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function listGenerationFiles(
  userId: string,
  folderId: string,
): Promise<GenerationFile[]> {
  const snapshot = await getDocs(
    collection(folderReference(userId, folderId), "documents"),
  );
  return snapshot.docs
    .map((file) => {
      const data = file.data();
      if (
        typeof data.title !== "string" ||
        typeof data.fileName !== "string" ||
        (data.kind !== "generated" &&
          data.kind !== "source" &&
          data.kind !== "archive") ||
        typeof data.url !== "string" ||
        (data.thumbnailUrl !== undefined &&
          data.thumbnailUrl !== null &&
          typeof data.thumbnailUrl !== "string") ||
        typeof data.createdAt !== "string"
      ) {
        throw new Error(`Le fichier de génération "${file.id}" est invalide.`);
      }
      return {
        id: file.id,
        title: data.title,
        fileName: data.fileName,
        kind: data.kind,
        url: data.url,
        thumbnailUrl:
          typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null,
        createdAt: data.createdAt,
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function saveGenerationFile(
  userId: string,
  folderId: string,
  file: GenerationFile,
): Promise<void> {
  const folderRef = folderReference(userId, folderId);
  await setDoc(doc(collection(folderRef, "documents"), file.id), {
    title: file.title,
    fileName: file.fileName,
    kind: file.kind,
    url: file.url,
    thumbnailUrl: file.thumbnailUrl ?? null,
    createdAt: file.createdAt,
  });
  await setDoc(
    folderRef,
    { updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function renameGenerationFile(
  userId: string,
  folderId: string,
  fileId: string,
  title: string,
  fileName: string,
): Promise<void> {
  const normalizedTitle = title.trim();
  const normalizedFileName = fileName.trim();
  if (!normalizedTitle || !normalizedFileName) {
    throw new Error("Le nom du fichier ne peut pas être vide.");
  }
  const folderRef = folderReference(userId, folderId);
  await setDoc(
    doc(collection(folderRef, "documents"), fileId),
    { title: normalizedTitle, fileName: normalizedFileName },
    { merge: true },
  );
  await setDoc(
    folderRef,
    { updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function deleteGenerationFile(
  userId: string,
  folderId: string,
  fileId: string,
): Promise<void> {
  await deleteDoc(
    doc(collection(folderReference(userId, folderId), "documents"), fileId),
  );
  await setDoc(
    folderReference(userId, folderId),
    { updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function deleteGenerationFolder(
  userId: string,
  folderId: string,
): Promise<void> {
  const folderRef = folderReference(userId, folderId);
  const files = await getDocs(collection(folderRef, "documents"));
  await Promise.all(files.docs.map((file) => deleteDoc(file.ref)));
  await deleteDoc(folderRef);
}

export async function migrateLegacyGeneratedFiles(
  userId: string,
  files: GenerationFile[],
): Promise<void> {
  if (!files.length) return;
  const folderRef = doc(foldersCollection(userId), "previous-generations");
  const [folderSnapshot, filesSnapshot] = await Promise.all([
    getDoc(folderRef),
    getDocs(collection(folderRef, "documents")),
  ]);
  const existingIds = new Set(filesSnapshot.docs.map((file) => file.id));
  const now = new Date().toISOString();
  await setDoc(
    folderRef,
    {
      id: folderRef.id,
      name: folderSnapshot.exists()
        ? String(folderSnapshot.data().name)
        : "Générations précédentes",
      createdAt: folderSnapshot.exists()
        ? String(folderSnapshot.data().createdAt)
        : files.reduce(
            (earliest, file) =>
              file.createdAt < earliest ? file.createdAt : earliest,
            files[0].createdAt,
          ),
      updatedAt: now,
    },
    { merge: true },
  );
  for (const file of files) {
    if (!existingIds.has(file.id)) {
      await saveGenerationFile(userId, folderRef.id, file);
    }
  }
}
