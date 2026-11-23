import { describe, test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBookListView } from "@/hooks/useBookListView";
import type { Book } from "@/lib/db/schema/books";

const books = [
  { id: 1, title: "Circe", authors: ["Madeline Miller"], series: null },
  { id: 2, title: "Piranesi", authors: ["Susanna Clarke"], series: null },
] as unknown as Book[];

describe("useBookListView selection, without a select mode", () => {
  test("selecting a book is what turns select mode on, and clearing turns it off", () => {
    const { result } = renderHook(() => useBookListView({ books }));
    expect(result.current.isSelectMode).toBe(false);

    act(() => result.current.toggleBookSelection(1));
    expect(result.current.isSelectMode).toBe(true);
    expect([...result.current.selectedBookIds]).toEqual([1]);

    act(() => result.current.toggleBookSelection(1));
    expect(result.current.isSelectMode).toBe(false);

    act(() => result.current.toggleBookSelection(2));
    act(() => result.current.exitSelectMode());
    expect(result.current.isSelectMode).toBe(false);
    expect(result.current.selectedBookIds.size).toBe(0);
  });

  test("a long-press adds to the selection rather than replacing it", () => {
    const { result } = renderHook(() => useBookListView({ books }));
    act(() => result.current.toggleBookSelection(1));
    act(() => result.current.enterSelectModeWithSelection(2));
    expect([...result.current.selectedBookIds].sort()).toEqual([1, 2]);
  });

  test("select all picks every visible book, and again clears them", () => {
    const { result } = renderHook(() => useBookListView({ books }));
    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedBookIds.size).toBe(2);
    act(() => result.current.toggleSelectAll());
    expect(result.current.isSelectMode).toBe(false);
  });
});
