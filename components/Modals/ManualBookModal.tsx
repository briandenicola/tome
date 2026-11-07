"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import BaseModal from "./BaseModal";
import { Button } from "@/components/Utilities/Button";
import { toast } from "@/utils/toast";
import { manualBookApi, type ManualBookRequest } from "@/lib/api";

/** The details of a book added by hand, as the form edits them. */
export interface ManualBookFields {
  id: number;
  title: string;
  authors: string[];
  totalPages?: number | null;
  isbn?: string | null;
  publisher?: string | null;
  pubDate?: Date | string | null;
  series?: string | null;
  seriesIndex?: number | null;
  description?: string | null;
  coverFile?: string | null;
}

interface ManualBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The book to edit; leave out to add one. */
  book?: ManualBookFields;
  /** Called with the saved book's id. */
  onSaved: (bookId: number) => void;
}

const input =
  "w-full px-3 py-2 border border-[var(--border-color)] rounded-lg bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-colors disabled:opacity-50";
const label = "block text-sm font-medium text-[var(--heading-text)] mb-1";

function dateValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

const empty = {
  title: "",
  authors: "",
  totalPages: "",
  isbn: "",
  publisher: "",
  pubDate: "",
  series: "",
  seriesIndex: "",
  description: "",
};

export default function ManualBookModal({ isOpen, onClose, book, onSaved }: ManualBookModalProps) {
  const [form, setForm] = useState(empty);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [removeCover, setRemoveCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(
      book
        ? {
            title: book.title,
            authors: book.authors.join(", "),
            totalPages: book.totalPages?.toString() ?? "",
            isbn: book.isbn ?? "",
            publisher: book.publisher ?? "",
            pubDate: dateValue(book.pubDate),
            series: book.series ?? "",
            seriesIndex: book.seriesIndex?.toString() ?? "",
            description: book.description ?? "",
          }
        : empty
    );
    setCoverFile(null);
    setCoverUrl("");
    setRemoveCover(false);
  }, [isOpen, book]);

  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const lookUp = async () => {
    setLookingUp(true);
    try {
      const found = await manualBookApi.lookupIsbn(form.isbn);
      // Fill only what's empty, so nothing typed is lost.
      setForm((f) => ({
        ...f,
        isbn: found.isbn,
        title: f.title || found.title || "",
        authors: f.authors || (found.authors ?? []).join(", "),
        totalPages: f.totalPages || found.totalPages?.toString() || "",
        publisher: f.publisher || found.publisher || "",
        pubDate: f.pubDate || found.pubDate || "",
        description: f.description || found.description || "",
      }));
      if (found.coverUrl && !coverFile && !coverUrl && !book?.coverFile) setCoverUrl(found.coverUrl);
      toast.success("Filled in from Open Library. Check the details before saving.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't look the ISBN up.");
    } finally {
      setLookingUp(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const request: ManualBookRequest = {
      title: form.title,
      authors: form.authors.split(",").map((a) => a.trim()).filter(Boolean),
      totalPages: form.totalPages ? Number(form.totalPages) : null,
      isbn: form.isbn || null,
      publisher: form.publisher || null,
      pubDate: form.pubDate || null,
      series: form.series || null,
      seriesIndex: form.seriesIndex ? Number(form.seriesIndex) : null,
      description: form.description || null,
    };
    try {
      const saved = book ? await manualBookApi.update(book.id, request) : await manualBookApi.create(request);
      try {
        if (coverFile) await manualBookApi.uploadCover(saved.id, coverFile);
        else if (coverUrl.trim()) await manualBookApi.setCoverFromUrl(saved.id, coverUrl.trim());
        else if (removeCover) await manualBookApi.removeCover(saved.id);
      } catch (error) {
        // The book is saved; only the cover isn't. Say so, and let them try again from the book's page.
        toast.error(`${book ? "Saved" : "Added"} the book, but not its cover: ${error instanceof Error ? error.message : "try again."}`);
        onSaved(saved.id);
        onClose();
        return;
      }
      toast.success(book ? "Saved." : `Added "${saved.title}".`);
      onSaved(saved.id);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the book.");
    } finally {
      setSaving(false);
    }
  };

  const close = () => !saving && onClose();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={close}
      title={book ? "Edit book" : "Add a book"}
      subtitle={book ? undefined : "For a book that isn't in Calibre: on your e-reader, an audiobook, or on the shelf."}
      size="lg"
      allowBackdropClose={false}
      actions={
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={close} disabled={saving} size="md">
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !form.title.trim()} size="md">
            {saving ? "Saving..." : book ? "Save" : "Add book"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="mb-isbn">
            ISBN
          </label>
          <div className="flex gap-2">
            <input id="mb-isbn" className={input} value={form.isbn} onChange={set("isbn")} disabled={saving} placeholder="978…" />
            <Button
              variant="secondary"
              size="md"
              onClick={lookUp}
              disabled={saving || lookingUp || form.isbn.replace(/[\s-]/g, "").length < 10}
              icon={<Search className="w-4 h-4" />}
              title="Fill the form from Open Library"
              className="whitespace-nowrap shrink-0"
            >
              {lookingUp ? "Looking up..." : "Look up"}
            </Button>
          </div>
          <p className="text-xs text-[var(--subheading-text)] mt-1">
            Look up asks Open Library for this ISBN. Nothing is sent anywhere unless you click it.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="mb-title">
            Title
          </label>
          <input id="mb-title" className={input} value={form.title} onChange={set("title")} disabled={saving} autoFocus />
        </div>

        <div>
          <label className={label} htmlFor="mb-authors">
            Authors
          </label>
          <input
            id="mb-authors"
            className={input}
            value={form.authors}
            onChange={set("authors")}
            disabled={saving}
            placeholder="Separate several with commas"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="mb-pages">
              Pages
            </label>
            <input id="mb-pages" type="number" min="1" step="1" className={input} value={form.totalPages} onChange={set("totalPages")} disabled={saving} />
          </div>
          <div>
            <label className={label} htmlFor="mb-pubdate">
              Published
            </label>
            <input id="mb-pubdate" className={input} value={form.pubDate} onChange={set("pubDate")} disabled={saving} placeholder="2024 or 2024-05-17" />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="mb-publisher">
            Publisher
          </label>
          <input id="mb-publisher" className={input} value={form.publisher} onChange={set("publisher")} disabled={saving} />
        </div>

        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div>
            <label className={label} htmlFor="mb-series">
              Series
            </label>
            <input id="mb-series" className={input} value={form.series} onChange={set("series")} disabled={saving} />
          </div>
          <div>
            <label className={label} htmlFor="mb-series-index">
              Number
            </label>
            <input id="mb-series-index" type="number" min="0" step="any" className={input} value={form.seriesIndex} onChange={set("seriesIndex")} disabled={saving} />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="mb-description">
            Description
          </label>
          <textarea id="mb-description" rows={3} className={input} value={form.description} onChange={set("description")} disabled={saving} />
        </div>

        <div>
          <span className={label}>Cover</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            disabled={saving}
            aria-label="Cover image file"
            onChange={(e) => {
              setCoverFile(e.target.files?.[0] ?? null);
              setRemoveCover(false);
            }}
            className="block w-full text-sm text-[var(--foreground)] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:text-white"
          />
          <input
            className={`${input} mt-2`}
            value={coverUrl}
            onChange={(e) => {
              setCoverUrl(e.target.value);
              setRemoveCover(false);
            }}
            disabled={saving || !!coverFile}
            placeholder="…or paste the address of an image"
            aria-label="Cover image address"
          />
          <p className="text-xs text-[var(--subheading-text)] mt-1">JPEG, PNG, GIF or WebP, up to 5 MB. Tome keeps a copy.</p>
          {book?.coverFile && !coverFile && !coverUrl && (
            <label className="flex items-center gap-2 text-sm mt-2 text-[var(--foreground)]">
              <input type="checkbox" checked={removeCover} onChange={(e) => setRemoveCover(e.target.checked)} disabled={saving} />
              Remove the current cover
            </label>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
