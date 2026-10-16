import {
  collection,
  deleteDoc,
  getDocs,
  doc,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../Firebase/Config";

export interface UserDocument {
  id: string;
  collectionPath: "root" | "legacy";
  userId: string;
  title: string;
  fileName: string;
  kind: string;
  url: string;
  storageProvider: "local" | "cloudinary";
  templateId: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserDocumentInput {
  id: string;
  title: string;
  fileName?: string;
  kind?: string;
  url: string;
  storageProvider?: UserDocument["storageProvider"];
  templateId?: string | null;
  thumbnailUrl?: string | null;
  createdAt?: string;
}

function documentsCollection() {
  return collection(db, "documents");
}

function legacyUserDocumentsCollection(userId: string) {
  if (!userId.trim()) throw new Error("A signed-in user is required.");
  return collection(db, "users", userId, "documents");
}

function parseUserDocument(
  id: string,
  data: Record<string, unknown>,
  collectionPath: UserDocument["collectionPath"],
  legacyUserId?: string,
): UserDocument {
  if (
    typeof data.title !== "string" ||
    typeof data.kind !== "string" ||
    typeof data.url !== "string" ||
    (data.storageProvider !== "local" &&
      data.storageProvider !== "cloudinary") ||
    typeof data.createdAt !== "string" ||
    typeof data.updatedAt !== "string" ||
    (data.templateId !== null && typeof data.templateId !== "string") ||
    (data.thumbnailUrl !== undefined &&
      data.thumbnailUrl !== null &&
      typeof data.thumbnailUrl !== "string")
  ) {
    throw new Error(`The saved document "${id}" has invalid metadata.`);
  }

  return {
    id,
    collectionPath,
    userId:
      typeof data.userId === "string" ? data.userId : legacyUserId ?? "",
    title: data.title,
    fileName: typeof data.fileName === "string" ? data.fileName : data.title,
    kind: data.kind,
    url: data.url,
    storageProvider: data.storageProvider,
    templateId: data.templateId,
    thumbnailUrl:
      typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function listUserDocuments(
  userId: string,
): Promise<UserDocument[]> {
  if (!userId.trim()) throw new Error("A signed-in user is required.");
  const [snapshot, legacySnapshot] = await Promise.all([
    getDocs(query(documentsCollection(), where("userId", "==", userId))),
    getDocs(legacyUserDocumentsCollection(userId)),
  ]);
  const records = new Map<string, UserDocument>();
  for (const documentSnapshot of legacySnapshot.docs) {
    records.set(
      documentSnapshot.id,
      parseUserDocument(documentSnapshot.id, documentSnapshot.data(), "legacy", userId),
    );
  }
  for (const documentSnapshot of snapshot.docs) {
    records.set(
      documentSnapshot.id,
      parseUserDocument(documentSnapshot.id, documentSnapshot.data(), "root"),
    );
  }
  return [...records.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function deleteUserDocuments(
  userId: string,
  documents: Array<Pick<UserDocument, "id" | "collectionPath">>,
): Promise<void> {
  if (!userId.trim()) throw new Error("A signed-in user is required.");
  const documentIds = documents.map(({ id }) => id);
  const invitationSnapshot = await getDocs(
    collection(db, "users", userId, "invitations"),
  );
  const invitationsToDelete = invitationSnapshot.docs.filter((invitation) =>
    documentIds.includes(String(invitation.data().documentId)),
  );
  await Promise.all(
    [
      ...documents.map(({ id, collectionPath }) =>
        deleteDoc(
          collectionPath === "root"
            ? doc(documentsCollection(), id)
            : doc(legacyUserDocumentsCollection(userId), id),
        ),
      ),
      ...invitationsToDelete.flatMap((invitation) => {
        const recipientEmail = invitation.data().recipientEmail;
        return [
          deleteDoc(invitation.ref),
          ...(typeof recipientEmail === "string"
            ? [
                deleteDoc(
                  doc(
                    db,
                    "sharedWith",
                    recipientEmail.trim().toLowerCase(),
                    "documents",
                    invitation.id,
                  ),
                ),
              ]
            : []),
        ];
      }),
    ],
  );
}

export async function saveUserDocument(
  userId: string,
  document: UserDocumentInput,
): Promise<UserDocument> {
  const now = new Date().toISOString();
  if (!userId.trim()) throw new Error("A signed-in user is required.");
  const documentRef = doc(documentsCollection(), document.id);
  const record: UserDocument = {
    id: document.id,
    collectionPath: "root",
    userId,
    title: document.title,
    fileName: document.fileName ?? document.title,
    kind: document.kind ?? "document",
    url: document.url,
    storageProvider: document.storageProvider ?? "local",
    templateId: document.templateId ?? null,
    thumbnailUrl: document.thumbnailUrl ?? null,
    createdAt: document.createdAt ?? now,
    updatedAt: now,
  };

  await setDoc(documentRef, {
    userId: record.userId,
    title: record.title,
    fileName: record.fileName,
    kind: record.kind,
    url: record.url,
    storageProvider: record.storageProvider,
    templateId: record.templateId,
    thumbnailUrl: record.thumbnailUrl,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }, { merge: true });

  return record;
}
