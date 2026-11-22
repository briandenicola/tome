"use client";

import { AlertTriangle } from "lucide-react";
import BaseModal from "@/components/Modals/BaseModal";
import { Button } from "@/components/Utilities/Button";

interface BulkDeleteBooksModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookCount: number;
  deleting: boolean;
  onConfirm: () => void;
}

/** Confirms deleting the selected books. Calibre books are skipped, and the person is told so before and after. */
export function BulkDeleteBooksModal({ isOpen, onClose, bookCount, deleting, onConfirm }: BulkDeleteBooksModalProps) {
  const books = `${bookCount} ${bookCount === 1 ? "book" : "books"}`;
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete books"
      subtitle={`${books} selected`}
      size="md"
      loading={deleting}
      actions={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" size="md" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Deleting..." : `Delete ${books}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--foreground)]">
            Books added by hand or from Audiobookshelf or Grimmory are removed from Tome with their reading sessions,
            progress, shelf places and covers. This can&apos;t be undone.
          </p>
        </div>
        <p className="text-sm text-foreground/70">
          Calibre books are skipped: Tome doesn&apos;t change your Calibre library, and a Calibre book removed here would
          come back on the next sync without its reading history. Remove those in Calibre.
        </p>
      </div>
    </BaseModal>
  );
}
