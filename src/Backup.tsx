import { Archive, Cloud, FolderOpen, HardDrive, Loader2, Play, Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutoBackupSettings } from "./AutoBackupSettings";
import type { AppConfig, CandidateGameDir, GameVersion, WowProcessStatus } from "./types";
import { EmptyState, formatBytes, PathDisplay, StatusPill, ToggleOption } from "./viewShared";

export function BackupView({
  candidates,
  config,
  onChooseBackupDir,
  onChooseGameDir,
  onRefreshBackups,
  onRunBackup,
  onScan,
  onSelectCandidate,
  onSetCronEnabled,
  onSetCronExpression,
  onSetBackupCloud,
  onSetBackupLocal,
  onSetBackupRetention,
  onToggleVersion,
  runningBackup,
  scanning,
  versions,
  wowProcessStatus,
}: {
  candidates: CandidateGameDir[];
  config: AppConfig;
  onChooseBackupDir: () => void;
  onChooseGameDir: () => void;
  onRefreshBackups: () => void;
  onRunBackup: () => void;
  onScan: () => void;
  onSelectCandidate: (candidate: CandidateGameDir) => void;
  onSetCronEnabled: (enabled: boolean) => void;
  onSetCronExpression: (value: string) => void;
  onSetBackupCloud: (enabled: boolean) => void;
  onSetBackupLocal: (enabled: boolean) => void;
  onSetBackupRetention: (value: number) => void;
  onToggleVersion: (versionId: string) => void;
  runningBackup: boolean;
  scanning: boolean;
  versions: GameVersion[];
  wowProcessStatus: WowProcessStatus;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_390px]">
      <div className="space-y-6">
        <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Dossier World of Warcraft</h2>
              <p className="mt-1 text-sm text-[#a3a3a3]">
                Detection automatique avec selection manuelle disponible a tout moment.
              </p>
            </div>
            <div className="flex gap-2">
              <Button disabled={scanning} variant="outline" onClick={onScan} type="button">
                {scanning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Detecter
              </Button>
              <Button variant="outline" onClick={onChooseGameDir} type="button">
                <FolderOpen className="size-4" />
                Choisir
              </Button>
            </div>
          </div>

          <PathDisplay
            label="Dossier actuel"
            path={config.gameDir}
            placeholder="Aucun dossier WoW selectionne"
          />

          <div
            className={`mt-4 flex items-start gap-3 rounded-md border p-3 ${
              wowProcessStatus.running
                ? "border-[#92400e] bg-[#3b2608] text-[#fbbf24]"
                : "border-[#1f7a3d] bg-[#143d24] text-[#86efac]"
            }`}
          >
            <Radio className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {wowProcessStatus.running
                  ? "World of Warcraft est lance"
                  : "World of Warcraft est ferme"}
              </p>
              <p className="mt-1 break-words text-xs opacity-85">
                {wowProcessStatus.running
                  ? wowProcessLabel(wowProcessStatus)
                  : "Les sauvegardes automatiques peuvent demarrer normalement."}
              </p>
            </div>
          </div>

          {candidates.length > 0 && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {candidates.map((candidate) => (
                <button
                  key={candidate.path}
                  className={`rounded-md border p-3 text-left transition ${
                    config.gameDir === candidate.path
                      ? "border-[#ffffff] bg-[#1a1a1a]"
                      : "border-[#2f2f2f] bg-[#111111] hover:border-[#6b6b6b]"
                  }`}
                  type="button"
                  onClick={() => onSelectCandidate(candidate)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{candidate.source}</p>
                    <span className="rounded-full bg-[#030303] px-2 py-0.5 text-xs text-white">
                      {candidate.versionsCount}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-xs text-[#a3a3a3]">
                    {candidate.path}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Versions a sauvegarder</h2>
              <p className="mt-1 text-sm text-[#a3a3a3]">
                Chaque version embarque uniquement ses dossiers Interface et WTF.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {versions.length === 0 ? (
              <EmptyState
                icon={Archive}
                title="Aucune version"
                detail="Configure d'abord le dossier WoW."
              />
            ) : (
              versions.map((version) => (
                <label
                  key={version.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition ${
                    config.selectedVersions.includes(version.id)
                      ? "border-[#ffffff] bg-[#1a1a1a]"
                      : "border-[#2f2f2f] bg-[#111111] hover:border-[#6b6b6b]"
                  }`}
                >
                  <input
                    checked={config.selectedVersions.includes(version.id)}
                    className="mt-1 size-4 accent-[#ffffff]"
                    type="checkbox"
                    onChange={() => onToggleVersion(version.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{version.name}</p>
                      <p className="text-xs text-[#a3a3a3]">{formatBytes(version.sizeBytes)}</p>
                    </div>
                    <p className="mt-1 break-words text-xs text-[#a3a3a3]">{version.path}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusPill active={version.hasInterface} label="Interface" />
                      <StatusPill active={version.hasWtf} label="WTF" />
                      <StatusPill active={version.hasFonts} label="Fonts" optional />
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>
        </section>
      </div>

      <aside className="space-y-6">
        <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Destination</h2>
          <div className="mt-4 grid gap-2">
            <ToggleOption
              active={config.backupLocal}
              icon={HardDrive}
              label="Backup local"
              onClick={() => onSetBackupLocal(!config.backupLocal)}
            />
            <ToggleOption
              active={config.backupCloud}
              icon={Cloud}
              label="Backup Google Drive"
              onClick={() => onSetBackupCloud(!config.backupCloud)}
            />
          </div>

          {config.backupLocal && (
            <div className="mt-4">
              <PathDisplay
                label="Dossier de backup"
                path={config.localBackupDir}
                placeholder="Destination locale non configuree"
              />
              <div className="mt-3 flex gap-2">
                <Button variant="outline" onClick={onChooseBackupDir} type="button">
                  <FolderOpen className="size-4" />
                  Choisir
                </Button>
                <Button variant="outline" onClick={onRefreshBackups} type="button">
                  <RefreshCw className="size-4" />
                  Archives
                </Button>
              </div>
            </div>
          )}

          <div className="mt-5 rounded-md border border-[#2f2f2f] bg-[#111111] p-3">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a3a3a3]">
              Backups a conserver
            </label>
            <div className="mt-3 flex items-center gap-3">
              <input
                className="h-10 w-24 rounded-md border border-[#3a3a3a] bg-[#050505] px-3 text-sm font-semibold text-[#f5f5f5] outline-none transition focus:border-[#ffffff]"
                max={99}
                min={1}
                type="number"
                value={config.backupRetention}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  onSetBackupRetention(
                    Number.isFinite(value) ? Math.max(1, Math.min(99, Math.round(value))) : 1,
                  );
                }}
              />
              <p className="text-sm text-[#a3a3a3]">
                Les archives les plus anciennes seront supprimees automatiquement.
              </p>
            </div>
          </div>
        </section>

        <AutoBackupSettings
          config={config}
          onSetCronEnabled={onSetCronEnabled}
          onSetCronExpression={onSetCronExpression}
        />

        <Button
          className="h-11 w-full bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
          disabled={runningBackup}
          onClick={onRunBackup}
          type="button"
        >
          {runningBackup ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          Backup manuel
        </Button>
      </aside>
    </div>
  );
}

function wowProcessLabel(status: WowProcessStatus) {
  const labels = status.processes
    .map((process) => process.versionName || process.name)
    .filter(Boolean);

  if (labels.length === 0) {
    return "Un client WoW est en cours d'execution. Les sauvegardes automatiques seront reportees.";
  }

  return `${labels.join(", ")} en cours. Les sauvegardes automatiques seront reportees.`;
}
