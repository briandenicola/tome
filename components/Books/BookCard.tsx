"use client";

import Link from "next/link";
import Image from "next/image";
import { BookOpen, Check } from "lucide-react";
import { cn } from "@/utils/cn";
import { useState, memo } from "react";
import { StatusBadge } from "@/components/Utilities/StatusBadge";
import { type BookStatus } from "@/utils/statusConfig";
import { getCoverUrl } from "@/lib/utils/cover-url";

interface BookCardProps {
  id: string;
  title: string;
  authors: string[];
  status?: string | null;
  currentProgress?: number;
  className?: string;
  lastSynced?: Date | string | null;
  /** In select mode a click selects the book instead of opening it. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}

export const BookCard = memo(function BookCard({
  id,
  title,
  authors,
  status,
  currentProgress,
  className,
  lastSynced,
  selectable = false,
  selected = false,
  onToggleSelect,
}: BookCardProps) {
  const [imageError, setImageError] = useState(false);

  const card = (
      <div
        className={cn(
          "bg-[var(--card-bg)] border border-[var(--border-color)] shadow-lg rounded-md hover:shadow-xl transition-shadow cursor-pointer overflow-hidden group",
          selectable && selected && "ring-2 ring-[var(--accent)] border-[var(--accent)]",
          className
        )}
      >
        <div className="aspect-[2/3] bg-[var(--light-accent)]/30 flex items-center justify-center overflow-hidden relative">
          {selectable && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center shadow",
                selected
                  ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                  : "bg-[var(--card-bg)]/80 border-[var(--foreground)]/40"
              )}
            >
              {selected && <Check className="w-4 h-4" />}
            </span>
          )}
          {!imageError ? (
            <Image
              src={getCoverUrl(Number(id), lastSynced)}
              alt={title}
              fill
              loading="lazy"
              className="object-cover group-hover:opacity-95 transition-opacity"
              onError={() => setImageError(true)}
            />
          ) : (
            <BookOpen className="w-16 h-16 text-[var(--accent)]/40" />
          )}
        </div>

        <div className="p-4 space-y-1">
          <h3 className="text-md font-semibold text-[var(--heading-text)] line-clamp-2 leading-snug">
            {title}
          </h3>
          <p className="text-md font-serif text-[var(--subheading-text)] line-clamp-1 font-medium">
            {authors.join(", ")}
          </p>

          {status && (
            <div className="pt-2">
              <StatusBadge status={status as BookStatus} size="sm" />
            </div>
          )}

          {currentProgress !== undefined && status !== "read" && (
            <div className="pt-3 mt-1 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs uppercase tracking-wider font-semibold text-[var(--foreground)]/60">Progress</span>
                <span className="text-sm font-mono font-bold text-[var(--accent)]">{Math.round(currentProgress)}%</span>
              </div>
              <div className="w-full bg-[var(--background)] rounded-full h-2.5 shadow-inner">
                <div
                  className="bg-gradient-to-r from-[var(--accent)] to-[var(--light-accent)] h-2.5 rounded-full transition-all duration-300 ease-out shadow-sm"
                  style={{ width: `${Math.min(100, currentProgress)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
  );

  if (selectable) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${title}`}
        onClick={() => onToggleSelect?.(Number(id))}
        className="block w-full text-left"
      >
        {card}
      </button>
    );
  }

  return <Link href={`/books/${id}`}>{card}</Link>;
}, (prevProps, nextProps) => {
  // Custom comparison function for memo
  // Only re-render if these key props change
  return (
    prevProps.id === nextProps.id &&
    prevProps.title === nextProps.title &&
    prevProps.status === nextProps.status &&
    prevProps.currentProgress === nextProps.currentProgress &&
    prevProps.lastSynced === nextProps.lastSynced &&
    prevProps.selectable === nextProps.selectable &&
    prevProps.selected === nextProps.selected &&
    prevProps.onToggleSelect === nextProps.onToggleSelect
  );
});
