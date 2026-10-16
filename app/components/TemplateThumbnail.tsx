"use client";

import Image from "next/image";
import { useState } from "react";
import DocumentPage from "./DocumentPage";
import DocxPagePreview from "./DocxPagePreview";

export default function TemplateThumbnail({
  templateId,
  src,
  className = "",
  fallbackKind = "minimal",
}: {
  templateId?: string;
  src?: string;
  className?: string;
  fallbackKind?: string;
}) {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  if (templateId) {
    return (
      <DocxPagePreview
        src={`/api/templates/${encodeURIComponent(templateId)}/preview`}
        className={`uploaded-template-preview ${className}`.trim()}
        fallbackKind={fallbackKind}
      />
    );
  }

  return (
    <span className={`uploaded-template-preview ${className}`.trim()}>
      {src && !imageUnavailable && (
        <Image
          className="uploaded-template-image"
          src={src}
          width={100}
          height={133}
          alt=""
          aria-hidden="true"
          unoptimized
          onError={() => setImageUnavailable(true)}
        />
      )}
      {(!src || imageUnavailable) && <DocumentPage kind={fallbackKind} />}
    </span>
  );
}
