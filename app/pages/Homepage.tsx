"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import { onAuthStateChanged } from "firebase/auth";
import PizZip from "pizzip";
import AuthController from "../Controllers/AuthController";
import DocxEditor from "../components/DocxEditor";
import DocxPagePreview from "../components/DocxPagePreview";
import DocIcon from "../components/DocIcon";
import DocumentPage from "../components/DocumentPage";
import GoogleMark from "../components/GoogleMark";
import Icon from "../components/Icon";
import RecentCard from "../components/RecentCard";
import TemplateThumbnail from "../components/TemplateThumbnail";
import type { TemplateItem } from "../data/documents";
import { auth } from "../Firebase/Config";
import {
  deleteUserDocuments,
  listUserDocuments,
  saveUserDocument,
} from "../Services/Documents";
import type { UserDocument } from "../Services/Documents";
import {
  createGenerationFolder,
  deleteGenerationFile,
  deleteGenerationFolder,
  listGenerationFiles,
  listGenerationFolders,
  renameGenerationFile,
  renameGenerationFolder,
  saveGenerationFile,
} from "../Services/GenerationHistory";
import type {
  GenerationFile,
  GenerationFolder,
} from "../Services/GenerationHistory";
import {
  createLocalGenerationFolder,
  deleteLocalGenerationFile,
  deleteLocalGenerationFolder,
  listLocalGenerationFiles,
  listLocalGenerationFolders,
  renameLocalGenerationFile,
  renameLocalGenerationFolder,
  saveLocalGenerationFile,
} from "../lib/local-generation-history";
import { documentPreviewKind, isSvgThumbnail } from "../lib/document-preview-kind";
import {
  inviteUserToDocument,
  listDocumentsSharedWithUser,
  updateSharedDocumentInvitations,
} from "../Services/DocumentSharing";
import type { SharedUserDocument } from "../Services/DocumentSharing";
import {
  ANONYMOUS_GENERATED_DOCUMENT_LIMIT,
  ANONYMOUS_UPLOAD_LIMIT,
  getAnonymousUsage,
  recordAnonymousGeneration,
  recordAnonymousUpload,
} from "../lib/anonymous-usage";
import {
  deleteRecentDocuments,
  readRecentDocuments,
  saveRecentDocument,
} from "../lib/recent-documents";
import type { RecentDocument } from "../lib/recent-documents";
import type { StoredTemplate } from "../lib/template-store";

interface SignedInUser {
  uid: string;
  name: string;
  email: string;
  photoURL: string;
}

interface DashboardDocument {
  id?: string;
  title: string;
  fileName?: string;
  date: string;
  kind: string;
  url?: string;
  templateId?: string | null;
  thumbnailUrl?: string | null;
  storageProvider?: "local" | "cloudinary";
  collectionPath?: "root" | "legacy";
  updatedAt?: string;
  shared?: boolean;
}

interface SavedDocumentAsset {
  id: string;
  title: string;
  fileName: string;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

interface BundledDocxTemplate {
  id: string;
  name: string;
}

type GenerationRenameTarget =
  | { kind: "folder"; folder: GenerationFolder }
  | { kind: "file"; folder: GenerationFolder; file: GenerationFile };

function formatUserDocuments(
  records: Array<UserDocument | RecentDocument>,
): DashboardDocument[] {
  return records.map((record) => {
    const date =
      "updatedAt" in record
        ? new Date(record.updatedAt).toLocaleDateString("fr-FR")
        : record.date;
    return {
      id: record.id,
      title: record.title,
      fileName: "fileName" in record ? record.fileName : record.title,
      date,
      kind: record.kind,
      url: record.url,
      templateId: record.templateId,
      thumbnailUrl: record.thumbnailUrl,
      storageProvider:
        "storageProvider" in record ? record.storageProvider : "local",
      collectionPath:
        "collectionPath" in record ? record.collectionPath : undefined,
      updatedAt:
        "updatedAt" in record ? record.updatedAt : record.createdAt,
    };
  });
}

function getUserInitials(name: string, email: string) {
  const label = name.trim() || email.split("@")[0] || email;
  return label
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function isFirestorePermissionDenied(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "permission-denied"
  );
}

function isCloudinaryRawAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "res.cloudinary.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/[a-z0-9_-]+\/raw\/upload\//i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function normalizeDocumentTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function generationFilePreviewKind(file: GenerationFile): string {
  return documentPreviewKind(file.title, file.fileName, file.kind);
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

async function uploadDocumentAsset(file: File): Promise<SavedDocumentAsset> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/documents", {
    method: "POST",
    body: formData,
  });
  const result = (await response.json()) as {
    document?: SavedDocumentAsset;
    error?: string;
  };
  if (!response.ok || !result.document) {
    throw new Error(result.error ?? `Impossible d’enregistrer « ${file.name} ».`);
  }
  return result.document;
}

async function extractGeneratedDocxFiles(archiveBlob: Blob): Promise<File[]> {
  const archive = new PizZip(new Uint8Array(await archiveBlob.arrayBuffer()));
  const entries = Object.values(archive.files).filter(
    (entry) => !entry.dir && /\.docx$/i.test(entry.name),
  );
  return entries.map((entry) => {
    const fileName = entry.name.split("/").pop() || "document.docx";
    return new File([entry.asArrayBuffer()], fileName, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });
}

async function saveCloudinaryGenerationFile(
  userId: string | null,
  folderId: string,
  file: File,
  title: string,
  kind: GenerationFile["kind"],
): Promise<GenerationFile> {
  const asset = await uploadDocumentAsset(file);
  const generationFile: GenerationFile = {
    id: asset.id,
    title,
    fileName: asset.fileName,
    kind,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl,
    createdAt: asset.createdAt,
  };
  if (userId) {
    await saveGenerationFile(userId, folderId, generationFile);
  } else {
    saveLocalGenerationFile(folderId, generationFile);
  }
  return generationFile;
}

export default function Homepage() {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [items, setItems] = useState<DashboardDocument[]>([]);
  const [filter, setFilter] = useState<"Tous" | "Mes documents">("Tous");
  const [sortNewest, setSortNewest] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [uploadedTemplates, setUploadedTemplates] = useState<StoredTemplate[]>([]);
  const [bundledDocxTemplates, setBundledDocxTemplates] = useState<BundledDocxTemplate[]>([]);
  const [importingBundledTemplateId, setImportingBundledTemplateId] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [editorStage, setEditorStage] = useState<
    "choose" | "edit" | "generate"
  >("choose");
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [generationMode, setGenerationMode] = useState<
    "choose" | "single" | "batch"
  >("choose");
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  const [generationFolders, setGenerationFolders] = useState<GenerationFolder[]>([]);
  const [isLoadingGenerationFolders, setIsLoadingGenerationFolders] = useState(false);
  const [generationFolderSelection, setGenerationFolderSelection] = useState("new");
  const [newGenerationFolderName, setNewGenerationFolderName] = useState("");
  const [isSavingGeneration, setIsSavingGeneration] = useState(false);
  const [openedGenerationFolder, setOpenedGenerationFolder] =
    useState<GenerationFolder | null>(null);
  const [openedGenerationFiles, setOpenedGenerationFiles] = useState<GenerationFile[]>([]);
  const [selectedGenerationFileIds, setSelectedGenerationFileIds] = useState<string[]>([]);
  const [isLoadingGenerationFiles, setIsLoadingGenerationFiles] = useState(false);
  const [generationFolderAction, setGenerationFolderAction] = useState(false);
  const [generationRenameTarget, setGenerationRenameTarget] =
    useState<GenerationRenameTarget | null>(null);
  const [generationRenameValue, setGenerationRenameValue] = useState("");
  const [generationRenameError, setGenerationRenameError] = useState("");
  const [isRenamingGenerationItem, setIsRenamingGenerationItem] = useState(false);
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const [docxError, setDocxError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState("");
  const [appsOpen, setAppsOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);
  const [authError, setAuthError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [sharedItems, setSharedItems] = useState<SharedUserDocument[]>([]);
  const [shareTargets, setShareTargets] = useState<DashboardDocument[]>([]);
  const [shareEmail, setShareEmail] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [isBulkActionRunning, setIsBulkActionRunning] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authEmailTouched, setAuthEmailTouched] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const generationUserId = user?.uid ?? null;

  useEffect(() => {
    let active = true;
    void fetch("/api/templates", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Impossible de charger vos modèles.");
        return (await response.json()) as { templates: StoredTemplate[] };
      })
      .then((result) => {
        if (active) setUploadedTemplates(result.templates);
      })
      .catch(() => {
        if (active) setToast("Impossible de charger vos modèles enregistrés.");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/docx-templates", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Impossible de charger les modèles DOCX.");
        return (await response.json()) as { templates: BundledDocxTemplate[] };
      })
      .then((result) => {
        if (active) setBundledDocxTemplates(result.templates);
      })
      .catch((error: unknown) => {
        if (active) {
          setToast(
            error instanceof Error
              ? error.message
              : "Impossible de charger les modèles DOCX.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let authChangeVersion = 0;
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const currentVersion = ++authChangeVersion;
      setSelectedDocumentIds([]);
      setSelectedTemplateIds([]);
      if (!firebaseUser) {
        setUser(null);
        setProfileOpen(false);
        setSharedItems([]);
        setGenerationFolders([]);
        setIsLoadingGenerationFolders(false);
        try {
          setItems(formatUserDocuments(readRecentDocuments()));
        } catch (error) {
          setItems([]);
          setToast(
            error instanceof Error
              ? error.message
              : "Impossible de charger les documents récents.",
          );
        }
        return;
      }

      setItems([]);
      setSharedItems([]);
      setGenerationFolders([]);
      setIsLoadingGenerationFolders(true);
      setUser({
        uid: firebaseUser.uid,
        name:
          firebaseUser.displayName ||
          firebaseUser.email?.split("@")[0] ||
          "Utilisateur",
        email: firebaseUser.email ?? "",
        photoURL: firebaseUser.photoURL || "",
      });

      void (async () => {
        try {
          const profile = await AuthController.getProfile(firebaseUser);
          if (!active || currentVersion !== authChangeVersion) return;
          setUser({
            uid: firebaseUser.uid,
            name: profile.name,
            email: profile.email,
            photoURL: profile.profilePic || firebaseUser.photoURL || "",
          });

          const userDocuments = await listUserDocuments(firebaseUser.uid);
          if (active && currentVersion === authChangeVersion) {
            setItems(formatUserDocuments(userDocuments));
          }

          try {
            const sharedDocuments = await listDocumentsSharedWithUser(
              firebaseUser.email ?? "",
            );
            if (active && currentVersion === authChangeVersion) {
              setSharedItems(sharedDocuments);
            }
          } catch (error) {
            if (active && currentVersion === authChangeVersion) {
              setToast(
                error instanceof Error
                  ? `Impossible de charger les documents partagés : ${error.message}`
                  : "Impossible de charger les documents partagés.",
              );
            }
          }
        } catch (error) {
          if (active && currentVersion === authChangeVersion) {
            setToast(
              isFirestorePermissionDenied(error)
                ? "Vous êtes connecté, mais Firestore refuse l’accès à votre profil. Publiez firestore.rules dans Firebase Console > Firestore Database > Rules."
                : error instanceof Error
                  ? `Vous êtes connecté, mais impossible de charger votre compte : ${error.message}`
                  : "Vous êtes connecté, mais impossible de charger votre compte.",
            );
          }
        }
      })();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadFolders = generationUserId
      ? () => listGenerationFolders(generationUserId)
      : () => listLocalGenerationFolders();
    void Promise.resolve()
      .then(loadFolders)
      .then((folders) => {
        if (active) {
          setGenerationFolders(folders);
          setGenerationFolderSelection((current) =>
            current === "new" || folders.some((folder) => folder.id === current)
              ? current
              : "new",
          );
          setIsLoadingGenerationFolders(false);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setIsLoadingGenerationFolders(false);
          setToast(
            error instanceof Error
              ? `Impossible de charger les dossiers de génération : ${error.message}`
              : "Impossible de charger les dossiers de génération.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [generationUserId]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const requestSignIn = (message: string) => {
    setAuthMode("signin");
    setAuthError(message);
  };

  const closeGenerator = () => {
    if (
      isEditorDirty &&
      !window.confirm("Quitter l’éditeur ? Vos modifications non enregistrées seront perdues.")
    ) {
      return;
    }
    setSelectedTemplate(null);
    setActiveTemplateId(null);
    setIsEditorDirty(false);
    setDocxError("");
  };

  const filtered = useMemo(() => {
    const allItems: DashboardDocument[] =
      filter === "Tous"
        ? [
            ...items,
            ...sharedItems.map((item) => ({
              id: `shared-${item.id}`,
              title: item.title,
              date: item.date,
              kind: item.kind,
              url: item.url,
              templateId: item.templateId,
              thumbnailUrl: item.thumbnailUrl,
              updatedAt: item.updatedAt,
              shared: true,
            })),
          ]
        : items;
    const normalizedQuery = normalizeDocumentTitle(query);
    const matches = allItems.filter((item) =>
      normalizeDocumentTitle(item.title).includes(normalizedQuery),
    );
    return matches.sort((left, right) => {
      const leftDate = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightDate = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      return sortNewest ? rightDate - leftDate : leftDate - rightDate;
    });
  }, [filter, items, query, sharedItems, sortNewest]);

  const selectableItems = filtered.filter((item) => item.id && !item.shared);
  const selectedItems = items.filter(
    (item) => item.id && selectedDocumentIds.includes(item.id),
  );
  const allVisibleItemsSelected =
    selectableItems.length > 0 &&
    selectableItems.every(
      (item) => item.id && selectedDocumentIds.includes(item.id),
    );
  const visibleUploadedTemplates = uploadedTemplates.filter((template) =>
    items.some((item) => item.templateId === template.id),
  );
  const selectedUploadedTemplates = visibleUploadedTemplates.filter((template) =>
    selectedTemplateIds.includes(template.id),
  );

  const toggleDocumentSelection = (item: DashboardDocument) => {
    if (!item.id || item.shared) return;
    setSelectedDocumentIds((current) =>
      current.includes(item.id!)
        ? current.filter((id) => id !== item.id)
        : [...current, item.id!],
    );
  };

  const downloadSelectedDocuments = async () => {
    if (!selectedItems.length) return;
    setIsBulkActionRunning(true);
    try {
      const downloaded = await Promise.all(
        selectedItems.map(async (item) => {
          const downloadUrl =
            item.templateId &&
            item.url?.includes(`/api/templates/${item.templateId}`)
              ? `/api/templates/${encodeURIComponent(item.templateId)}/download`
              : item.url?.includes("res.cloudinary.com/")
                ? `/api/documents/download?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(item.fileName || item.title)}`
              : item.url;
          if (!downloadUrl) {
            throw new Error(`Aucun lien disponible pour « ${item.title} ».`);
          }
          const response = await fetch(downloadUrl);
          if (!response.ok) {
            throw new Error(
              `Impossible de télécharger « ${item.title} » (${response.status}).`,
            );
          }
          const blob = await response.blob();
          const fileName = (item.fileName || item.title || "document")
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
            .trim();
          return { fileName: fileName || "document", blob };
        }),
      );

      let blob: Blob;
      let filename: string;
      if (downloaded.length === 1) {
        blob = downloaded[0].blob;
        filename = downloaded[0].fileName;
      } else {
        const archive = new PizZip();
        const filenames = new Map<string, number>();
        for (const file of downloaded) {
          const previousCount = filenames.get(file.fileName) ?? 0;
          filenames.set(file.fileName, previousCount + 1);
          const extensionIndex = file.fileName.lastIndexOf(".");
          const hasExtension = extensionIndex > 0;
          const baseName = hasExtension
            ? file.fileName.slice(0, extensionIndex)
            : file.fileName;
          const extension = hasExtension
            ? file.fileName.slice(extensionIndex)
            : "";
          const archiveName =
            previousCount === 0
              ? file.fileName
              : `${baseName} (${previousCount + 1})${extension}`;
          archive.file(archiveName, await file.blob.arrayBuffer());
        }
        blob = archive.generate({ type: "blob" });
        filename = "documents-selection.zip";
      }

      downloadBlob(blob, filename);
      notify(
        downloaded.length === 1
          ? "Téléchargement lancé."
          : `${downloaded.length} documents réunis dans une archive ZIP.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? `Téléchargement impossible : ${error.message}`
          : "Téléchargement impossible.",
      );
    } finally {
      setIsBulkActionRunning(false);
    }
  };

  const deleteSelectedDocuments = async () => {
    if (!selectedItems.length) return;
    if (
      !window.confirm(
        `Supprimer ${selectedItems.length} document${selectedItems.length > 1 ? "s" : ""} de votre bibliothèque ?`,
      )
    ) {
      return;
    }
    setIsBulkActionRunning(true);
    try {
      if (user) {
        const firestoreDocuments = selectedItems.flatMap((item) =>
          item.id && item.collectionPath
            ? [{ id: item.id, collectionPath: item.collectionPath }]
            : [],
        );
        if (firestoreDocuments.length !== selectedItems.length) {
          throw new Error("Les métadonnées Firestore de certains documents sont manquantes.");
        }
        await deleteUserDocuments(user.uid, firestoreDocuments);
        setItems(formatUserDocuments(await listUserDocuments(user.uid)));
      } else {
        setItems(formatUserDocuments(deleteRecentDocuments(selectedDocumentIds)));
      }
      setSelectedDocumentIds([]);
      notify("Documents supprimés de votre bibliothèque.");
    } catch (error) {
      notify(
        error instanceof Error
          ? `Suppression impossible : ${error.message}`
          : "Suppression impossible.",
      );
    } finally {
      setIsBulkActionRunning(false);
    }
  };

  const toggleTemplateSelection = (templateId: string) => {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  };

  const editSelectedTemplate = () => {
    if (selectedUploadedTemplates.length !== 1) return;
    openUploadedTemplate(selectedUploadedTemplates[0]);
    setSelectedTemplateIds([]);
  };

  const deleteSelectedTemplates = async () => {
    if (!selectedUploadedTemplates.length) return;
    if (
      !window.confirm(
        `Supprimer ${selectedUploadedTemplates.length} modèle${selectedUploadedTemplates.length > 1 ? "s" : ""} de votre bibliothèque ?`,
      )
    ) {
      return;
    }
    setIsBulkActionRunning(true);
    try {
      if (user) {
        const documentsToDelete = selectedUploadedTemplates.map((template) => {
          const record = items.find((item) => item.templateId === template.id);
          if (!record?.id || !record.collectionPath) {
            throw new Error(`Le modèle « ${template.name} » n’est pas enregistré dans votre bibliothèque.`);
          }
          return {
            id: record.id,
            collectionPath: record.collectionPath,
          };
        });
        await deleteUserDocuments(user.uid, documentsToDelete);
        setItems(formatUserDocuments(await listUserDocuments(user.uid)));
      } else {
        setItems(
          formatUserDocuments(
            deleteRecentDocuments(selectedUploadedTemplates.map(({ id }) => id)),
          ),
        );
      }
      setUploadedTemplates((current) =>
        current.filter(
          (template) => !selectedTemplateIds.includes(template.id),
        ),
      );
      setSelectedTemplateIds([]);
      notify(
        "Modèles supprimés de votre bibliothèque. Les fichiers déjà envoyés sur Cloudinary restent stockés.",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? `Suppression impossible : ${error.message}`
          : "Suppression impossible.",
      );
    } finally {
      setIsBulkActionRunning(false);
    }
  };

  const shareSelectedTemplates = () => {
    if (!user) {
      requestSignIn("Connectez-vous pour partager vos modèles.");
      return;
    }
    const targets = selectedUploadedTemplates.flatMap((template) => {
      const record = items.find((item) => item.templateId === template.id);
      return record?.id ? [record] : [];
    });
    if (targets.length !== selectedUploadedTemplates.length) {
      notify("Certains modèles doivent d’abord être enregistrés dans votre bibliothèque.");
      return;
    }
    setShareTargets(targets);
    setShareEmail("");
  };

  const openUploadedTemplate = (template: StoredTemplate) => {
    const templateTitle = template.name.replace(/\.docx$/i, "");
    setSelectedTemplate({
      title: templateTitle,
      subtitle: "Modèle Word",
      kind: "blank",
    });
    setActiveTemplateId(template.id);
    setEditorStage("choose");
    setGenerationMode("choose");
    setPlaceholders([]);
    setFieldValues({});
    setSpreadsheetFile(null);
    setGenerationFolderSelection("new");
    setNewGenerationFolderName(
      `${templateTitle} - ${new Date().toLocaleDateString("fr-FR")}`,
    );
    setIsEditorDirty(false);
    setDocxError("");
  };

  const importBundledDocxTemplate = async (bundledTemplate: BundledDocxTemplate) => {
    if (importingBundledTemplateId) return;
    setImportingBundledTemplateId(bundledTemplate.id);
    try {
      const response = await fetch(
        `/api/docx-templates/${encodeURIComponent(bundledTemplate.id)}/import`,
        { method: "POST" },
      );
      const result = (await response.json()) as {
        template?: StoredTemplate;
        error?: string;
      };
      if (!response.ok || !result.template) {
        throw new Error(result.error ?? "Impossible d’ajouter ce fichier DOCX.");
      }

      const template = result.template;
      setUploadedTemplates((current) => [
        template,
        ...current.filter((item) => item.id !== template.id),
      ]);
      if (user && template.cloudinary) {
        await saveUserDocument(user.uid, {
          id: template.id,
          title: template.name,
          fileName: template.name,
          kind: "template",
          templateId: template.id,
          url: template.cloudinary.url,
          thumbnailUrl: template.thumbnailUrl ?? null,
          storageProvider: "cloudinary",
          createdAt: template.createdAt,
        });
        setItems(formatUserDocuments(await listUserDocuments(user.uid)));
      } else if (!user) {
        setItems(
          formatUserDocuments(
            saveRecentDocument({
              id: template.id,
              title: template.name,
              date: new Date(template.createdAt).toLocaleDateString("fr-FR"),
              kind: "minimal",
              templateId: template.id,
              url: template.cloudinary?.url ?? `/api/templates/${template.id}`,
              thumbnailUrl: template.thumbnailUrl ?? null,
              createdAt: template.createdAt,
            }),
          ),
        );
      } else {
        throw new Error("Le modèle n’a pas été enregistré dans Cloudinary.");
      }

      openUploadedTemplate(template);
      notify(`« ${template.name} » a été ajouté à vos documents. Vous pouvez maintenant le modifier ou le télécharger.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Impossible d’ajouter ce fichier DOCX à vos documents.",
      );
    } finally {
      setImportingBundledTemplateId(null);
    }
  };

  const openDashboardDocument = async (item: DashboardDocument) => {
    if (item.shared) {
      if (item.url) {
        window.open(item.url, "_blank", "noopener,noreferrer");
      } else {
        notify("Le document partagé n’a pas de lien disponible.");
      }
      return;
    }

    if (item.templateId) {
      try {
        const response = await fetch(`/api/templates/${item.templateId}`, {
          cache: "no-store",
        });
        const result = (await response.json()) as {
          template?: StoredTemplate;
          error?: string;
        };
        if (!response.ok || !result.template) {
          throw new Error(result.error ?? "Ce document local est introuvable.");
        }
        openUploadedTemplate(result.template);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "Impossible d’ouvrir ce document.",
        );
      }
      return;
    }

    if (item.url?.includes("res.cloudinary.com/")) {
      const fileName = item.fileName || item.title;
      try {
        const response = await fetch(
          `/api/documents/download?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(fileName)}`,
        );
        if (!response.ok) {
          throw new Error(`Le téléchargement a échoué (${response.status}).`);
        }
        downloadBlob(await response.blob(), fileName);
      } catch (error) {
        notify(
          error instanceof Error
            ? `Téléchargement impossible : ${error.message}`
            : "Téléchargement impossible.",
        );
      }
      return;
    }

    if (item.url) {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }

    notify(`Ouverture de « ${item.title} »`);
  };

  const openSharedDocument = (item: SharedUserDocument) => {
    if (!item.url) {
      notify("Le document partagé n’a pas de lien disponible.");
      return;
    }
    window.open(item.url, "_blank", "noopener,noreferrer");
  };

  const openGenerationFolder = async (folder: GenerationFolder) => {
    setOpenedGenerationFolder(folder);
    setOpenedGenerationFiles([]);
    setSelectedGenerationFileIds([]);
    setIsLoadingGenerationFiles(true);
    try {
      const files =
        user
          ? await listGenerationFiles(user.uid, folder.id)
          : listLocalGenerationFiles(folder.id);
      const cloudinaryFiles = files.filter(
        (file) =>
          file.kind !== "archive" && isCloudinaryRawAssetUrl(file.url),
      );
      const staleFiles = files.filter(
        (file) =>
          file.kind === "archive" || !isCloudinaryRawAssetUrl(file.url),
      );
      if (staleFiles.length) {
        await Promise.all(
          staleFiles.map((file) =>
            user
              ? deleteGenerationFile(user.uid, folder.id, file.id)
              : Promise.resolve(deleteLocalGenerationFile(folder.id, file.id)),
          ),
        );
        notify(
          `${staleFiles.length} archive(s) ZIP ou entrée(s) invalide(s) ont été retirées du dossier.`,
        );
      }
      setOpenedGenerationFiles(cloudinaryFiles);
    } catch (error) {
      notify(
        error instanceof Error
          ? `Impossible de charger ce dossier : ${error.message}`
          : "Impossible de charger ce dossier.",
      );
    } finally {
      setIsLoadingGenerationFiles(false);
    }
  };

  const refreshGenerationFolders = async () => {
    setGenerationFolders(
      user
        ? await listGenerationFolders(user.uid)
        : listLocalGenerationFolders(),
    );
  };

  const refreshOpenedGenerationFiles = async (folder: GenerationFolder) => {
    setOpenedGenerationFiles(
      user
        ? await listGenerationFiles(user.uid, folder.id)
        : listLocalGenerationFiles(folder.id),
    );
    const folders = user
      ? await listGenerationFolders(user.uid)
      : listLocalGenerationFolders();
    setGenerationFolders(folders);
    const updatedFolder = folders.find((item) => item.id === folder.id);
    if (updatedFolder) setOpenedGenerationFolder(updatedFolder);
    setSelectedGenerationFileIds([]);
  };

  const editGenerationFolder = (folder: GenerationFolder) => {
    setGenerationRenameTarget({ kind: "folder", folder });
    setGenerationRenameValue(folder.name);
    setGenerationRenameError("");
  };

  const editGenerationFile = (
    folder: GenerationFolder,
    file: GenerationFile,
  ) => {
    setGenerationRenameTarget({ kind: "file", folder, file });
    setGenerationRenameValue(file.fileName);
    setGenerationRenameError("");
  };

  const closeGenerationRename = () => {
    if (isRenamingGenerationItem) return;
    setGenerationRenameTarget(null);
    setGenerationRenameValue("");
    setGenerationRenameError("");
  };

  const saveGenerationRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!generationRenameTarget) return;

    const name = generationRenameValue.trim();
    if (!name) {
      setGenerationRenameError("Le nom ne peut pas être vide.");
      return;
    }
    if (generationRenameTarget.kind === "folder" && name.length > 80) {
      setGenerationRenameError("Le nom du dossier ne peut pas dépasser 80 caractères.");
      return;
    }

    if (generationRenameTarget.kind === "file") {
      const originalExtension =
        generationRenameTarget.file.fileName.match(/\.[^.]+$/)?.[0] ?? "";
      const requestedExtension = name.match(/\.[^.]+$/)?.[0] ?? "";
      if (name.length > 255) {
        setGenerationRenameError("Le nom du fichier ne peut pas dépasser 255 caractères.");
        return;
      }
      if (/[\\/]/.test(name)) {
        setGenerationRenameError("Le nom du fichier ne peut pas contenir de barre oblique.");
        return;
      }
      if (originalExtension.toLowerCase() !== requestedExtension.toLowerCase()) {
        setGenerationRenameError(`Conservez l’extension « ${originalExtension} » du fichier.`);
        return;
      }
      if (name === generationRenameTarget.file.fileName) {
        closeGenerationRename();
        return;
      }
    } else if (name === generationRenameTarget.folder.name) {
      closeGenerationRename();
      return;
    }

    setIsRenamingGenerationItem(true);
    try {
      if (generationRenameTarget.kind === "folder") {
        const { folder } = generationRenameTarget;
        if (user) {
          await renameGenerationFolder(user.uid, folder.id, name);
        } else {
          renameLocalGenerationFolder(folder.id, name);
        }
        await refreshGenerationFolders();
        if (openedGenerationFolder?.id === folder.id) {
          setOpenedGenerationFolder({ ...folder, name });
        }
        notify("Le dossier a été renommé.");
      } else {
        const { folder, file } = generationRenameTarget;
        if (user) {
          await renameGenerationFile(user.uid, folder.id, file.id, name, name);
        } else {
          renameLocalGenerationFile(folder.id, file.id, name, name);
        }
        await refreshOpenedGenerationFiles(folder);
        notify("Le fichier a été renommé.");
      }
    } catch (error) {
      setGenerationRenameError(
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer le nouveau nom.",
      );
    } finally {
      setIsRenamingGenerationItem(false);
    }
  };

  const removeGenerationFolder = async (folder: GenerationFolder) => {
    if (
      !window.confirm(
        `Supprimer le dossier « ${folder.name} » et les références à ses fichiers ? Les fichiers restent stockés dans Cloudinary.`,
      )
    ) {
      return;
    }
    try {
      if (user) {
        await deleteGenerationFolder(user.uid, folder.id);
      } else {
        deleteLocalGenerationFolder(folder.id);
      }
      await refreshGenerationFolders();
      if (openedGenerationFolder?.id === folder.id) {
        setOpenedGenerationFolder(null);
        setOpenedGenerationFiles([]);
      }
      notify("Le dossier a été supprimé de votre historique.");
    } catch (error) {
      notify(
        error instanceof Error
          ? `Impossible de supprimer le dossier : ${error.message}`
          : "Impossible de supprimer le dossier.",
      );
    }
  };

  const fetchGenerationFile = async (file: GenerationFile): Promise<Blob> => {
    const response = await fetch(
      `/api/documents/download?url=${encodeURIComponent(file.url)}&filename=${encodeURIComponent(file.fileName)}`,
    );
    if (!response.ok) {
      throw new Error(`Le téléchargement a échoué (${response.status}).`);
    }
    return response.blob();
  };

  const downloadGenerationFiles = async (
    files: GenerationFile[],
    archiveName: string,
  ) => {
    if (!files.length) return;
    setGenerationFolderAction(true);
    try {
      if (files.length === 1 && archiveName === "") {
        const file = files[0];
        downloadBlob(await fetchGenerationFile(file), file.fileName);
        notify(`Téléchargement de « ${file.fileName} » lancé.`);
        return;
      }

      const response = await fetch("/api/documents/download-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archiveName,
          files: files.map(({ url, fileName }) => ({ url, fileName })),
        }),
      });
      if (!response.ok) {
        let message = `Le téléchargement a échoué (${response.status}).`;
        try {
          const result = (await response.json()) as { error?: unknown };
          if (typeof result.error === "string") message = result.error;
        } catch {
          // Keep the HTTP status message when the server response is not JSON.
        }
        throw new Error(message);
      }
      const safeArchiveName = archiveName
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .trim();
      downloadBlob(await response.blob(), safeArchiveName || "documents.zip");
      notify(
        files.length === openedGenerationFiles.length
          ? `Le dossier « ${openedGenerationFolder?.name ?? ""} » a été téléchargé.`
          : `${files.length} fichier(s) téléchargé(s) dans une archive ZIP.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? `Impossible de télécharger les fichiers : ${error.message}`
          : "Impossible de télécharger les fichiers.",
      );
    } finally {
      setGenerationFolderAction(false);
    }
  };

  const removeSelectedGenerationFiles = async () => {
    const folder = openedGenerationFolder;
    const files = openedGenerationFiles.filter((file) =>
      selectedGenerationFileIds.includes(file.id),
    );
    if (!folder || !files.length) return;
    if (!window.confirm(`Retirer ${files.length} fichier(s) du dossier « ${folder.name} » ? Les fichiers restent stockés dans Cloudinary.`)) return;
    setGenerationFolderAction(true);
    try {
      await Promise.all(
        files.map((file) =>
          user
            ? deleteGenerationFile(user.uid, folder.id, file.id)
            : Promise.resolve(deleteLocalGenerationFile(folder.id, file.id)),
        ),
      );
      await refreshOpenedGenerationFiles(folder);
      notify(`${files.length} fichier(s) retiré(s) du dossier.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? `Impossible de supprimer les fichiers : ${error.message}`
          : "Impossible de supprimer les fichiers.",
      );
    } finally {
      setGenerationFolderAction(false);
    }
  };

  const shareRecentDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !shareTargets.length || shareTargets.some((target) => !target.id)) {
      notify("Connectez-vous pour partager un document.");
      return;
    }

    setIsSharing(true);
    try {
      await Promise.all(
        shareTargets.map((target) =>
          inviteUserToDocument(
            user.uid,
            user.name,
            target.id!,
            shareEmail,
          ),
        ),
      );
      const sharedCount = shareTargets.length;
      setShareTargets([]);
      setShareEmail("");
      setSelectedTemplateIds([]);
      notify(
        `${sharedCount} document${sharedCount > 1 ? "s" : ""} partagé${sharedCount > 1 ? "s" : ""} avec ${shareEmail.trim()}.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? `Impossible de partager le document : ${error.message}`
          : "Impossible de partager le document.",
      );
    } finally {
      setIsSharing(false);
    }
  };

  const uploadDocxFile = async (file?: File) => {
    if (!file) return;

    setDocxError("");
    if (!user) {
      try {
        const usage = getAnonymousUsage();
        if (usage.uploads >= ANONYMOUS_UPLOAD_LIMIT) {
          requestSignIn(
            `Vous avez utilisé vos ${ANONYMOUS_UPLOAD_LIMIT} importations gratuites. Connectez-vous pour continuer.`,
          );
          if (docxInputRef.current) docxInputRef.current.value = "";
          return;
        }
      } catch (error) {
        setDocxError(
          error instanceof Error
            ? error.message
            : "Impossible de vérifier votre limite d’importation.",
        );
        return;
      }
    }

    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        template?: StoredTemplate;
        error?: string;
      };

      if (!response.ok || !result.template) {
        throw new Error(result.error ?? "Impossible d’importer ce document.");
      }

      if (!user) {
        try {
          recordAnonymousUpload();
          setItems(
            formatUserDocuments(
              saveRecentDocument({
                id: result.template.id,
                title: result.template.name,
                date: new Date(result.template.createdAt).toLocaleDateString("fr-FR"),
                kind: "minimal",
                templateId: result.template.id,
                url:
                  result.template.cloudinary?.url ??
                  `/api/templates/${result.template.id}`,
                thumbnailUrl: result.template.thumbnailUrl ?? null,
                createdAt: result.template.createdAt,
              }),
            ),
          );
        } catch (error) {
          notify(
            error instanceof Error
              ? `Le modèle a été importé, mais son historique local n’a pas pu être enregistré : ${error.message}`
              : "Le modèle a été importé, mais son historique local n’a pas pu être enregistré.",
          );
        }
      }

      setUploadedTemplates((current) => [
        result.template as StoredTemplate,
        ...current.filter((template) => template.id !== result.template?.id),
      ]);
      let libraryWarning = "";
      if (user) {
        try {
          await saveUserDocument(user.uid, {
            id: result.template.id,
            title: result.template.name,
            fileName: result.template.name,
            kind: "template",
            templateId: result.template.id,
            url: result.template.cloudinary?.url ?? `/api/templates/${result.template.id}`,
            thumbnailUrl: result.template.thumbnailUrl ?? null,
            storageProvider: result.template.cloudinary ? "cloudinary" : "local",
          });
          const userDocuments = await listUserDocuments(user.uid);
          setItems(formatUserDocuments(userDocuments));
        } catch (error) {
          libraryWarning =
            error instanceof Error
              ? `Le document a été importé dans Cloudinary, mais son lien n’a pas pu être enregistré dans Firebase : ${error.message}`
              : "Le document a été importé dans Cloudinary, mais son lien n’a pas pu être enregistré dans Firebase.";
        }
      }
      setSelectedTemplate(null);
      setActiveTemplateId(null);
      if (!user) {
        notify("Modèle importé. Connectez-vous pour l’enregistrer dans votre bibliothèque.");
      } else if (libraryWarning) {
        notify(libraryWarning);
      } else {
        notify("Document importé dans Cloudinary et enregistré dans votre bibliothèque Firebase.");
      }
    } catch (error) {
      setDocxError(
        error instanceof Error
          ? error.message
          : "La connexion a échoué. Réessayez dans quelques instants.",
      );
    } finally {
      setIsUploading(false);
      if (docxInputRef.current) docxInputRef.current.value = "";
    }
  };

  const finishEditingTemplate = async () => {
    if (!activeTemplateId) return;
    try {
      const templateResponse = await fetch(
        `/api/templates/${activeTemplateId}`,
        { cache: "no-store" },
      );
      const templateResult = (await templateResponse.json()) as {
        template?: StoredTemplate;
        error?: string;
      };
      if (!templateResponse.ok || !templateResult.template) {
        throw new Error(
          templateResult.error ?? "Impossible de charger le modèle enregistré.",
        );
      }

      if (user && templateResult.template.cloudinary) {
        try {
          await saveUserDocument(user.uid, {
            id: templateResult.template.id,
            title: templateResult.template.name,
            fileName: templateResult.template.name,
            kind: "template",
            templateId: templateResult.template.id,
            url: templateResult.template.cloudinary.url,
            thumbnailUrl: templateResult.template.thumbnailUrl ?? null,
            storageProvider: "cloudinary",
          });
          await updateSharedDocumentInvitations(
            user.uid,
            templateResult.template.id,
            templateResult.template.name,
            templateResult.template.cloudinary.url,
            templateResult.template.thumbnailUrl ?? null,
          );
          setItems(formatUserDocuments(await listUserDocuments(user.uid)));
        } catch (error) {
          notify(
            error instanceof Error
              ? `Le modèle est enregistré, mais sa bibliothèque ou ses partages n’ont pas pu être actualisés : ${error.message}`
              : "Le modèle est enregistré, mais sa bibliothèque ou ses partages n’ont pas pu être actualisés.",
          );
        }
      }

      const response = await fetch(`/api/templates/${activeTemplateId}/inspect`, {
        cache: "no-store",
      });
      const result = (await response.json()) as {
        placeholders?: string[];
        error?: string;
      };
      if (!response.ok || !result.placeholders) {
        setDocxError(
          result.error ??
            "Ajoutez au moins un champ entre accolades, par exemple {nom}, puis enregistrez le modèle.",
        );
        return;
      }
      setPlaceholders(result.placeholders);
      setFieldValues(
        Object.fromEntries(result.placeholders.map((name) => [name, ""])),
      );
      setGenerationMode("choose");
      setSpreadsheetFile(null);
      setDocxError("");
      setEditorStage("choose");
    } catch (error) {
      setDocxError(
        error instanceof Error
          ? error.message
          : "Impossible de lire les champs du modèle. Vérifiez votre connexion et réessayez.",
      );
    }
  };

  const generateDocxFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeTemplateId || generationMode === "choose") return;

    setDocxError("");
    if (generationMode === "batch" && !spreadsheetFile) {
      setDocxError("Choisissez un fichier Excel ou CSV.");
      return;
    }
    if (generationFolderSelection === "new" && !newGenerationFolderName.trim()) {
      setDocxError("Saisissez un nom pour le nouveau dossier.");
      return;
    }
    if (
      generationFolderSelection !== "new" &&
      !generationFolders.some((folder) => folder.id === generationFolderSelection)
    ) {
      setDocxError("Le dossier sélectionné n’existe plus. Actualisez la page.");
      return;
    }

    let anonymousAllowance: number | null = null;
    if (!user) {
      try {
        const usage = getAnonymousUsage();
        anonymousAllowance =
          ANONYMOUS_GENERATED_DOCUMENT_LIMIT - usage.generatedDocuments;
        if (anonymousAllowance <= 0) {
          requestSignIn(
            `Vous avez généré vos ${ANONYMOUS_GENERATED_DOCUMENT_LIMIT} documents gratuits. Connectez-vous pour continuer.`,
          );
          return;
        }
      } catch (error) {
        setDocxError(
          error instanceof Error
            ? error.message
            : "Impossible de vérifier votre limite de génération.",
        );
        return;
      }
    }

    const formData = new FormData();
    formData.append("templateId", activeTemplateId);
    if (anonymousAllowance !== null) {
      formData.append("anonymousDocumentAllowance", String(anonymousAllowance));
    }
    if (generationMode === "batch") {
      if (!spreadsheetFile) return;
      formData.append("spreadsheet", spreadsheetFile);
    } else {
      formData.append("values", JSON.stringify(fieldValues));
    }

    setIsGeneratingDocx(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        if (response.status === 403) {
          requestSignIn(
            result.error ??
              "Connectez-vous pour générer davantage de documents.",
          );
          return;
        }
        setDocxError(result.error ?? "La génération du document a échoué.");
        return;
      }
      const generatedCount = Number(
        response.headers.get("x-generated-document-count"),
      );
      if (!Number.isSafeInteger(generatedCount) || generatedCount < 1) {
        throw new Error("Le serveur n’a pas indiqué combien de documents ont été générés.");
      }
      if (!user) recordAnonymousGeneration(generatedCount);

      const outputBlob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const outputFilename =
        (encodedFilename && decodeURIComponent(encodedFilename)) ||
        (generationMode === "batch" ? "documents-generes.zip" : "document-complete.docx");
      const generatedAt = new Date();
      const generatedTimestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
      const downloadFilename = outputFilename.replace(
        /(\.[^.]+)$/,
        `-${generatedTimestamp}$1`,
      );
      downloadBlob(outputBlob, downloadFilename);
      setIsGeneratingDocx(false);
      setIsSavingGeneration(true);
      const warnings: string[] = [];
      const generatedTitle =
        generationMode === "batch"
          ? `Documents générés depuis ${selectedTemplate?.title ?? "le modèle"} · ${generatedAt.toLocaleString("fr-FR")}`
          : downloadFilename;

      let folder: GenerationFolder | null = null;
      try {
        folder =
          generationFolderSelection === "new"
            ? user
              ? await createGenerationFolder(user.uid, newGenerationFolderName)
              : createLocalGenerationFolder(newGenerationFolderName)
            : generationFolders.find(
                (candidate) => candidate.id === generationFolderSelection,
              ) ?? null;
        if (!folder) throw new Error("Le dossier choisi est introuvable.");
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Le téléchargement est prêt, mais le dossier n’a pas pu être créé ou ouvert : ${error.message}`
            : "Le téléchargement est prêt, mais le dossier n’a pas pu être créé ou ouvert.",
        );
      }

      const savedFiles: GenerationFile[] = [];
      if (folder) {
        if (generationMode === "batch") {
          try {
            const generatedFiles = await extractGeneratedDocxFiles(outputBlob);
            if (generatedFiles.length !== generatedCount) {
              warnings.push(
                `L’archive contient ${generatedFiles.length} document(s) DOCX sur ${generatedCount} attendu(s).`,
              );
            }
            for (const generatedFile of generatedFiles) {
              try {
                savedFiles.push(
                  await saveCloudinaryGenerationFile(
                    user?.uid ?? null,
                    folder.id,
                    generatedFile,
                    generatedFile.name,
                    "generated",
                  ),
                );
              } catch (error) {
                warnings.push(
                  error instanceof Error
                    ? `« ${generatedFile.name} » n’a pas pu être ajouté au dossier : ${error.message}`
                    : `« ${generatedFile.name} » n’a pas pu être ajouté au dossier.`,
                );
              }
            }
          } catch (error) {
            warnings.push(
              error instanceof Error
                ? `Les documents n’ont pas pu être extraits de l’archive : ${error.message}`
                : "Les documents n’ont pas pu être extraits de l’archive.",
            );
          }
        } else {
          try {
            const generatedFile = new File([outputBlob], downloadFilename, {
              type: outputBlob.type || "application/octet-stream",
            });
            savedFiles.push(
              await saveCloudinaryGenerationFile(
                user?.uid ?? null,
                folder.id,
                generatedFile,
                generatedTitle,
                "generated",
              ),
            );
          } catch (error) {
            warnings.push(
              error instanceof Error
                ? `Le résultat n’a pas pu être ajouté au dossier : ${error.message}`
                : "Le résultat n’a pas pu être ajouté au dossier.",
            );
          }
        }

        if (generationMode === "batch" && spreadsheetFile) {
          try {
            savedFiles.push(
              await saveCloudinaryGenerationFile(
                user?.uid ?? null,
                folder.id,
                spreadsheetFile,
                `Tableur source — ${spreadsheetFile.name}`,
                "source",
              ),
            );
          } catch (error) {
            warnings.push(
              error instanceof Error
                ? `Le tableur source n’a pas pu être ajouté au dossier : ${error.message}`
                : "Le tableur source n’a pas pu être ajouté au dossier.",
            );
          }
        }

        if (!user) {
          try {
            let recent = readRecentDocuments();
            for (const file of savedFiles) {
              recent = saveRecentDocument({
                id: file.id,
                title: file.title,
                date: new Date(file.createdAt).toLocaleDateString("fr-FR"),
                kind: file.kind === "source" ? "data" : "minimal",
                templateId: null,
                url: file.url,
                createdAt: file.createdAt,
              });
            }
            setItems(formatUserDocuments(recent));
          } catch (error) {
            warnings.push(
              error instanceof Error
                ? `Les fichiers sont dans le dossier, mais l’historique récent local n’a pas pu être actualisé : ${error.message}`
                : "Les fichiers sont dans le dossier, mais l’historique récent local n’a pas pu être actualisé.",
            );
          }
        }
      }

      try {
        await refreshGenerationFolders();
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Le dossier a été enregistré, mais la liste n’a pas pu être actualisée : ${error.message}`
            : "Le dossier a été enregistré, mais la liste n’a pas pu être actualisée.",
        );
      }

      setQuery("");
      setSelectedTemplate(null);
      setActiveTemplateId(null);
      notify(
        warnings.length
          ? `« ${generatedTitle} » a été téléchargé. ${warnings.join(" ")}`
          : `« ${generatedTitle} » a été enregistré dans « ${folder?.name ?? "votre dossier"} ».`,
      );
    } catch (error) {
      setDocxError(
        error instanceof Error
          ? error.message
          : "La connexion a échoué. Réessayez dans quelques instants.",
      );
    } finally {
      setIsGeneratingDocx(false);
      setIsSavingGeneration(false);
    }
  };

  const changeGenerationMode = (mode: "single" | "batch") => {
    setGenerationMode(mode);
    setDocxError("");
    setSpreadsheetFile(null);
  };

  const selectGenerationMode = async (mode: "single" | "batch") => {
    if (!activeTemplateId) return;
    setDocxError("");
    try {
      const response = await fetch(`/api/templates/${activeTemplateId}/inspect`, {
        cache: "no-store",
      });
      const result = (await response.json()) as {
        placeholders?: string[];
        error?: string;
      };
      if (!response.ok || !result.placeholders?.length) {
        throw new Error(
          result.placeholders?.length
            ? result.error
            : "Aucun champ à remplir n’a été trouvé. Modifiez le modèle et écrivez les champs entre accolades, par exemple {nom}.",
        );
      }
      setPlaceholders(result.placeholders);
      setFieldValues(
        Object.fromEntries(result.placeholders.map((name) => [name, ""])),
      );
      setGenerationMode(mode);
      setSpreadsheetFile(null);
      setEditorStage("generate");
    } catch (error) {
      setDocxError(
        error instanceof Error
          ? error.message
          : "Impossible de lire les champs du modèle. Vérifiez votre connexion et réessayez.",
      );
    }
  };

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const name = String(data.get("name") || "").trim();
    if (!isValidEmail(email)) return setAuthError("Saisissez une adresse e-mail valide.");
    if (password.length < 6 || password.length > 128) {
      return setAuthError("Le mot de passe doit contenir entre 6 et 128 caractères.");
    }
    if (authMode === "signup" && name.length < 2) return setAuthError("Saisissez votre nom complet.");
    setAuthError("");
    setIsAuthenticating(true);
    try {
      if (authMode === "signup") {
        await AuthController.handleSignup(email, password, { name });
      } else {
        await AuthController.handleLogin(email, password);
      }
      setAuthMode(null);
      setAuthPassword("");
      notify(`Bienvenue sur DocuGen, ${(name || email.split("@")[0]).split(" ")[0]}`);
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Impossible de vous connecter. Réessayez.",
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  const signInWithGoogle = async () => {
    setAuthError("");
    setIsAuthenticating(true);
    try {
      const profile = await AuthController.handleGoogleLogin();
      setAuthMode(null);
      notify(`Bienvenue sur DocuGen, ${profile.name.split(" ")[0]}`);
    } catch (error) {
      setAuthError(AuthController.getGoogleSignInErrorMessage(error));
    } finally {
      setIsAuthenticating(false);
    }
  };

  const resetPassword = async () => {
    if (!isValidEmail(authEmail.trim())) {
      setAuthError("Saisissez une adresse e-mail valide pour recevoir le lien.");
      return;
    }

    setAuthError("");
    try {
      await AuthController.handleForgotPassword(authEmail.trim());
      notify("Un lien de réinitialisation a été envoyé par e-mail.");
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Impossible d’envoyer le lien de réinitialisation.",
      );
    }
  };

  const signOut = async () => {
    setProfileOpen(false);
    try {
      await AuthController.handleLogout();
      notify("Vous êtes maintenant déconnecté");
    } catch (error) {
      notify(
        error instanceof Error
          ? `Impossible de se déconnecter : ${error.message}`
          : "Impossible de se déconnecter.",
      );
    }
  };

  const generationFolderControls = () => (
    <div className="generation-folder-controls">
      <label htmlFor="generation-folder-destination">Enregistrer dans un dossier</label>
      <select
        id="generation-folder-destination"
        value={generationFolderSelection}
        onChange={(event) => setGenerationFolderSelection(event.target.value)}
        disabled={isLoadingGenerationFolders || isSavingGeneration}
      >
        <option value="new">Créer un nouveau dossier</option>
        {generationFolders.map((folder) => (
          <option value={folder.id} key={folder.id}>{folder.name}</option>
        ))}
      </select>
      {generationFolderSelection === "new" && (
        <input
          type="text"
          maxLength={80}
          value={newGenerationFolderName}
          onChange={(event) => setNewGenerationFolderName(event.target.value)}
          placeholder="Nom du nouveau dossier"
          aria-label="Nom du nouveau dossier de génération"
          required
          disabled={isSavingGeneration}
        />
      )}
      {user ? (
        <p>
          Le fichier généré et, pour Excel/CSV, le fichier source seront enregistrés dans ce dossier.
        </p>
      ) : (
        <p>
          Vos fichiers seront conservés dans un dossier de ce navigateur. Connectez-vous pour synchroniser votre historique.
          {" "}
          <button
            type="button"
            className="text-button"
            onClick={() => requestSignIn("Connectez-vous pour synchroniser l’historique de génération.")}
          >
            Se connecter
          </button>
        </p>
      )}
    </div>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => { setQuery(""); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label="Accueil DocuGen">
          <span className="brand-mark"><DocIcon /></span>
          <span>Docu<span>Gen</span></span>
        </button>
        <div className="search-box">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                document
                  .getElementById("recent-documents")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
            placeholder="Rechercher par titre"
            aria-label="Rechercher un document par titre"
            aria-controls="recent-documents"
          />
          {query && <button className="clear-search" type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche">×</button>}
        </div>
        <div className="account-actions">
          <button className="generate-button" type="button" onClick={() => docxInputRef.current?.click()}>+ Générer</button>
          <button className="icon-button apps-button" onClick={() => setAppsOpen(!appsOpen)} aria-label="Applications"><Icon name="apps" size={26} /></button>
          {user ? (
            <span className="avatar-status-wrap">
              <button
                className="avatar"
                type="button"
                onClick={() => setProfileOpen(!profileOpen)}
                aria-label={`Profil de ${user.name} — connecté`}
                aria-expanded={profileOpen}
                title={user.email}
              >
                <span>{getUserInitials(user.name, user.email)}</span>
                {user.photoURL && (
                  <Image
                    className="avatar-image"
                    src={user.photoURL}
                    width={34}
                    height={34}
                    alt=""
                    unoptimized
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
              </button>
              <span className="connected-indicator" role="status" aria-label="Connecté" />
            </span>
          ) : (
            <button className="sign-in-button" type="button" onClick={() => setAuthMode("signin")}>Se connecter</button>
          )}
          {appsOpen && (
            <div className="apps-popover">
              <button type="button" onClick={() => notify("Bibliothèque ouverte")}><DocIcon /><span>Documents</span></button>
              <button type="button" onClick={() => notify("Modèles ouverts")}><span className="mini-app">T</span><span>Modèles</span></button>
              <button type="button" onClick={() => notify("Espace équipe ouvert")}><span className="mini-app">É</span><span>Équipe</span></button>
            </div>
          )}
          {user && profileOpen && (
            <div className="profile-popover" role="region" aria-label="Profil connecté">
              <span className="profile-avatar">
                {getUserInitials(user.name, user.email)}
                {user.photoURL && (
                  <Image
                    className="avatar-image"
                    src={user.photoURL}
                    width={34}
                    height={34}
                    alt=""
                    unoptimized
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
              </span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
              <div className="profile-rule" />
              <button type="button" onClick={() => notify("Paramètres du compte ouverts")}>Gérer mon compte</button>
              <button type="button" onClick={signOut}>Se déconnecter</button>
            </div>
          )}
        </div>
      </header>

      <input
        ref={docxInputRef}
        className="visually-hidden"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="Choisir un modèle Word"
        onChange={(event) => void uploadDocxFile(event.target.files?.[0])}
      />

      <section className="templates-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">GÉNÉRATION INTELLIGENTE</span>
            <h1>Que souhaitez-vous créer ?</h1>
          </div>
          <div className="template-actions">
            <button type="button" onClick={() => notify("Tous les modèles sont affichés")}>Galerie de modèles <Icon name="chevron" size={21} /></button>
            <span className="divider" />
            <button className="icon-button" aria-label="Options de la galerie"><Icon name="more" /></button>
          </div>
        </div>
        {selectedTemplateIds.length > 0 && (
          <div className="template-selection-actions" role="region" aria-label="Actions sur les modèles sélectionnés">
            <span>
              {selectedUploadedTemplates.length} modèle
              {selectedUploadedTemplates.length > 1 ? "s" : ""} sélectionné
              {selectedUploadedTemplates.length > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              className="filter-button"
              onClick={editSelectedTemplate}
              disabled={
                isBulkActionRunning || selectedUploadedTemplates.length !== 1
              }
              title={
                selectedUploadedTemplates.length === 1
                  ? "Modifier le modèle sélectionné"
                  : "La modification est disponible pour un seul modèle à la fois"
              }
            >
              Modifier
            </button>
            <button
              type="button"
              className="filter-button"
              onClick={shareSelectedTemplates}
              disabled={isBulkActionRunning}
            >
              Partager
            </button>
            <button
              type="button"
              className="filter-button bulk-delete-button"
              onClick={() => void deleteSelectedTemplates()}
              disabled={isBulkActionRunning}
            >
              Supprimer
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelectedTemplateIds([])}
              disabled={isBulkActionRunning}
            >
              Annuler
            </button>
          </div>
        )}
        <div className="template-strip">
          <button
            className="template-card upload-template-card"
            type="button"
            onClick={() => docxInputRef.current?.click()}
            disabled={isUploading}
            aria-label="Importer un modèle Word et remplir ses champs"
          >
            <span className="upload-template-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v4A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
              </svg>
            </span>
            <span className="template-title">
              {isUploading ? "Importation…" : "Importer un document"}
            </span>
            <span className="template-subtitle">
              {isUploading ? "Veuillez patienter" : "Ajouter un modèle Word"}
            </span>
          </button>
          {visibleUploadedTemplates.map((template) => (
            <div
              className={`template-card uploaded-template-card${selectedTemplateIds.includes(template.id) ? " uploaded-template-selected" : ""}`}
              key={template.id}
            >
              <label className="template-select">
                <input
                  type="checkbox"
                  checked={selectedTemplateIds.includes(template.id)}
                  onChange={() => toggleTemplateSelection(template.id)}
                  aria-label={`Sélectionner ${template.name}`}
                />
              </label>
              <button
                className="uploaded-template-open"
                type="button"
                onClick={() => openUploadedTemplate(template)}
                aria-label={`Ouvrir et modifier ${template.name}`}
              >
                <TemplateThumbnail templateId={template.id} />
                <span className="template-title">{template.name}</span>
                <span className="template-subtitle">Modèle Word · Modifier</span>
              </button>
            </div>
          ))}
          {bundledDocxTemplates.map((template) => (
            <div
              className="template-card uploaded-template-card bundled-docx-template-card"
              key={template.id}
            >
              <button
                className="uploaded-template-open"
                type="button"
                onClick={() => void importBundledDocxTemplate(template)}
                disabled={Boolean(importingBundledTemplateId)}
                aria-label={`${importingBundledTemplateId === template.id ? "Ajout en cours" : "Ajouter et modifier"} ${template.name}`}
              >
                <TemplateThumbnail templateId={template.id} />
                <span className="template-title">
                  {template.name.replace(/\.docx$/i, "")}
                </span>
                <span className="template-subtitle">
                  {importingBundledTemplateId === template.id
                    ? "Ajout à vos documents…"
                    : "Ajouter à mes documents"}
                </span>
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="generation-folders-section">
        <div className="shared-heading generation-folders-heading">
          <div>
            <span className="eyebrow">VOTRE HISTORIQUE</span>
            <h2>Dossiers de génération</h2>
            <p>
              Retrouvez, renommez et téléchargez vos fichiers.
              {!user && " Sans connexion, vos dossiers restent dans le stockage local de ce navigateur."}
            </p>
          </div>
        </div>
        {generationFolders.length ? (
          <div className="generation-folder-grid">
            {generationFolders.map((folder) => (
              <div className="generation-folder-card" key={folder.id}>
                <button
                  className="generation-folder-open"
                  type="button"
                  onClick={() => void openGenerationFolder(folder)}
                >
                  <span className="generation-folder-icon"><Icon name="folder" size={24} /></span>
                  <span className="generation-folder-copy">
                    <strong>{folder.name}</strong>
                    <small>Modifié le {new Date(folder.updatedAt).toLocaleDateString("fr-FR")}</small>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
                <div className="generation-folder-card-actions">
                  <button type="button" onClick={() => void editGenerationFolder(folder)}>Renommer</button>
                  <button type="button" onClick={() => void removeGenerationFolder(folder)}>Supprimer</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="generation-folder-empty">
            <Icon name="folder" size={24} />
            <span>
              {isLoadingGenerationFolders
                ? "Chargement de vos dossiers…"
                : user
                  ? "Aucun dossier pour le moment. Choisissez « Créer un nouveau dossier » lors d’une génération."
                  : "Aucun dossier local. Les dossiers créés sans connexion seront conservés dans ce navigateur."}
            </span>
          </div>
        )}
      </section>

      {user && (
        <section className="shared-section">
          <div className="shared-heading">
            <div>
              <span className="eyebrow">COLLABORATION</span>
              <h2>Partagés avec moi</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (!user?.email) return;
                void listDocumentsSharedWithUser(user.email)
                  .then(setSharedItems)
                  .catch((error: unknown) => {
                    notify(
                      error instanceof Error
                        ? `Impossible d’actualiser les documents partagés : ${error.message}`
                        : "Impossible d’actualiser les documents partagés.",
                    );
                  });
              }}
            >
              Actualiser
            </button>
          </div>
          {sharedItems.length ? (
            <div className="shared-grid">
              {sharedItems.map((item) => (
                <article className="shared-card" key={item.id}>
                  <button
                    type="button"
                    className="shared-preview"
                    onClick={() => openSharedDocument(item)}
                    aria-label={`Ouvrir ${item.title}`}
                  >
                    <DocumentPage kind={item.kind} />
                    <span className="shared-badge">Partagé</span>
                  </button>
                  <div className="shared-info">
                    <div className="shared-title-row">
                      <strong>{item.title}</strong>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => openSharedDocument(item)}
                        aria-label={`Ouvrir ${item.title}`}
                      >
                        <Icon name="more" size={20} />
                      </button>
                    </div>
                    <div className="owner-row">
                      <span className={`owner-avatar ${item.color}`}>{item.initials}</span>
                      <span><b>{item.owner}</b><small>{item.date}</small></span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Icon name="folder" size={32} />
              <h2>Aucun document partagé pour le moment</h2>
              <p>Les documents qui vous sont partagés apparaîtront ici.</p>
            </div>
          )}
        </section>
      )}

      <section className="recent-section" id="recent-documents">
        <div className="recent-toolbar">
          <div>
            <h2>Historique des documents</h2>
            <p className="document-history-description">
              Documents générés, modèles importés et fichiers de données enregistrés.
            </p>
            {query.trim() && (
              <p className="document-search-summary" role="status">
                {filtered.length
                  ? `${filtered.length} résultat${filtered.length === 1 ? "" : "s"} pour « ${query.trim()} »`
                  : `Aucun titre ne correspond à « ${query.trim()} »`}
              </p>
            )}
          </div>
          <div className="recent-actions">
            <button type="button" className="filter-button" onClick={() => setFilter(filter === "Tous" ? "Mes documents" : "Tous")}>{filter} <Icon name="chevron" size={18} /></button>
            <button type="button" className="icon-button" onClick={() => setView(view === "grid" ? "list" : "grid")} aria-label={view === "grid" ? "Afficher en liste" : "Afficher en grille"}><Icon name={view === "grid" ? "grid" : "list"} /></button>
            <button type="button" className={`icon-button ${!sortNewest ? "active-tool" : ""}`} onClick={() => { setSortNewest(!sortNewest); notify(sortNewest ? "Tri : les plus anciens" : "Tri : les plus récents"); }} aria-label="Trier"><Icon name="sort" /></button>
            <button type="button" className="icon-button" onClick={() => notify("Dossiers bientôt disponibles")} aria-label="Ouvrir un dossier"><Icon name="folder" /></button>
          </div>
        </div>
        {selectedDocumentIds.length > 0 && (
          <div className="bulk-document-actions" role="region" aria-label="Actions sur la sélection">
            <span>
              {selectedItems.length} document
              {selectedItems.length > 1 ? "s" : ""} sélectionné
              {selectedItems.length > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              className="filter-button"
              onClick={() => void downloadSelectedDocuments()}
              disabled={isBulkActionRunning || !selectedItems.length}
            >
              {isBulkActionRunning ? "Veuillez patienter…" : "Télécharger"}
            </button>
            <button
              type="button"
              className="filter-button bulk-delete-button"
              onClick={() => void deleteSelectedDocuments()}
              disabled={isBulkActionRunning || !selectedItems.length}
            >
              Supprimer
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelectedDocumentIds([])}
              disabled={isBulkActionRunning}
            >
              Annuler
            </button>
            {selectableItems.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setSelectedDocumentIds((current) => {
                    const visibleIds = new Set(
                      selectableItems.flatMap((item) =>
                        item.id ? [item.id] : [],
                      ),
                    );
                    return allVisibleItemsSelected
                      ? current.filter((id) => !visibleIds.has(id))
                      : [
                          ...new Set([
                            ...current,
                            ...visibleIds,
                          ]),
                        ];
                  })
                }
                disabled={isBulkActionRunning}
              >
                {allVisibleItemsSelected
                  ? "Désélectionner tout"
                  : "Tout sélectionner"}
              </button>
            )}
          </div>
        )}
        {filtered.length ? (
          <div className={`recent-grid ${view === "list" ? "list-view" : ""}`}>{filtered.map((item, index) => <RecentCard key={item.id ?? `${item.title}-${index}`} item={item} selectable={Boolean(item.id && !item.shared)} selected={Boolean(item.id && selectedDocumentIds.includes(item.id))} onSelect={() => toggleDocumentSelection(item)} onOpen={() => void openDashboardDocument(item)} onQuickEdit={item.templateId && !item.shared ? () => void openDashboardDocument(item) : undefined} onMore={() => {
            if (!user) {
              requestSignIn("Connectez-vous pour partager vos documents.");
            } else if (item.shared) {
              notify("Vous ne pouvez partager que les documents de votre bibliothèque.");
            } else if (!item.id) {
              notify("Ce document ne peut pas être partagé.");
            } else {
              setShareTargets([item]);
              setShareEmail("");
            }
          }} />)}</div>
        ) : (
          <div className="empty-state"><Icon name="search" size={32} /><h2>{query.trim() ? "Aucun titre correspondant" : "Aucun document trouvé"}</h2><p>{query.trim() ? "Vérifiez l’orthographe ou essayez un autre mot du titre." : "Essayez une autre recherche."}</p></div>
        )}
      </section>

      {shareTargets.length > 0 && (
        <div
          className="modal-backdrop auth-backdrop"
          role="presentation"
          onMouseDown={() => !isSharing && setShareTargets([])}
        >
          <section
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close auth-close"
              type="button"
              onClick={() => setShareTargets([])}
              aria-label="Fermer"
              disabled={isSharing}
            >
              ×
            </button>
            <h2 id="share-title">
              {shareTargets.length === 1
                ? "Partager un document"
                : `Partager ${shareTargets.length} documents`}
            </h2>
            <p>
              {shareTargets.length === 1
                ? shareTargets[0].title
                : `${shareTargets.length} documents sélectionnés`}
            </p>
            <form className="auth-form" onSubmit={(event) => void shareRecentDocument(event)}>
              <label htmlFor="share-email">Adresse e-mail de la personne</label>
              <input
                id="share-email"
                type="email"
                autoComplete="email"
                value={shareEmail}
                onChange={(event) => setShareEmail(event.target.value)}
                placeholder="nom@exemple.com"
                required
              />
              <button className="primary-button auth-submit" type="submit" disabled={isSharing}>
                {isSharing ? "Partage en cours…" : "Partager"}
              </button>
            </form>
          </section>
        </div>
      )}

      {openedGenerationFolder && (
        <div
          className="modal-backdrop auth-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpenedGenerationFolder(null);
            }
          }}
        >
          <section
            className="auth-modal generation-history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generation-folder-title"
          >
            <button
              className="modal-close auth-close"
              type="button"
              onClick={() => setOpenedGenerationFolder(null)}
              aria-label="Fermer le dossier"
            >
              ×
            </button>
            <span className="eyebrow">DOSSIER DE GÉNÉRATION</span>
            <h2 id="generation-folder-title">{openedGenerationFolder.name}</h2>
            <p>Créé le {new Date(openedGenerationFolder.createdAt).toLocaleString("fr-FR")}</p>
            {isLoadingGenerationFiles ? (
              <div className="generation-folder-empty">Chargement des fichiers…</div>
            ) : openedGenerationFiles.length ? (
              <>
                <div className="generation-folder-toolbar">
                  <button
                    className="filter-button"
                    type="button"
                    onClick={() =>
                      setSelectedGenerationFileIds(
                        selectedGenerationFileIds.length === openedGenerationFiles.length
                          ? []
                          : openedGenerationFiles.map((file) => file.id),
                      )
                    }
                    disabled={generationFolderAction}
                  >
                    {selectedGenerationFileIds.length === openedGenerationFiles.length
                      ? "Tout désélectionner"
                      : "Tout sélectionner"}
                  </button>
                  <button
                    className="filter-button"
                    type="button"
                    onClick={() => {
                      setSelectedGenerationFileIds(
                        openedGenerationFiles.map((file) => file.id),
                      );
                      void downloadGenerationFiles(
                        openedGenerationFiles,
                        `${openedGenerationFolder.name}.zip`,
                      );
                    }}
                    disabled={generationFolderAction}
                  >
                    {generationFolderAction ? "Préparation…" : "Télécharger le dossier"}
                  </button>
                </div>
                {selectedGenerationFileIds.length > 0 && (
                  <div className="generation-selection-toolbar" aria-live="polite">
                    <span>{selectedGenerationFileIds.length} fichier(s) sélectionné(s)</span>
                    <div>
                      <button
                        className="filter-button"
                        type="button"
                        onClick={() => {
                          const selectedFiles = openedGenerationFiles.filter((file) =>
                            selectedGenerationFileIds.includes(file.id),
                          );
                          if (selectedFiles.length === 1) {
                            editGenerationFile(openedGenerationFolder, selectedFiles[0]);
                          }
                        }}
                        disabled={generationFolderAction || selectedGenerationFileIds.length !== 1}
                        title={selectedGenerationFileIds.length === 1 ? "Renommer le fichier sélectionné" : "Sélectionnez un seul fichier pour le renommer"}
                      >
                        Renommer
                      </button>
                      <button
                        className="filter-button"
                        type="button"
                        onClick={() =>
                          void downloadGenerationFiles(
                            openedGenerationFiles.filter((file) =>
                              selectedGenerationFileIds.includes(file.id),
                            ),
                            selectedGenerationFileIds.length === 1
                              ? ""
                              : "fichiers-selectionnes.zip",
                          )
                        }
                        disabled={generationFolderAction}
                      >
                        Télécharger
                      </button>
                      <button
                        className="filter-button bulk-delete-button"
                        type="button"
                        onClick={() => void removeSelectedGenerationFiles()}
                        disabled={generationFolderAction}
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                )}
                <div className="generation-file-list">
                  {openedGenerationFiles.map((file) => (
                    <label
                      className={`generation-file-card${selectedGenerationFileIds.includes(file.id) ? " selected" : ""}`}
                      key={file.id}
                    >
                      <input
                        type="checkbox"
                        checked={selectedGenerationFileIds.includes(file.id)}
                        onChange={(event) =>
                          setSelectedGenerationFileIds((current) =>
                            event.target.checked
                              ? [...current, file.id]
                              : current.filter((id) => id !== file.id),
                          )
                        }
                        disabled={generationFolderAction}
                        aria-label={`Sélectionner ${file.fileName}`}
                      />
                      {file.kind === "generated" &&
                      /\.docx$/i.test(file.fileName) ? (
                        <DocxPagePreview
                          className="generation-file-history-preview"
                          src={file.url}
                          fallbackKind={generationFilePreviewKind(file)}
                        />
                      ) : (
                        <TemplateThumbnail
                          className="generation-file-history-preview"
                          src={
                            isSvgThumbnail(file.thumbnailUrl)
                              ? undefined
                              : file.thumbnailUrl ?? undefined
                          }
                          fallbackKind={generationFilePreviewKind(file)}
                        />
                      )}
                      <span className="generation-file-copy">
                        <strong title={file.title}>{file.title}</strong>
                        <small>
                          {file.kind === "source"
                            ? "Tableur source"
                            : file.kind === "archive"
                              ? "Archive ZIP"
                              : "Document généré"}
                          {" · "}
                          {new Date(file.createdAt).toLocaleString("fr-FR")}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <div className="generation-folder-empty">
                Aucun fichier n’a encore été enregistré dans ce dossier.
              </div>
            )}
          </section>
        </div>
      )}

      {generationRenameTarget && (
        <div
          className="modal-backdrop auth-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeGenerationRename();
          }}
        >
          <section
            className="auth-modal generation-rename-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generation-rename-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close auth-close"
              type="button"
              onClick={closeGenerationRename}
              aria-label="Fermer"
              disabled={isRenamingGenerationItem}
            >
              ×
            </button>
            <h2 id="generation-rename-title">
              {generationRenameTarget.kind === "folder"
                ? "Renommer le dossier"
                : "Renommer le fichier"}
            </h2>
            <p>
              {generationRenameTarget.kind === "folder"
                ? "Choisissez un nouveau nom pour ce dossier."
                : "Le fichier stocké ne sera pas modifié ; seul son nom dans l’historique changera."}
            </p>
            <form className="auth-form" onSubmit={(event) => void saveGenerationRename(event)}>
              <label htmlFor="generation-rename-value">
                {generationRenameTarget.kind === "folder" ? "Nom du dossier" : "Nom du fichier"}
              </label>
              <input
                id="generation-rename-value"
                autoFocus
                maxLength={generationRenameTarget.kind === "folder" ? 80 : 255}
                value={generationRenameValue}
                onChange={(event) => {
                  setGenerationRenameValue(event.target.value);
                  setGenerationRenameError("");
                }}
                aria-invalid={Boolean(generationRenameError)}
                aria-describedby={generationRenameError ? "generation-rename-error" : undefined}
                required
              />
              {generationRenameError && (
                <small id="generation-rename-error" className="auth-field-invalid" role="alert">
                  {generationRenameError}
                </small>
              )}
              <div className="generation-rename-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeGenerationRename}
                  disabled={isRenamingGenerationItem}
                >
                  Annuler
                </button>
                <button className="primary-button" type="submit" disabled={isRenamingGenerationItem}>
                  {isRenamingGenerationItem ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selectedTemplate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeGenerator();
        }}>
          <section className={`generator-modal ${activeTemplateId && editorStage === "edit" ? "docx-editor-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="generator-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">
                  {activeTemplateId
                    ? editorStage === "edit"
                      ? "ÉTAPE 2 · MODIFIER LE TEXTE"
                      : editorStage === "choose"
                        ? "ÉTAPE 2 · CHOISIR UNE MÉTHODE"
                        : "ÉTAPE 3 · REMPLIR LE DOCUMENT"
                    : "ÉTAPE 1 · IMPORTER UN MODÈLE"}
                </span>
                <h2 id="generator-title">
                  {activeTemplateId
                    ? editorStage === "edit"
                      ? "Modifier le texte du document"
                      : editorStage === "choose"
                        ? "Choisissez une méthode"
                        : "Remplir le document"
                    : "Choisir un document Word"}
                </h2>
                <p className="modal-subtitle">
                  {activeTemplateId
                    ? selectedTemplate.title
                    : "Importez un fichier DOCX, puis ouvrez sa carte pour ajouter les champs."}
                </p>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => {
                  closeGenerator();
                }}
                aria-label="Fermer"
              >
                ×
              </button>
            </div>
            <div className="generator-body">
              {activeTemplateId && editorStage === "edit" ? (
                <DocxEditor
                  templateId={activeTemplateId}
                  templateName={selectedTemplate.title}
                  error={docxError}
                  onDirtyChange={setIsEditorDirty}
                  onContinue={finishEditingTemplate}
                  onCancel={closeGenerator}
                />
              ) : activeTemplateId && editorStage === "choose" ? (
                <section className="generation-workflow">
                  <p className="generation-choice-intro">
                    Choisissez comment renseigner les champs de « {selectedTemplate.title} ».
                  </p>
                  {docxError && <p className="docx-error" role="alert">{docxError}</p>}
                  <div className="generation-choice-grid" aria-label="Choisir une méthode de saisie">
                    <button
                      className="generation-choice-card generation-choice-card-manual"
                      type="button"
                      onClick={() => void selectGenerationMode("single")}
                    >
                      <span className="generation-choice-top">
                        <span className="generation-choice-icon"><Icon name="edit" size={21} /></span>
                        <span className="generation-choice-tag">Formulaire</span>
                      </span>
                      <span className="generation-choice-copy">
                        <strong>Remplir un formulaire</strong>
                        <span>Un champ à remplir s’affiche pour chaque variable du modèle.</span>
                      </span>
                      <span className="generation-choice-action">Créer un document <span aria-hidden="true">→</span></span>
                    </button>
                    <button
                      className="generation-choice-card generation-choice-card-spreadsheet"
                      type="button"
                      onClick={() => void selectGenerationMode("batch")}
                    >
                      <span className="generation-choice-top">
                        <span className="generation-choice-icon"><Icon name="grid" size={21} /></span>
                        <span className="generation-choice-tag">Excel / CSV</span>
                      </span>
                      <span className="generation-choice-copy">
                        <strong>Remplir avec un tableau</strong>
                        <span>Créez plusieurs documents, un pour chaque ligne du fichier.</span>
                      </span>
                      <span className="generation-choice-action">Choisir un fichier <span aria-hidden="true">→</span></span>
                    </button>
                  </div>
                  <div className="generation-edit-row">
                    <span>Vous devez modifier le contenu du modèle ?</span>
                    <button
                      type="button"
                      className="text-button generation-edit-text"
                      onClick={() => {
                        setEditorStage("edit");
                        setDocxError("");
                      }}
                    >
                      <Icon name="edit" size={15} />
                      Modifier le texte
                    </button>
                  </div>
                </section>
              ) : activeTemplateId && editorStage === "generate" ? (
                <section className="generation-workflow">
                  <div className="docx-file-summary">
                    <div>
                      <strong>{selectedTemplate.title}</strong>
                      <span>
                        {placeholders.length} champ{placeholders.length === 1 ? "" : "s"} dans le modèle
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditorStage("edit");
                        setDocxError("");
                      }}
                    >
                      Modifier le modèle
                    </button>
                  </div>

                  <div className="generation-mode-switch" role="tablist" aria-label="Mode de génération">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={generationMode === "single"}
                      className={generationMode === "single" ? "active" : ""}
                      onClick={() => changeGenerationMode("single")}
                    >
                      Formulaire
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={generationMode === "batch"}
                      className={generationMode === "batch" ? "active" : ""}
                      onClick={() => changeGenerationMode("batch")}
                    >
                      Excel / CSV
                    </button>
                  </div>

                  {generationMode === "single" ? (
                    <form className="docx-fields-form" onSubmit={generateDocxFile}>
                      <p className="docx-fields-intro">
                        Saisissez une valeur dans chaque champ du formulaire.
                      </p>
                      <div className="docx-fields-grid">
                        {placeholders.map((name, index) => (
                          <label className="docx-field" key={name}>
                            <span>{name.replace(/[-_.]+/g, " ")}</span>
                            <code>{"{" + name + "}"}</code>
                            <input
                              autoFocus={index === 0}
                              type={
                                /date|jour|birth/i.test(name)
                                  ? "date"
                                  : /email|mail/i.test(name)
                                    ? "email"
                                    : /phone|telephone|tel/i.test(name)
                                      ? "tel"
                                      : "text"
                              }
                              value={fieldValues[name] ?? ""}
                              onChange={(event) =>
                                setFieldValues((current) => ({
                                  ...current,
                                  [name]: event.target.value,
                                }))
                              }
                              placeholder={`Saisissez ${name.replace(/[-_.]+/g, " ")}`}
                              required
                            />
                          </label>
                        ))}
                      </div>
                      {generationFolderControls()}
                      {docxError && <p className="docx-error" role="alert">{docxError}</p>}
                      <div className="modal-actions">
                        <button type="button" className="secondary-button" onClick={() => changeGenerationMode("batch")}>
                          Utiliser un tableau
                        </button>
                        <button type="submit" className="primary-button" disabled={isGeneratingDocx || isSavingGeneration}>
                          {isGeneratingDocx
                            ? "Génération…"
                            : isSavingGeneration
                              ? "Téléchargement prêt · Enregistrement…"
                              : "Générer le document"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form className="docx-fields-form batch-form" onSubmit={generateDocxFile}>
                      <p className="docx-fields-intro">
                        Importez un fichier contenant une ligne d’en-têtes puis une ligne par document à créer.
                      </p>
                      <label className="spreadsheet-picker" htmlFor="template-spreadsheet">
                        <span className="spreadsheet-picker-icon" aria-hidden="true">↥</span>
                        <strong>
                          {spreadsheetFile
                            ? spreadsheetFile.name
                            : "Choisir un fichier Excel ou CSV"}
                        </strong>
                        <span>.xlsx ou .csv · 10 Mo maximum</span>
                        <input
                          id="template-spreadsheet"
                          type="file"
                          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          onChange={(event) =>
                            setSpreadsheetFile(event.target.files?.[0] ?? null)
                          }
                          required
                        />
                      </label>
                      <p className="spreadsheet-hint">
                        Chaque champ du modèle doit avoir sa propre colonne avec le même nom, par exemple{" "}
                        <code>nom</code> pour <code>{"{nom}"}</code>. DocuGen repère les en-têtes dans les feuilles du classeur et lit toutes les colonnes du tableau. Un fichier ZIP contenant un document par ligne sera téléchargé.
                      </p>
                      <p className="spreadsheet-hint">
                        {user
                          ? "Le tableur source et l’archive générée seront enregistrés dans le dossier choisi."
                          : "Connectez-vous pour retrouver vos fichiers dans un dossier sur le site. Sans compte, l’historique reste enregistré dans ce navigateur."}
                      </p>
                      {generationFolderControls()}
                      {docxError && <p className="docx-error" role="alert">{docxError}</p>}
                      <div className="modal-actions">
                        <button type="button" className="secondary-button" onClick={() => changeGenerationMode("single")}>
                          Saisie manuelle
                        </button>
                        <button type="submit" className="primary-button" disabled={isGeneratingDocx || isSavingGeneration}>
                          {isGeneratingDocx
                            ? "Génération…"
                            : isSavingGeneration
                              ? "Téléchargement prêt · Enregistrement…"
                              : "Générer tous les documents"}
                        </button>
                      </div>
                    </form>
                  )}
                </section>
              ) : (
                <div className="generator-choices">
                  <div className="docx-import">
                    <div>
                      <strong>{isUploading ? "Importation du modèle…" : "Importer un modèle Word"}</strong>
                      <span>Fichier DOCX · modifiez le texte ou ajoutez des champs entre accolades, par exemple {"{nom}"}.</span>
                    </div>
                    <button
                      type="button"
                      className="docx-import-button"
                      onClick={() => docxInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      {isUploading ? "Veuillez patienter…" : "Parcourir les fichiers"}
                    </button>
                  </div>
                  {docxError && <p className="docx-error" role="alert">{docxError}</p>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {authMode && (
        <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={() => { setAuthMode(null); setAuthPassword(""); }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close auth-close" type="button" onClick={() => { setAuthMode(null); setAuthPassword(""); }} aria-label="Fermer">×</button>
            <div className="auth-brand"><span className="brand-mark"><DocIcon /></span><strong>Docu<span>Gen</span></strong></div>
            <h2 id="auth-title">{authMode === "signin" ? "Heureux de vous revoir" : "Créez votre compte"}</h2>
            <p>{authMode === "signin" ? "Connectez-vous pour retrouver et générer vos documents." : "Commencez à créer des documents professionnels en quelques secondes."}</p>
            <div className="auth-tabs">
              <button type="button" className={authMode === "signin" ? "active" : ""} onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthPassword(""); setAuthEmailTouched(false); }}>Connexion</button>
              <button type="button" className={authMode === "signup" ? "active" : ""} onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthPassword(""); setAuthEmailTouched(false); }}>Inscription</button>
            </div>
            <button type="button" className="google-button" onClick={() => void signInWithGoogle()} disabled={isAuthenticating}><GoogleMark /> Continuer avec Google</button>
            <div className="auth-divider"><span>ou avec votre e-mail</span></div>
            <form className="auth-form" onSubmit={submitAuth}>
              {authMode === "signup" && <><label htmlFor="auth-name">Nom complet</label><input id="auth-name" name="name" autoComplete="name" placeholder="Votre nom" /></>}
              <label htmlFor="auth-email">Adresse e-mail</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                placeholder="vous@exemple.com"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value.trimStart())}
                onBlur={() => setAuthEmailTouched(true)}
                aria-invalid={authMode === "signup" && authEmailTouched && Boolean(authEmail) && !isValidEmail(authEmail.trim())}
                aria-describedby={authMode === "signup" ? "auth-email-hint" : undefined}
                required
              />
              {authMode === "signup" && (
                <small
                  id="auth-email-hint"
                  className={`auth-field-hint${authEmailTouched && authEmail && !isValidEmail(authEmail.trim()) ? " auth-field-invalid" : ""}`}
                  role={authEmailTouched && authEmail && !isValidEmail(authEmail.trim()) ? "alert" : undefined}
                >
                  {authEmailTouched && authEmail && !isValidEmail(authEmail.trim())
                    ? "Saisissez une adresse e-mail valide, par exemple nom@exemple.com."
                    : "Utilisez une adresse e-mail valide."}
                </small>
              )}
              <div className="password-label"><label htmlFor="auth-password">Mot de passe</label>{authMode === "signin" && <button type="button" onClick={() => void resetPassword()}>Mot de passe oublié ?</button>}</div>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                minLength={6}
                maxLength={128}
                placeholder="6 caractères minimum"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                aria-invalid={authPassword.length > 0 && authPassword.length < 6}
                aria-describedby="auth-password-hint"
                required
              />
              <small
                id="auth-password-hint"
                className={`auth-field-hint${authPassword.length > 0 && authPassword.length < 6 ? " auth-field-invalid" : ""}`}
                role={authPassword.length > 0 && authPassword.length < 6 ? "alert" : undefined}
              >
                {authPassword.length > 0 && authPassword.length < 6
                  ? `Encore ${6 - authPassword.length} caractère${6 - authPassword.length === 1 ? "" : "s"} minimum.`
                  : "Le mot de passe doit contenir entre 6 et 128 caractères."}
              </small>
              {authError && <div className="auth-error" role="alert">{authError}</div>}
              {authMode === "signup" && <label className="terms-check"><input type="checkbox" required /> J’accepte les conditions d’utilisation et la politique de confidentialité.</label>}
              <button type="submit" className="primary-button auth-submit" disabled={isAuthenticating}>{isAuthenticating ? "Veuillez patienter…" : authMode === "signin" ? "Se connecter" : "Créer mon compte"}</button>
            </form>
            <small className="auth-security">Connexion sécurisée · Vos données restent confidentielles</small>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><span className="toast-dot" />{toast}</div>}
    </main>
  );
}
