export interface TemplateItem {
  title: string;
  subtitle?: string;
  kind: string;
}

export interface DocumentItem {
  title: string;
  fileName?: string;
  date: string;
  kind: string;
  url?: string;
  templateId?: string | null;
  thumbnailUrl?: string | null;
}
