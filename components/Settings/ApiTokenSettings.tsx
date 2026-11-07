"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Copy, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/Utilities/Button";
import { tokenApi, type ApiTokenInfo, type TokenAccess } from "@/lib/api/domains/token";
import { toast } from "@/utils/toast";

const TOKENS_KEY = ["api-tokens"];

/**
 * API tokens for other apps (the life store, an AI assistant, scripts): made here, shown once, revoked here.
 */
export function ApiTokenSettings() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [access, setAccess] = useState<TokenAccess>("read");
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: TOKENS_KEY,
    queryFn: async () => (await tokenApi.list()).data,
  });

  const create = useMutation({
    mutationFn: () => tokenApi.create({ name, access }),
    onSuccess: (res) => {
      setShown({ name: res.data.apiToken.name, token: res.data.token });
      setName("");
      void queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
    },
    onError: (err: Error) => toast.error(err.message || "The token wasn't made. Try again."),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => tokenApi.revoke(id),
    onSuccess: () => {
      toast.success("Token revoked. Anything using it is turned away from now on.");
      void queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
    },
    onError: (err: Error) => toast.error(err.message || "The token wasn't revoked. Try again."),
  });

  const confirmRevoke = (t: ApiTokenInfo) => {
    if (confirm(`Revoke "${t.name}"? Anything using it stops working at once.`)) revoke.mutate(t.id);
  };

  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.token);
      toast.success("Copied. Paste it where it's needed; it won't be shown again.");
    } catch {
      toast.error("Couldn't copy: select the token and copy it yourself.");
    }
  };

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6">
      <div className="flex items-center gap-3 mb-4">
        <KeyRound className="w-6 h-6 text-[var(--accent)]" />
        <h3 className="text-xl font-serif font-bold text-[var(--heading-text)]">API tokens</h3>
      </div>

      <p className="text-sm text-[var(--subheading-text)] mb-4 font-medium">
        For other apps that read or update Tome, sent as <code>Authorization: Bearer &lt;token&gt;</code>. A read token
        can only read; a write token can do anything the app can. A token is shown once, when it&apos;s made.
      </p>

      <form
        className="flex flex-wrap items-end gap-3 mb-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-[var(--foreground)]/80">
          Name
          <input
            className="px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--background)] text-[var(--foreground)] min-w-[14rem]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Life store"
            maxLength={100}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--foreground)]/80">
          Access
          <select
            className="px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--background)] text-[var(--foreground)]"
            value={access}
            onChange={(e) => setAccess(e.target.value as TokenAccess)}
          >
            <option value="read">Read</option>
            <option value="write">Read and write</option>
          </select>
        </label>
        <Button type="submit" variant="primary" size="md" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Making…" : "Make token"}
        </Button>
      </form>

      {shown && (
        <div className="bg-[var(--background)] rounded-md p-4 mb-5 space-y-2" role="status">
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {shown.name}: copy this token now. It won&apos;t be shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="px-2 py-1 rounded bg-[var(--card-bg)] border border-[var(--border-color)] text-sm break-all select-all">
              {shown.token}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
              <Copy className="w-4 h-4" /> Copy
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShown(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {isLoading && <div className="h-4 bg-[var(--border-color)] rounded animate-pulse w-48" />}
      {error && <p className="text-sm text-[var(--foreground)]/70">The tokens couldn&apos;t be loaded. Refresh to try again.</p>}
      {data && data.length === 0 && <p className="text-sm text-[var(--foreground)]/70">No tokens yet.</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-[var(--border-color)]">
          {data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--foreground)] truncate">{t.name}</p>
                <p className="text-sm text-[var(--foreground)]/70">
                  {t.access === "write" ? "Read and write" : "Read"} · ends in …{t.hint} · made{" "}
                  {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })} ·{" "}
                  {t.lastUsedAt ? `last used ${formatDistanceToNow(new Date(t.lastUsedAt), { addSuffix: true })}` : "never used"}
                </p>
              </div>
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                onClick={() => confirmRevoke(t)}
                disabled={revoke.isPending}
                aria-label={`Revoke ${t.name}`}
              >
                <Trash2 className="w-4 h-4" /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
