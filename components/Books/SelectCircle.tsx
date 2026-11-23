"use client";

import { Check } from "lucide-react";
import { cn } from "@/utils/cn";

interface SelectCircleProps {
  selected: boolean;
  onToggle: () => void;
  /** What is being selected, for screen readers: "Select <label>". */
  label: string;
  /**
   * Keep the circle showing. Pass true once anything is selected, so every item shows it can be added to the
   * selection. Otherwise the circle appears when the pointer is over its item (the nearest `group`), when it has
   * keyboard focus, and always on touch screens, which can't hover.
   */
  revealed?: boolean;
  className?: string;
}

/**
 * The round checkbox that selects an item for bulk actions. There is no select mode to turn on: the circle shows on
 * hover, and once one item is selected, clicking any item adds it (see useBookListView and the library page).
 */
export function SelectCircle({ selected, onToggle, label, revealed = false, className }: SelectCircleProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select ${label}`}
      onClick={(e) => {
        // The circle sits on a link or a clickable row: select, don't open the book or toggle twice.
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center shadow transition-opacity",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:opacity-100",
        selected
          ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)]"
          : "bg-card/80 border-foreground/50 text-transparent hover:border-[var(--accent)]",
        selected || revealed
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-70",
        className
      )}
    >
      <Check className="w-4 h-4" strokeWidth={3} />
    </button>
  );
}
