import type { TemplateItem } from "../data/documents";
import DocumentPage from "./DocumentPage";

interface TemplateCardProps {
  item: TemplateItem;
  onSelect: () => void;
}

export default function TemplateCard({ item, onSelect }: TemplateCardProps) {
  return (
    <button className="template-card" type="button" onClick={onSelect} aria-label={`Créer : ${item.title} ${item.subtitle ?? ""}`}>
      <DocumentPage kind={item.kind} />
      <span className="template-title">{item.title}</span>
      {item.subtitle && <span className="template-subtitle">{item.subtitle}</span>}
    </button>
  );
}
