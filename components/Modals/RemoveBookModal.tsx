"use client";

import { useState } from "react";
import BaseModal from "./BaseModal";
import { Button } from "@/components/Utilities/Button";

interface RemoveBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  bookTitle: string;
  totalReads: number;
}

/** Confirms removing a book added by hand: it takes the book's reading history with it. */
export default function RemoveBookModal({ isOpen, onClose, onConfirm, bookTitle, totalReads }: RemoveBookModalProps) {
  const [removing, setRemoving] = useState(false);
  const confirm = async () => {
    setRemoving(true);
    try {
      await onConfirm();
    } finally {
      setRemoving(false);
    }
  };
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !removing && onClose()}
      title="Remove this book?"
      allowBackdropClose={false}
      actions={
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={removing} size="md">
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={removing} size="md">
            {removing ? "Removing..." : "Remove book"}
          </Button>
        </div>
      }
    >
      <p className="text-lg italic font-bold font-serif text-[var(--heading-text)] mb-3">{bookTitle}</p>
      <div className="text-sm text-[var(--subheading-text)] font-medium space-y-2">
        <p className="font-semibold text-red-600 dark:text-red-500">This permanently deletes, with the book:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>every reading session{totalReads > 0 ? ` (read ${totalReads} ${totalReads === 1 ? "time" : "times"})` : ""}</li>
          <li>all its progress logs and notes</li>
          <li>its cover, and its place on your shelves</li>
        </ul>
        <p>Your reading stats will no longer count it. This can&apos;t be undone.</p>
      </div>
    </BaseModal>
  );
}
