export function documentPreviewKind(
  title: string,
  fileName = title,
  kind = "",
): string {
  if (kind === "source") return "data";

  const label = `${title} ${fileName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (label.includes("fiche de lecture")) return "reading";
  if (label.includes("notes de cours")) return "notes";
  if (label.includes("rapport de stage") || label.includes("stage")) {
    return "internship";
  }
  if (label.includes("rapport")) return "lab";
  if (label.includes("question")) return "questions";
  if (label.includes("recherche")) return "outline";
  return "minimal";
}

export function isSvgThumbnail(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /\.svg$/i.test(new URL(url).pathname);
  } catch {
    return /\.svg(?:$|[?#])/i.test(url);
  }
}
