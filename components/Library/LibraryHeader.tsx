"use client";

import { RefreshCw, Library as LibraryIcon, Plus } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "@/components/Utilities/Button";

interface LibraryHeaderProps {
  totalBooks: number;
  syncing: boolean;
  onSync: () => void;
  /** Opens the form to add a book by hand. */
  onAddBook?: () => void;
  /** Whether a Calibre library is set up; the sync button only shows when it is. */
  calibreConfigured?: boolean;
  loading?: boolean;
}

export function LibraryHeader({
  totalBooks,
  syncing,
  onSync,
  onAddBook,
  calibreConfigured = true,
  loading = false,
}: LibraryHeaderProps) {
  return (
    <div className="flex items-start justify-between border-b border-[var(--border-color)] pb-6">
      <div>
        <h1 className="text-5xl font-serif font-bold text-[var(--heading-text)] flex items-center gap-3">
          <LibraryIcon className="w-8 h-8" />
          Library
        </h1>
        {loading ? (
          <p className="text-[var(--subheading-text)] mt-2 font-medium">
            <span className="inline-block h-[1.25rem] w-24 bg-[var(--foreground)]/10 rounded animate-pulse align-middle" />
          </p>
        ) : (
          <p className="text-[var(--subheading-text)] mt-2 font-medium">
            {totalBooks} {totalBooks === 1 ? "book" : "books"}
          </p>
        )}
      </div>

      <div className="flex gap-2 mt-3 sm:mt-2">
        {onAddBook && (
          <Button
            onClick={onAddBook}
            variant={calibreConfigured ? "secondary" : "primary"}
            size="xl"
            icon={<Plus className="w-4 h-4" />}
            title="Add a book that isn't in Calibre"
          >
            <span className="hidden sm:inline">Add book</span>
          </Button>
        )}
        {calibreConfigured && (
          <Button
            onClick={onSync}
            disabled={syncing}
            variant="primary"
            size="xl"
            icon={<RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />}
            title={syncing ? "Syncing..." : "Sync Calibre"}
          >
            <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync Calibre"}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
