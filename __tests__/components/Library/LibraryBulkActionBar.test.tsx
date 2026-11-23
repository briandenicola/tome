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

describe("BookCard selection, without a select mode", () => {
  test("a selectable card still opens the book, and its circle selects it", () => {
    const onToggleSelect = vi.fn();
    render(<BookCard id="7" title="Circe" authors={["Madeline Miller"]} selectable onToggleSelect={onToggleSelect} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/books/7");
    const circle = screen.getByRole("checkbox", { name: "Select Circe" });
    expect(circle).toHaveAttribute("aria-checked", "false");
    // Hidden until hover, so it doesn't clutter the covers
    expect(circle.className).toContain("opacity-0");
    fireEvent.click(circle);
    expect(onToggleSelect).toHaveBeenCalledWith(7);
  });

  test("once anything is selected, a click on the card selects it instead of opening it", () => {
    const onToggleSelect = vi.fn();
    const { container } = render(
      <BookCard id="7" title="Circe" authors={["Madeline Miller"]} selectable selecting onToggleSelect={onToggleSelect} />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Circe" }).className).toContain("opacity-100");
    fireEvent.click(container.querySelector("h3")!);
    expect(onToggleSelect).toHaveBeenCalledWith(7);
  });

  test("a selected card shows it", () => {
    render(<BookCard id="7" title="Circe" authors={["Madeline Miller"]} selectable selecting selected onToggleSelect={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Select Circe" })).toHaveAttribute("aria-checked", "true");
  });

  test("a card that can't be selected has no circle", () => {
    render(<BookCard id="7" title="Circe" authors={["Madeline Miller"]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/books/7");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
