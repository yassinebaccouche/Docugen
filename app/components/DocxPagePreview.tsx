"use client";

import { useEffect, useId, useRef, useState } from "react";
import DocumentPage from "./DocumentPage";

type PreviewStatus = "loading" | "ready" | "error";

export default function DocxPagePreview({
  src,
  className = "",
  fallbackKind = "minimal",
  previewOnHover = false,
}: {
  src: string;
  className?: string;
  fallbackKind?: string;
  previewOnHover?: boolean;
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
    let hoverDelay: number | undefined;
    let pageRotation: number | undefined;
    let previewPages: HTMLElement[] = [];
    let activePageIndex = 0;
    let previewRequested = false;
    const abortController = new AbortController();
    container.replaceChildren();
    setStatus("loading");

    const showPage = (index: number) => {
      previewPages.forEach((page, pageIndex) => {
        page.style.display = pageIndex === index ? "block" : "none";
      });
      const page = previewPages[index];
      if (page) {
        page.animate(
          [
            { opacity: 0, transform: "translateX(12px)" },
            { opacity: 1, transform: "translateX(0)" },
          ],
          { duration: 260, easing: "ease-out" },
        );
      }
      activePageIndex = index;
    };
    const startPageRotation = () => {
      if (
        !previewOnHover ||
        !previewRequested ||
        previewPages.length < 2 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      if (pageRotation !== undefined) window.clearInterval(pageRotation);
      pageRotation = window.setInterval(() => {
        showPage((activePageIndex + 1) % previewPages.length);
      }, 1500);
    };
    const requestPagePreview = () => {
      previewRequested = true;
      if (hoverDelay !== undefined) window.clearTimeout(hoverDelay);
      hoverDelay = window.setTimeout(startPageRotation, 700);
    };
    const stopPagePreview = () => {
      previewRequested = false;
      if (hoverDelay !== undefined) window.clearTimeout(hoverDelay);
      if (pageRotation !== undefined) window.clearInterval(pageRotation);
      hoverDelay = undefined;
      pageRotation = undefined;
      if (previewPages.length) showPage(0);
    };
    const previewRoot = container.parentElement;
    if (previewOnHover && previewRoot) {
      previewRoot.addEventListener("mouseenter", requestPagePreview);
      previewRoot.addEventListener("mouseleave", stopPagePreview);
      previewRoot.addEventListener("focusin", requestPagePreview);
      previewRoot.addEventListener("focusout", stopPagePreview);
    }

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
        previewPages = wrapper
          ? Array.from(
              wrapper.querySelectorAll<HTMLElement>(`section.${rendererClass}`),
            )
          : [];
        const firstPage = previewPages[0];
        if (!wrapper || !firstPage) {
          throw new Error("DOCX renderer did not produce a page preview.");
        }

        previewPages.forEach((page, index) => {
          page.style.position = index === 0 ? "relative" : "absolute";
          page.style.top = "0";
          page.style.left = "0";
          page.style.margin = "0";
          page.style.boxShadow = "none";
          page.style.display = index === 0 ? "block" : "none";
        });
        wrapper.style.position = "absolute";
        wrapper.style.top = "0";
        wrapper.style.padding = "0";
        wrapper.style.background = "transparent";
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
        if (previewRequested) requestPagePreview();
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
      stopPagePreview();
      previewRoot?.removeEventListener("mouseenter", requestPagePreview);
      previewRoot?.removeEventListener("mouseleave", stopPagePreview);
      previewRoot?.removeEventListener("focusin", requestPagePreview);
      previewRoot?.removeEventListener("focusout", stopPagePreview);
      container.replaceChildren();
    };
  }, [previewOnHover, rendererClass, src]);

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
