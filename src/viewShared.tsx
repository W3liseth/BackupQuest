import { Check, type LucideIcon, X, AlertCircle } from "lucide-react";
import type { AppConfig } from "./types";

export function StatusPill({
  active,
  label,
  optional = false,
}: {
  active: boolean;
  label: string;
  optional?: boolean;
}) {
  const Icon = active ? Check : optional ? AlertCircle : X;
  const statusClass = active
    ? "border-[#1f7a3d] bg-[#143d24] text-[#86efac]"
    : optional
      ? "border-[#92400e] bg-[#3b2608] text-[#fbbf24]"
      : "border-[#7f1d1d] bg-[#3a1414] text-[#fca5a5]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium ${statusClass}`}
    >
      <Icon className="size-3.5" />
      {label}{optional && !active ? " (optionnel)" : ""}
    </span>
  );
}

export function ToggleOption({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-h-12 items-center justify-between gap-4 rounded-md border px-3 py-2 text-left text-sm font-medium transition ${
        active
          ? "border-[#ffffff] bg-[#1a1a1a] text-[#f5f5f5]"
          : "border-[#2f2f2f] bg-[#111111] text-[#a3a3a3] hover:bg-[#1f1f1f]"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-4" />
        <span className="truncate">{label}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          active ? "bg-[#ffffff]" : "bg-[#3a3a3a]"
        }`}
      >
        <span
          className={`absolute top-1 size-5 rounded-full bg-[#111111] shadow transition ${
            active ? "left-6" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}

export function PathDisplay({
  label,
  path,
  placeholder,
}: {
  label: string;
  path?: string | null;
  placeholder: string;
}) {
  return (
    <div className="mt-4 rounded-md border border-[#2f2f2f] bg-[#111111] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8a8a8a]">
        {label}
      </p>
      <p className="mt-2 break-words text-sm text-[#f5f5f5]">
        {path || placeholder}
      </p>
    </div>
  );
}

export function EmptyState({
  detail,
  icon: Icon,
  title,
}: {
  detail: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-[#3f3f3f] bg-[#111111]/70 p-5 text-center">
      <Icon className="mx-auto size-5 text-[#8a8a8a]" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[#a3a3a3]">{detail}</p>
    </div>
  );
}

export function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function displayVersion(version: string) {
  const clean = version.replace(/^_+|_+$/g, "").replace(/_/g, " ");
  if (!clean) {
    return version;
  }
  return clean
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function destinationLabel(config: AppConfig) {
  if (config.backupLocal && config.backupCloud) {
    return "Local + Google Drive";
  }
  if (config.backupCloud) {
    return "Google Drive";
  }
  if (config.backupLocal) {
    return "Backup local";
  }
  return "Aucune destination";
}

export function scheduleSummary(expression: string) {
  const fields = expression.trim().split(/\s+/);
  const hour = Number(fields[1]);
  const dayOfWeek = fields[4] ?? "*";
  const safeHour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 20;
  const formattedHour = `${String(safeHour).padStart(2, "0")}:00`;

  if (dayOfWeek === "*") {
    return `Tous les jours à ${formattedHour}`;
  }

  const days = dayOfWeek
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  if (days.length === 0) {
    return `Chaque lundi à ${formattedHour}`;
  }

  const labels = [
    { label: "Lun", value: 1 },
    { label: "Mar", value: 2 },
    { label: "Mer", value: 3 },
    { label: "Jeu", value: 4 },
    { label: "Ven", value: 5 },
    { label: "Sam", value: 6 },
    { label: "Dim", value: 0 },
  ]
    .filter((day) => days.includes(day.value))
    .map((day) => day.label);

  return `${labels.join(", ")} à ${formattedHour}`;
}
