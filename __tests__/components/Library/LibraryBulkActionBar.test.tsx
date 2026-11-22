import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LibraryBulkActionBar } from "@/components/Library/LibraryBulkActionBar";
import { BookCard } from "@/components/Books/BookCard";

afterEach(() => cleanup());

const props = () => ({
  selectedCount: 2,
  matchingCount: 120,
  onSelectAllMatching: vi.fn(),
  onClearSelection: vi.fn(),
  onTags: vi.fn(),
  onAddToShelf: vi.fn(),
  onDelete: vi.fn(),
  onDone: vi.fn(),
});

describe("LibraryBulkActionBar", () => {
  test("shows the selection and offers to select every matching book", () => {
    const p = props();
    render(<LibraryBulkActionBar {...p} />);
    expect(screen.getByText("2 books selected")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Select all 120"));
    expect(p.onSelectAllMatching).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Tags"));
    fireEvent.click(screen.getByText("Add to shelf"));
    fireEvent.click(screen.getByText("Delete"));
    expect(p.onTags).toHaveBeenCalled();
    expect(p.onAddToShelf).toHaveBeenCalled();
    expect(p.onDelete).toHaveBeenCalled();
  });

  test("with nothing selected the actions are off; with everything selected there's no select all", () => {
    const { rerender } = render(<LibraryBulkActionBar {...props()} selectedCount={0} />);
    expect(screen.getByText("Delete").closest("button")).toBeDisabled();
    expect(screen.getByText("Tags").closest("button")).toBeDisabled();

    rerender(<LibraryBulkActionBar {...props()} selectedCount={120} />);
    expect(screen.queryByText(/Select all/)).not.toBeInTheDocument();
  });
});

describe("BookCard in select mode", () => {
  test("a click selects the book instead of opening it", () => {
    const onToggleSelect = vi.fn();
    const { rerender } = render(
      <BookCard id="7" title="Circe" authors={["Madeline Miller"]} selectable onToggleSelect={onToggleSelect} />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: "Select Circe" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(onToggleSelect).toHaveBeenCalledWith(7);

    rerender(<BookCard id="7" title="Circe" authors={["Madeline Miller"]} selectable selected onToggleSelect={onToggleSelect} />);
    expect(screen.getByRole("checkbox", { name: "Select Circe" })).toHaveAttribute("aria-checked", "true");
  });

  test("outside select mode it links to the book", () => {
    render(<BookCard id="7" title="Circe" authors={["Madeline Miller"]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/books/7");
  });
});
