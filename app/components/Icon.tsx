import type { ReactNode } from "react";

type IconName = "apps" | "chevron" | "edit" | "folder" | "grid" | "list" | "more" | "search" | "sort";

interface IconProps {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  edit: <><path d="m12 20 8-8-8-8-8 8 8 8Z" /><path d="m9 15 6-6" /><path d="M4 20h16" /></>,
  apps: <><circle cx="5" cy="5" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="19" cy="5" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="19" r="1" /><circle cx="12" cy="19" r="1" /><circle cx="19" cy="19" r="1" /></>,
  more: <><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" /></>,
  chevron: <path d="m8 10 4 4 4-4" />,
  grid: <><rect x="4" y="5" width="16" height="14" rx="1" /><path d="M9 5v14M4 10h16M4 14.5h16" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="5" cy="6" r=".8" fill="currentColor" /><circle cx="5" cy="12" r=".8" fill="currentColor" /><circle cx="5" cy="18" r=".8" fill="currentColor" /></>,
  sort: <><path d="M8 4v16m0-16L5 7m3-3 3 3M16 20V4m0 16-3-3m3 3 3-3" /></>,
  folder: <path d="M3 7.5h7l2-2h9v14H3z" />,
};

export default function Icon({ name, size = 24 }: IconProps) {
  return (
    <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
