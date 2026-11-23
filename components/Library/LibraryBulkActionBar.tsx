"use client";

import { Tags, Library as ShelfIcon, Trash2, CheckCheck } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "@/components/Utilities/Button";

interface LibraryBulkActionBarProps {
  selectedCount: number;
  /** How many books match the current filters; "Select all" picks every one, not only the ones loaded. */
  matchingCount: number;
  onSelectAllMatching: () => void;
  onTags: () => void;
  onAddToShelf: () => void;
  onDelete: () => void;
  /** Clears the selection, which hides the bar. */
  onDone: () => void;
  loading?: boolean;
}

/** The bar along the bottom of the library while books are selected: what's selected, and what to do to it. */
export function LibraryBulkActionBar({
  selectedCount,
  matchingCount,
  onSelectAllMatching,
  onTags,
  onAddToShelf,
  onDelete,
  onDone,
  loading = false,
}: LibraryBulkActionBarProps) {
  const none = selectedCount === 0;
  const allSelected = selectedCount >= matchingCount && matchingCount > 0;

  return (
    <div
      id="library-bulk-action-bar"
      className={cn(
        "sidebar-offset fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-30",
        "bg-[var(--card-bg-emphasis)] backdrop-blur-sm border-t border-[var(--border-color)] shadow-lg",
        "animate-in slide-in-from-bottom duration-200"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-[var(--foreground)]" aria-live="polite">
            {selectedCount} {selectedCount === 1 ? "book" : "books"} selected
          </span>
          {!allSelected && (
            <button
              type="button"
              onClick={onSelectAllMatching}
              disabled={loading || matchingCount === 0}
              className="text-[var(--accent)] font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1"
            >
              <CheckCheck className="w-4 h-4" />
              Select all {matchingCount}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={onTags} disabled={loading || none} variant="primary" size="sm" icon={<Tags className="w-4 h-4" />} aria-label="Tags" title="Add or remove tags">
            <span className="hidden sm:inline">Tags</span>
          </Button>
          <Button
            onClick={onAddToShelf}
            disabled={loading || none}
            variant="primary"
            size="sm"
            icon={<ShelfIcon className="w-4 h-4" />}
            aria-label="Add to shelf"
            title="Add to shelf"
          >
            <span className="hidden sm:inline">Add to shelf</span>
          </Button>
          <Button onClick={onDelete} disabled={loading || none} variant="danger" size="sm" icon={<Trash2 className="w-4 h-4" />} aria-label="Delete" title="Delete books">
            <span className="hidden sm:inline">Delete</span>
          </Button>
          <Button onClick={onDone} disabled={loading} variant="secondary" size="sm" title="Clear the selection">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
