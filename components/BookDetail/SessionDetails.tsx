import { Calendar, Pencil } from "lucide-react";
import { formatDate, getTodayLocalDate } from '@/utils/dateHelpers';
import { Button } from "@/components/Utilities/Button";
import { FORMAT_LABELS } from "@/lib/utils/reading-format";
import { READING_FORMATS } from "@/lib/db/schema/reading-sessions";

interface SessionDetailsProps {
  startedDate: string | null | undefined;
  isEditingStartDate: boolean;
  editStartDate: string;
  onStartEditingDate: () => void;
  onEditStartDateChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveStartDate: () => void;
  /** How this read is being done; changing it saves at once. */
  format?: string | null;
  onFormatChange?: (format: string | null) => void;
}

export default function SessionDetails({
  startedDate,
  isEditingStartDate,
  editStartDate,
  onStartEditingDate,
  onEditStartDateChange,
  onCancelEdit,
  onSaveStartDate,
  format,
  onFormatChange,
}: SessionDetailsProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
    <div className="flex items-center gap-2">
      <Calendar className="w-4 h-4 text-[var(--accent)]" />
      <span className="font-bold text-[var(--accent)]">Started:</span>
      {isEditingStartDate ? (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={editStartDate}
            onChange={(e) => onEditStartDateChange(e.target.value)}
            max={getTodayLocalDate()}
            className="px-2 py-1 border border-[var(--border-color)] rounded bg-[var(--background)] text-[var(--foreground)] text-sm font-medium focus:outline-none focus:outline focus:outline-2 focus:outline-[var(--accent)] focus:outline-offset-2 max-h-[42px] text-left"
          />
          <Button
            onClick={onCancelEdit}
            variant="secondary"
            size="md"
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            onClick={onSaveStartDate}
            variant="primary"
            size="md"
            className="text-xs"
          >
            Save
          </Button>
        </div>
      ) : (
        <button
          onClick={onStartEditingDate}
          className="flex items-center gap-1 group"
          title="Click to edit start date"
        >
          {startedDate ? (
            <span className="font-medium text-[var(--foreground)] group-hover:underline">
              {formatDate(startedDate)}
            </span>
          ) : (
            <span className="italic text-foreground/40 font-medium group-hover:underline">
              Not set
            </span>
          )}
          <Pencil className="w-3.5 h-3.5 text-[var(--subheading-text)]" />
        </button>
      )}
    </div>
    {onFormatChange && (
      <label className="flex items-center gap-2">
        <span className="font-bold text-[var(--accent)]">Format:</span>
        <select
          value={format ?? ""}
          onChange={(e) => onFormatChange(e.target.value || null)}
          className="px-2 py-1 border border-[var(--border-color)] rounded bg-[var(--background)] text-[var(--foreground)] text-sm font-medium"
        >
          <option value="">Not set</option>
          {READING_FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
    )}
    </div>
  );
}
