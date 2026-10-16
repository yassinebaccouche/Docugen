"use client";

import { useEffect, useId, useRef, useState } from "react";
import DocumentPage from "./DocumentPage";

type PreviewStatus = "loading" | "ready" | "error";

export default function DocxPagePreview({
  src,
  className = "",
  fallbackKind = "minimal",
}: {
  src: string;
  className?: string;
  fallbackKind?: string;
}) {
  const previewRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rendererClass = `docx-history-${id}`;

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    const abortController = new AbortController();
    container.replaceChildren();
    setStatus("loading");

    async function renderPreview(previewContainer: HTMLSpanElement) {
      try {
        const sourceUrl = new URL(src, window.location.href);
        const isCloudinaryRawFile =
          sourceUrl.protocol === "https:" &&
          sourceUrl.hostname === "res.cloudinary.com" &&
          sourceUrl.pathname.includes("/raw/upload/");
        const isSameOriginTemplatePreview =
          sourceUrl.origin === window.location.origin &&
          /^\/api\/templates\/[^/]+\/preview$/.test(sourceUrl.pathname);
        if (!isCloudinaryRawFile && !isSameOriginTemplatePreview) {
          throw new Error("Le document DOCX n’est pas enregistré comme fichier Raw Cloudinary.");
        }
        const response = await fetch(sourceUrl, {
          signal: abortController.signal,
          ...(isSameOriginTemplatePreview
            ? {}
            : { mode: "cors" as const, credentials: "omit" as const }),
        });
        if (!response.ok) {
          throw new Error(`DOCX preview request failed (${response.status}).`);
        }
        const bytes = await response.arrayBuffer();
        if (cancelled) return;

        const { renderAsync } = await import("docx-preview");
        await renderAsync(bytes, previewContainer, previewContainer, {
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          useBase64URL: true,
          className: rendererClass,
        });
        if (cancelled) return;

        const wrapper = previewContainer.querySelector<HTMLElement>(
          `.${rendererClass}-wrapper`,
        );
        const firstPage = wrapper?.querySelector<HTMLElement>(
          `section.${rendererClass}`,
        );
        if (!wrapper || !firstPage) {
          throw new Error("DOCX renderer did not produce a page preview.");
        }

        wrapper.querySelectorAll(`section.${rendererClass}`).forEach((page) => {
          if (page !== firstPage) page.remove();
        });
        wrapper.style.position = "absolute";
        wrapper.style.top = "0";
        wrapper.style.padding = "0";
        wrapper.style.background = "transparent";
        firstPage.style.margin = "0";
        firstPage.style.boxShadow = "none";

        const fitPreview = () => {
          const pageWidth = firstPage.offsetWidth;
          const pageHeight = firstPage.offsetHeight;
          if (!pageWidth || !pageHeight) return;
          const scale = Math.min(
            previewContainer.clientWidth / pageWidth,
            previewContainer.clientHeight / pageHeight,
          );
          wrapper.style.left = `${(previewContainer.clientWidth - pageWidth * scale) / 2}px`;
          wrapper.style.transformOrigin = "top left";
          wrapper.style.transform = `scale(${scale})`;
        };

        fitPreview();
        resizeObserver = new ResizeObserver(fitPreview);
        resizeObserver.observe(previewContainer);
        setStatus("ready");
      } catch (error) {
        if (cancelled || abortController.signal.aborted) return;
        console.error("Unable to render a DOCX history preview", error);
        previewContainer.replaceChildren();
        setStatus("error");
      }
    }

    let started = false;
    const startRendering = () => {
      if (started) return;
      started = true;
      void renderPreview(container);
    };
    const intersectionObserver =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                intersectionObserver?.disconnect();
                startRendering();
              }
            },
            { rootMargin: "120px" },
          );
    if (intersectionObserver) intersectionObserver.observe(container);
    else startRendering();

    return () => {
      cancelled = true;
      abortController.abort();
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      container.replaceChildren();
    };
  }, [rendererClass, src]);

  return (
    <span
      className={`docx-page-preview ${className}`.trim()}
      aria-busy={status === "loading"}
    >
      <span className="docx-page-preview-surface" ref={previewRef} />
      {status !== "ready" && (
        <span className="docx-page-preview-placeholder" aria-hidden="true">
          {status === "error" ? (
            <DocumentPage kind={fallbackKind} />
          ) : (
            <span className="docx-page-preview-skeleton" />
          )}
        </span>
      )}
    </span>
  );
}
