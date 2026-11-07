# Tome Constitution

**Version**: | 2.0.0 | **Ratified**: 2025-11-24 | **Last Amended**: 2026-11-07

---

## 1. Purpose

Tome exists to give readers durable, local ownership of their reading history.

Most book tracking happens in cloud services that can disappear, change terms, or lock users out. Tome pulls tracking closer to where books already live—in a personal Calibre library, on an e-reader, in an audiobook server or on a shelf—and provides clean, permanent records of reading journeys that users fully control.

---

## 2. Mission

Tome commits to:

- **Tracking reading history locally** with complete fidelity and zero data loss
- **Integrating seamlessly with Calibre** when it is used, without disrupting existing workflows, and working just as well without it
- **Preserving every reading session** so users can see their full journey with each book
- **Enabling self-hosting** without complex infrastructure or maintenance burden
- **Protecting user data** with limited, read-primary Calibre access and bulletproof local storage

---

## 3. Vision

A world where personal book tracking is as durable and accessible as the books themselves.

Reading history should outlive services, survive platform changes, and remain under user control. Tome envisions a future where readers own their data, self-hosting is simple, and tracking integrates naturally with existing book management—not as a replacement, but as a complement to tools like Calibre and Calibre Web, continuously enriching your ebook ecosystem.

---

## 4. Guiding Principles

These principles guide every decision. When evaluating features, changes, or trade-offs, ask: does this align with these principles?

### I. Protect User Data Above All

User data is irreplaceable. Reading history represents time, memories, and personal growth.

**Decision Filter**: Would this change risk data loss, corruption, or confusion? If yes, find another way.

**Examples**:
- Prefer read-only access to Calibre's database (only write ratings bidirectionally)
- Use migrations with automatic backups, never ad-hoc schema changes
- Validate temporal relationships to prevent timeline inconsistencies

---

### II. Calibre Is Optional; Where It's Used, It's the Source of Truth

A book comes from Calibre or is added by hand. Tome tracks reading for both the same way. For a Calibre book, Calibre manages the book; for a book added by hand, Tome keeps the few details it needs (title, authors, pages, cover).

**Decision Filter**: For a Calibre book, would this compete with, duplicate, or modify Calibre's or Calibre Web's core responsibilities? If yes, don't build it. Would this feature only work when Calibre is set up, where it needn't? If yes, make it work without.

**Examples**:
- Never edit book metadata, authors or series in Calibre
- Sync ratings and tags with Calibre for Calibre books; keep them in Tome for books added by hand
- Never remove or orphan a book added by hand because of a Calibre sync

---

### III. Preserve Complete History

Users re-read books. They change their minds. They want to see their journey over time.

**Decision Filter**: Would this feature delete or overwrite historical data? If yes, rethink it.

**Examples**:
- Archive old sessions when re-reading, never delete them
- Maintain reading counts across all sessions
- Allow backdated entries for catch-up logging without losing temporal integrity

---

### IV. Make Complexity Invisible

Users shouldn't think about databases, migrations, sync logic, or temporal validation. The app should "just work."

**Decision Filter**: Does this require users to understand implementation details? If yes, simplify the interface.

**Examples**:
- Auto-set start dates on first progress entry
- Auto-complete sessions at 100% progress
- Provide smart defaults; allow overrides for power users

---

### V. Trust but Verify

Logging and testing aren't overhead—they're how we keep promises to users and our only means for quality and confidence.

**Decision Filter**: Can we diagnose failures when this breaks? Can we verify correctness before shipping?

**Examples**:
- Structured logging with correlation IDs for request tracing
- Test with real databases to catch integration issues mocks miss
- Run comprehensive tests before merging to main

---

## 5. Non-Negotiables

These constraints define Tome's identity. Violating them means building a different product.

1. **Local-First Architecture**
   All user data lives locally. No cloud sync, no mandatory accounts, no server-side storage.

2. **Calibre Integration, Optional**
   Tome reads from Calibre's library when one is configured, and runs fully without one. Breaking either way of running breaks Tome.

3. **Self-Hostable**
   Users deploy Tome on their own infrastructure. No SaaS version, no vendor lock-in.

4. **Zero External Service Dependencies**
   Tome must run in complete isolation. No Redis, no cloud APIs, no message queues. A lookup a person asks for by clicking (like filling a book's details from its ISBN) may call a public service; nothing calls out on its own, and everything works when that service is unreachable.

5. **Reading History Preservation**
   Reading history is durable and permanent. Sessions can be archived, hidden, or marked inactive by the system. Users may permanently delete sessions via explicit action with confirmation, but deletion is never automatic or implicit.

---

## 6. Domain Vocabulary

Tome uses these terms consistently across code, docs, and UI:

- **Session**: A single read-through of a book from start to finish (or abandonment). Users can have multiple sessions for the same book.

- **Progress**: A snapshot of reading advancement within a session (page number, percentage, timestamp).

- **Re-reading**: Starting a new session for a book with existing sessions. Previous sessions are archived and preserved.

- **Calibre Sync**: For Calibre books, bidirectional rating and tag synchronization between Tome and Calibre. Calibre remains the source of truth for their metadata.

- **Source**: Where a book came from: `calibre` (synced from a Calibre library) or `manual` (added by hand in Tome).

- **Reading Streak**: Consecutive days with at least one progress entry. Breaks on missed days; resets on new streaks.

- **Completion**: A session reaches 100% progress. Automatically sets `completedDate` unless backdated.

---

## 7. Scope Boundaries

Tome is focused. These are out of scope permanently:

### What Tome Will NOT Do

1. **Replace Calibre**
   Calibre manages books, metadata and ebook files. Tome tracks reading, and keeps only the details it needs for a book added by hand. It doesn't store ebook files, convert formats or manage a library.

2. **Discover or Recommend Books**
   No algorithmic recommendations, trending lists, or discovery features. Users know what they want to read.

3. **Provide Social Features**
   No followers, likes, comments, or sharing. Tome is personal, not social.

4. **Operate as a Cloud Service**
   No SaaS version, no hosted offering. Tome is self-hosted only.

5. **Edit Calibre Book Metadata**
   For a Calibre book, Calibre owns title, author, series and cover image. Tome respects that boundary. Books added by hand are edited in Tome.

---

## 8. Amendment Process

The constitution evolves, but changes must be deliberate and justified.

### Proposing Amendments

1. **Open a GitHub issue** tagged `constitution`
2. **Include**:
   - **Rationale**: Why is this change needed?
   - **Impact Assessment**: What breaks? What must change?
   - **Migration Plan**: How do existing systems comply?
3. **Discussion period**: Allow time for feedback and refinement
4. **Approval**: Maintainer approval required before amendment

### Versioning

Constitution follows semantic versioning:

- **MAJOR (x.0.0)**: Removes or redefines core principles. Breaking change to project identity.
- **MINOR (0.x.0)**: Adds new principles or materially expands guidance. New constraints or commitments.
- **PATCH (0.0.x)**: Clarifies wording, fixes typos, refines non-semantic details. No new constraints.

### Compliance

- All commits and pull requests must verify compliance with this constitution
- Principle violations must be explicitly justified in commit or PR descriptions
- Code reviews check for alignment with guiding principles
- Unjustified complexity or external dependencies are rejected

---

## Change Log

**v2.0.0** (2026-11-07)
- MAJOR: Redefined Principle II and Non-Negotiable #2: Calibre is optional. Books come from Calibre or are added by hand (title, authors, pages, cover upload or URL); Tome tracks both the same way.
- Amended Non-Negotiable #4: a lookup the user starts by clicking (ISBN lookup from Open Library) may call a public service; nothing calls out on its own.
- Narrowed Scope #1 and #5 to Calibre books.
- Rationale: readers who use a Kobo, Audiobookshelf or physical books want Tome's history and stats without running Calibre.
- Impact: `books.calibre_id` is nullable and each book has a `source`; covers are served by Tome book id; Calibre sync and orphan detection ignore books added by hand; ratings and tags of books added by hand stay in Tome.
- Migration: existing books keep their Calibre ids and get `source = 'calibre'`.

**v1.1.0** (2026-02-02)
- MINOR: Amended Non-Negotiable #5 to allow explicit user-initiated session deletion with confirmation
- Rationale: Users need ability to remove incorrect or mistakenly created sessions
- Impact: Added DELETE endpoint for sessions with confirmation modal in UI
- Migration: No schema changes; deletion uses existing CASCADE foreign keys

**v1.0.0** (2025-11-24)
Initial constitution ratified with five core principles.