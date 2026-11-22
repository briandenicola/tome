"use client";

import { useEffect, useState } from "react";
import BaseModal from "@/components/Modals/BaseModal";
import { Button } from "@/components/Utilities/Button";
import { TagSelector } from "@/components/TagManagement/TagSelector";
import { cn } from "@/utils/cn";

interface BulkTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookCount: number;
  availableTags: string[];
  onSubmit: (action: "add" | "remove", tags: string[]) => Promise<void>;
}

/** Adds tags to, or removes them from, every selected book. */
export function BulkTagModal({ isOpen, onClose, bookCount, availableTags, onSubmit }: BulkTagModalProps) {
  const [action, setAction] = useState<"add" | "remove">("add");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAction("add");
      setTags([]);
    }
  }, [isOpen]);

  async function submit() {
    setSaving(true);
    try {
      await onSubmit(action, tags);
    } finally {
      setSaving(false);
    }
  }

  const books = `${bookCount} ${bookCount === 1 ? "book" : "books"}`;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Tags"
      subtitle={`${books} selected`}
      size="md"
      loading={saving}
      actions={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" size="md" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={saving || tags.length === 0}>
            {saving ? "Saving..." : action === "add" ? `Add to ${books}` : `Remove from ${books}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Add or remove" className="inline-flex rounded-md border border-[var(--border-color)] overflow-hidden">
          {(["add", "remove"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={action === a}
              onClick={() => setAction(a)}
              className={cn(
                "px-4 py-2 text-sm font-medium",
                action === a ? "bg-[var(--accent)] text-white" : "text-[var(--foreground)] hover:bg-[var(--hover-bg)]"
              )}
            >
              {a === "add" ? "Add tags" : "Remove tags"}
            </button>
          ))}
        </div>
        <TagSelector
          availableTags={availableTags}
          selectedTags={tags}
          onTagsChange={setTags}
          disabled={saving}
          allowCreate={action === "add"}
          placeholder={action === "add" ? "Search or create tags..." : "Search tags..."}
        />
        <p className="text-xs text-foreground/60">Tags on Calibre books are written to Calibre too, as when you tag one book.</p>
      </div>
    </BaseModal>
  );
}
