"use client";

import Image from "next/image";
import { useState } from "react";
import DocumentPage from "./DocumentPage";

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
  const imageSrc =
    src ?? (templateId ? `/api/templates/${encodeURIComponent(templateId)}/thumbnail` : null);

  return (
    <span className={`uploaded-template-preview ${className}`.trim()}>
      {imageSrc && !imageUnavailable && (
        <Image
          className="uploaded-template-image"
          src={imageSrc}
          width={100}
          height={133}
          alt=""
          aria-hidden="true"
          unoptimized
          onError={() => setImageUnavailable(true)}
        />
      )}
      {(!imageSrc || imageUnavailable) && <DocumentPage kind={fallbackKind} />}
    </span>
  );
}
