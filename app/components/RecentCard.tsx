import type { DocumentItem } from "../data/documents";
import DocIcon from "./DocIcon";
import DocxPagePreview from "./DocxPagePreview";
import DocumentPage from "./DocumentPage";
import Icon from "./Icon";
import TemplateThumbnail from "./TemplateThumbnail";
import { documentPreviewKind, isSvgThumbnail } from "../lib/document-preview-kind";

interface RecentCardProps {
  item: DocumentItem;
  onOpen: () => void;
  onQuickEdit?: () => void;
  onMore: () => void;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}

export default function RecentCard({
  item,
  onOpen,
  onQuickEdit,
  onMore,
  selectable,
  selected,
  onSelect,
}: RecentCardProps) {
  return (
    <article className={`recent-card${selected ? " recent-card-selected" : ""}`}>
      {selectable && (
        <label className="recent-select">
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`Sélectionner ${item.title}`}
          />
        </label>
      )}
      <button className="recent-preview" type="button" onClick={onOpen} aria-label={`Ouvrir ${item.title}`}>
        {item.templateId ? (
          <TemplateThumbnail
            templateId={item.templateId}
            className="recent-docx-preview"
            fallbackKind={documentPreviewKind(item.title, item.fileName, item.kind)}
          />
        ) : /\.docx$/i.test(item.fileName ?? item.title) && item.url ? (
          <DocxPagePreview
            src={item.url}
            className="recent-docx-preview"
            fallbackKind={documentPreviewKind(item.title, item.fileName, item.kind)}
            previewOnHover
          />
        ) : isSvgThumbnail(item.thumbnailUrl) ? (
          <DocumentPage
            kind={documentPreviewKind(
              item.title,
              item.fileName,
              item.kind,
            )}
          />
        ) : item.templateId || item.thumbnailUrl ? (
          <TemplateThumbnail
            src={item.thumbnailUrl ?? undefined}
            className="recent-docx-preview"
            fallbackKind={documentPreviewKind(item.title, item.fileName, item.kind)}
          />
        ) : (
          <DocumentPage kind={documentPreviewKind(item.title, item.fileName, item.kind)} />
        )}
      </button>
      <div className="recent-meta">
        <div className="recent-copy">
          <span className="recent-title">{item.title}</span>
          <span className="recent-date"><DocIcon />{item.date}</span>
        </div>
        <div className="recent-card-actions">
          {onQuickEdit && (
            <button
              className="icon-button card-menu"
              type="button"
              onClick={onQuickEdit}
              aria-label={`Modification rapide : ${item.title}`}
              title="Modifier rapidement"
            >
              <Icon name="edit" size={17} />
            </button>
          )}
          <button className="icon-button card-menu" type="button" onClick={onMore} aria-label={`Partager ${item.title}`} title="Partager"><Icon name="more" size={22} /></button>
        </div>
      </div>
    </article>
  );
}
