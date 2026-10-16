import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { db } from "../Firebase/Config";

export interface SharedUserDocument {
  id: string;
  documentId: string;
  ownerId: string;
  title: string;
  owner: string;
  initials: string;
  date: string;
  updatedAt: string;
  kind: string;
  color: string;
  url: string;
  templateId: string | null;
  thumbnailUrl: string | null;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function recipientSharesCollection(email: string) {
  return collection(
    db,
    "sharedWith",
    email.trim().toLowerCase(),
    "documents",
  );
}

export async function inviteUserToDocument(
  ownerId: string,
  ownerName: string,
  documentId: string,
  email: string,
): Promise<void> {
  const recipientEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    throw new Error("Saisissez une adresse e-mail valide.");
  }

  const documentRef = doc(db, "documents", documentId);
  const storedDocument = await getDoc(documentRef);
  if (!storedDocument.exists()) {
    throw new Error("Ce document n’existe plus dans votre bibliothèque.");
  }
  const document = storedDocument.data();
  if (
    typeof document.title !== "string" ||
    typeof document.kind !== "string" ||
    typeof document.url !== "string"
  ) {
    throw new Error("Les informations de ce document sont incomplètes.");
  }

  const invitationId = `${documentId}_${encodeURIComponent(recipientEmail)}`;
  const invitationRef = doc(
    collection(db, "users", ownerId, "invitations"),
    invitationId,
  );
  const existingInvitation = await getDoc(invitationRef);
  const createdAt = existingInvitation.exists()
    ? String(existingInvitation.data().createdAt)
    : new Date().toISOString();

  const invitation = {
    ownerId,
    ownerName,
    recipientEmail,
    documentId,
    title: document.title,
    kind: document.kind,
    url: document.url,
    templateId:
      typeof document.templateId === "string" ? document.templateId : null,
    thumbnailUrl:
      typeof document.thumbnailUrl === "string" ? document.thumbnailUrl : null,
    createdAt,
    updatedAt: new Date().toISOString(),
  };
  await Promise.all([
    setDoc(invitationRef, invitation),
    setDoc(doc(recipientSharesCollection(recipientEmail), invitationId), invitation),
  ]);
}

export async function updateSharedDocumentInvitations(
  ownerId: string,
  documentId: string,
  title: string,
  url: string,
  thumbnailUrl: string | null,
): Promise<void> {
  const snapshot = await getDocs(
    collection(db, "users", ownerId, "invitations"),
  );
  const matchingInvitations = snapshot.docs.filter(
    (invitation) => invitation.data().documentId === documentId,
  );
  await Promise.all(
    matchingInvitations.flatMap((invitation) => {
      const data = invitation.data();
      const updatedAt = new Date().toISOString();
      const update = { title, url, thumbnailUrl, updatedAt };
      return [
        setDoc(invitation.ref, update, { merge: true }),
        ...(typeof data.recipientEmail === "string"
          ? [
              setDoc(
                doc(
                  recipientSharesCollection(data.recipientEmail),
                  invitation.id,
                ),
                update,
                { merge: true },
              ),
            ]
          : []),
      ];
    }),
  );
}

export async function listDocumentsSharedWithUser(
  email: string,
): Promise<SharedUserDocument[]> {
  const recipientEmail = email.trim().toLowerCase();
  if (!recipientEmail) return [];

  const snapshot = await getDocs(recipientSharesCollection(recipientEmail));
  return snapshot.docs.map((invitation, index) => {
    const data = invitation.data();
    if (
      typeof data.ownerId !== "string" ||
      typeof data.documentId !== "string" ||
      typeof data.title !== "string" ||
      typeof data.ownerName !== "string" ||
      typeof data.kind !== "string" ||
      typeof data.url !== "string" ||
      typeof data.createdAt !== "string" ||
      typeof data.updatedAt !== "string" ||
      (data.thumbnailUrl !== undefined &&
        data.thumbnailUrl !== null &&
        typeof data.thumbnailUrl !== "string") ||
      (data.templateId !== null && typeof data.templateId !== "string")
    ) {
      throw new Error(`The invitation "${invitation.id}" has invalid metadata.`);
    }

    const colors = [
      "avatar-violet",
      "avatar-green",
      "avatar-orange",
      "avatar-blue",
    ];
    return {
      id: invitation.id,
      documentId: data.documentId,
      ownerId: data.ownerId,
      title: data.title,
      owner: data.ownerName,
      initials: initials(data.ownerName),
      date: `Modifié le ${new Date(data.updatedAt).toLocaleDateString("fr-FR")}`,
      updatedAt: data.updatedAt,
      kind: data.kind,
      color: colors[index % colors.length],
      url: data.url,
      templateId: data.templateId,
      thumbnailUrl:
        typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null,
    };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
