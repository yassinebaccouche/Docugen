"use client";

import { useEffect, useRef, useState } from "react";

interface EditorConfigResponse {
  template: {
    saveVersion: number;
  };
  editor: {
    documentServerUrl: string;
    config: Record<string, unknown>;
  };
}

interface EditorInstance {
  destroyEditor(): void;
}

interface EditorEvent {
  data?: boolean;
  errorCode?: number;
  errorDescription?: string;
}

interface EditorConfig {
  document: Record<string, unknown>;
  documentType: string;
  editorConfig: Record<string, unknown>;
  token?: string;
  events: {
    onAppReady(): void;
    onDocumentStateChange(event: EditorEvent): void;
    onError(event: EditorEvent): void;
  };
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (elementId: string, config: EditorConfig) => EditorInstance;
    };
  }
}

let editorScriptPromise: Promise<void> | null = null;

function loadEditorScript(url: string): Promise<void> {
  if (window.DocsAPI) return Promise.resolve();
  if (editorScriptPromise) return editorScriptPromise;

  editorScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${url}/web-apps/apps/api/documents/api.js`;
    script.async = true;
    script.onload = () => {
      if (window.DocsAPI) {
        resolve();
      } else {
        editorScriptPromise = null;
        reject(new Error("Le serveur Word n’a pas chargé son éditeur."));
      }
    };
    script.onerror = () => {
      editorScriptPromise = null;
      reject(new Error("Le serveur Word est inaccessible."));
    };
    document.head.append(script);
  });

  return editorScriptPromise;
}

interface OnlyOfficeEditorProps {
  templateId: string;
  templateName: string;
  onContinue: () => Promise<void>;
  onCancel: () => void;
}

export default function OnlyOfficeEditor({
  templateId,
  templateName,
  onContinue,
  onCancel,
}: OnlyOfficeEditorProps) {
  const editorRef = useRef<EditorInstance | null>(null);
  const changedRef = useRef(false);
  const baseVersionRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function mountEditor() {
      try {
        const response = await fetch(`/api/templates/${templateId}/editor`);
        const result = (await response.json()) as EditorConfigResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? "Impossible d’ouvrir ce modèle Word.");
        }
        baseVersionRef.current = result.template.saveVersion;
        await loadEditorScript(result.editor.documentServerUrl);
        if (!active || !window.DocsAPI) return;

        const config = {
          ...result.editor.config,
          events: {
            onAppReady: () => {
              if (active) setLoading(false);
            },
            onDocumentStateChange: (event: EditorEvent) => {
              if (event.data) changedRef.current = true;
            },
            onError: (event: EditorEvent) => {
              if (active) {
                setError(
                  event.errorDescription ||
                    "Une erreur s’est produite dans l’éditeur Word.",
                );
              }
            },
          },
        } as EditorConfig;
        editorRef.current = new window.DocsAPI.DocEditor("onlyoffice-editor", config);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de joindre l’éditeur Word.",
          );
          setLoading(false);
        }
      }
    }

    void mountEditor();

    return () => {
      active = false;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
  }, [templateId]);

  async function finishEditing() {
    setError("");
    setSaving(true);
    editorRef.current?.destroyEditor();
    editorRef.current = null;

    if (changedRef.current) {
      try {
        let saved = false;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 750));
          const response = await fetch(`/api/templates/${templateId}`, {
            cache: "no-store",
          });
          if (!response.ok) {
            throw new Error("Impossible de vérifier l’enregistrement du modèle.");
          }
          const result = (await response.json()) as {
            template: { saveVersion: number };
          };
          if (result.template.saveVersion > baseVersionRef.current) {
            saved = true;
            break;
          }
        }

        if (!saved) {
          throw new Error(
            "La sauvegarde Word n’a pas encore été confirmée. Vérifiez que le serveur ONLYOFFICE est accessible, puis réessayez.",
          );
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible d’enregistrer le modèle Word.",
        );
        setSaving(false);
        setLoading(false);
        return;
      }
    }

    await onContinue();
    setSaving(false);
  }

  return (
    <section className="office-editor-panel" aria-label="Éditeur du modèle Word">
      <div className="office-editor-toolbar">
        <div>
          <strong>{templateName}</strong>
          <span>
            Ajoutez vos champs dans le document, par exemple {"{nom}"} ou {"{date}"}.
          </span>
        </div>
        <div className="office-editor-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={onCancel}
            disabled={saving}
          >
            Retour
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void finishEditing()}
            disabled={loading || saving || Boolean(error)}
          >
            {saving ? "Enregistrement…" : "Continuer"}
          </button>
        </div>
      </div>
      {error && <p className="docx-error" role="alert">{error}</p>}
      {loading && !error && (
        <p className="office-editor-status" role="status">
          Connexion à l’éditeur Word…
        </p>
      )}
      <div
        className="office-editor-frame"
        id="onlyoffice-editor"
        aria-label="Contenu modifiable du document Word"
      />
    </section>
  );
}
