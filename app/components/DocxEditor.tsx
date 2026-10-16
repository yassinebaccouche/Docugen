"use client";

import { useEffect, useRef, useState } from "react";
import type { EditableParagraph } from "@/app/lib/docx-editor";

interface EditorResponse {
  template: { saveVersion: number };
  paragraphs: EditableParagraph[];
}

interface DocxEditorProps {
  templateId: string;
  templateName: string;
  error: string;
  onDirtyChange: (dirty: boolean) => void;
  onContinue: () => Promise<void>;
  onCancel: () => void;
}

function paragraphClass(style: string): string {
  const normalized = style.toLowerCase();
  if (normalized.includes("title")) return "docx-edit-title";
  if (normalized.includes("heading1") || normalized.includes("heading 1")) {
    return "docx-edit-heading";
  }
  if (normalized.includes("heading2") || normalized.includes("heading 2")) {
    return "docx-edit-subheading";
  }
  return "";
}

export default function DocxEditor({
  templateId,
  templateName,
  error,
  onDirtyChange,
  onContinue,
  onCancel,
}: DocxEditorProps) {
  const [paragraphs, setParagraphs] = useState<EditableParagraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editorError, setEditorError] = useState("");
  const paragraphRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/templates/${templateId}/content`, { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as EditorResponse & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Impossible d’ouvrir le modèle.");
        if (active) {
          setParagraphs(result.paragraphs);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setEditorError(
            cause instanceof Error ? cause.message : "Impossible de lire le document.",
          );
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [templateId]);

  async function continueToGeneration() {
    setEditorError("");
    setSaving(true);
    try {
      if (dirty) {
        const updatedParagraphs = paragraphRefs.current.map(
          (paragraph) => paragraph?.textContent ?? "",
        );
        const response = await fetch(`/api/templates/${templateId}/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paragraphs: updatedParagraphs }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(result.error ?? "Impossible d’enregistrer le modèle.");
        }
      }
      setDirty(false);
      onDirtyChange(false);
      await onContinue();
    } catch (cause) {
      setEditorError(
        cause instanceof Error ? cause.message : "Impossible d’enregistrer le modèle.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="docx-editor-panel" aria-label="Éditeur du modèle Word">
      <div className="docx-editor-toolbar">
        <div className="docx-editor-toolbar-heading">
          <strong>{templateName}</strong>
          <span>
            Modifiez le texte. Pour créer un champ à remplir, écrivez son nom entre accolades, par exemple {"{nom}"}.
          </span>
        </div>
        <div className="office-editor-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>
            Retour
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void continueToGeneration()}
            disabled={loading || saving || Boolean(editorError)}
          >
            {saving ? "Enregistrement…" : "Continuer"}
          </button>
        </div>
      </div>
      {(editorError || error) && (
        <p className="docx-error" role="alert">{editorError || error}</p>
      )}
      {loading ? (
        <p className="office-editor-status" role="status">Ouverture du document…</p>
      ) : (
        <div className="docx-editor-scroll">
          <article className="docx-editor-paper" aria-label="Page du document">
            {paragraphs.map((paragraph, index) => (
              <div
                className={`docx-edit-paragraph ${paragraphClass(paragraph.style)}`}
                contentEditable
                suppressContentEditableWarning
                key={index}
                ref={(element) => {
                  paragraphRefs.current[index] = element;
                }}
                role="textbox"
                aria-label={`Paragraphe ${index + 1}`}
                aria-multiline="false"
                data-placeholder={paragraph.text ? undefined : "Cliquez pour écrire…"}
                style={{
                  textAlign:
                    paragraph.alignment === "center" ||
                    paragraph.alignment === "right" ||
                    paragraph.alignment === "both"
                      ? (paragraph.alignment === "both" ? "justify" : paragraph.alignment)
                      : "left",
                }}
                onInput={() => {
                  setDirty(true);
                  onDirtyChange(true);
                  setEditorError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
              >
                {paragraph.text}
              </div>
            ))}
          </article>
        </div>
      )}
      <p className="docx-editor-note">
        Les images et la mise en page du fichier d’origine sont conservées. Le texte du document est modifiable ici.
      </p>
    </section>
  );
}
