"use client";

import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/Layout/PageHeader";
import { ReadingSourcesSettings } from "@/components/Settings/ReadingSourcesSettings";
import { usePageTitle } from "@/lib/hooks/usePageTitle";

/** Progress syncing from reading apps (Audiobookshelf, Grimmory): status, Sync now, and the matched books. */
export default function SyncPage() {
  usePageTitle("Sync");

  return (
    <div className="space-y-10">
      <PageHeader title="Sync" subtitle="Progress from your reading apps" icon={RefreshCw} />
      <ReadingSourcesSettings />
    </div>
  );
}
