import { History, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppConfig, BackupArchive, GameVersion } from "./types";
import { displayVersion, EmptyState, formatBytes, formatDate, PathDisplay } from "./viewShared";

export function RestoreView({
  backups,
  config,
  onChooseRestoreVersion,
  gameVersions,
  onRefresh,
  onRestore,
  onDeleteBackup,
  onSelectBackup,
  deletingBackupPath,
  restoreVersions,
  restoring,
  selectedBackup,
}: {
  backups: BackupArchive[];
  config: AppConfig;
  onChooseRestoreVersion: (versionId: string) => void;
  gameVersions: GameVersion[];
  onRefresh: () => void;
  onRestore: () => void;
  onDeleteBackup: (backup: BackupArchive) => void;
  onSelectBackup: (path: string) => void;
  deletingBackupPath: string;
  restoreVersions: string[];
  restoring: boolean;
  selectedBackup?: BackupArchive;
}) {
  const activeRestoreVersion = restoreVersions[0] ?? gameVersions[0]?.id ?? "";
  const visibleBackups = activeRestoreVersion
    ? backups.filter(
        (backup) =>
          backup.versions.length === 0 || backup.versions.includes(activeRestoreVersion),
      )
    : backups;
  const selectedVisibleBackup =
    selectedBackup &&
    (!activeRestoreVersion ||
      selectedBackup.versions.length === 0 ||
      selectedBackup.versions.includes(activeRestoreVersion))
      ? selectedBackup
      : undefined;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_390px]">
      <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Archives disponibles</h2>
            <p className="mt-1 text-sm text-[#a3a3a3]">
              Choisis une version pour afficher ses backups locaux et Google Drive.
            </p>
          </div>
          <Button variant="outline" onClick={onRefresh} type="button">
            <RefreshCw className="size-4" />
            Actualiser
          </Button>
        </div>

        {gameVersions.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Versions disponibles">
            {gameVersions.map((version) => {
              const active = activeRestoreVersion === version.id;
              const count = backups.filter(
                (backup) =>
                  backup.versions.length === 0 || backup.versions.includes(version.id),
              ).length;

              return (
                <button
                  key={version.id}
                  aria-selected={active}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "border-[#ffffff] bg-[#ffffff] text-[#030303]"
                      : "border-[#2f2f2f] bg-[#111111] text-[#f5f5f5] hover:border-[#6b6b6b]"
                  }`}
                  role="tab"
                  title={version.path}
                  type="button"
                  onClick={() => onChooseRestoreVersion(version.id)}
                >
                  {displayVersion(version.id)}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    active ? "bg-[#030303] text-white" : "bg-[#030303] text-[#d4d4d4]"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-[#2f2f2f] bg-[#111111] p-3 text-sm text-[#a3a3a3]">
            Aucune version WoW detectee. Configure le dossier du jeu dans Backup.
          </div>
        )}

        <div className="mt-5 space-y-3">
          {visibleBackups.length === 0 ? (
            <EmptyState
              icon={History}
              title="Aucune archive"
              detail="Aucun backup disponible pour cette version."
            />
          ) : (
            visibleBackups.map((backup) => (
              <article
                key={backup.path}
                className={`w-full rounded-md border p-4 text-left transition ${
                  selectedBackup?.path === backup.path
                    ? "border-[#ffffff] bg-[#1a1a1a]"
                    : "border-[#2f2f2f] bg-[#111111] hover:border-[#6b6b6b]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    type="button"
                    onClick={() => onSelectBackup(backup.path)}
                  >
                    <p className="break-words font-semibold">{backup.name}</p>
                    <p className="mt-1 text-sm text-[#a3a3a3]">
                      {formatDate(backup.createdAt)} - {formatBytes(backup.sizeBytes)}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-[#030303] px-2 py-1 text-xs text-white">
                      {backup.target === "googleDrive" ? "Google Drive" : backup.status}
                    </span>
                    <button
                      aria-label={`Supprimer ${backup.name}`}
                      className="flex size-8 items-center justify-center rounded-md border border-[#3a2022] bg-[#1a0f10] text-[#ff9f8d] transition hover:bg-[#c2413a] hover:text-white disabled:opacity-60"
                      disabled={deletingBackupPath === backup.path}
                      title="Supprimer"
                      type="button"
                      onClick={() => onDeleteBackup(backup)}
                    >
                      {deletingBackupPath === backup.path ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
                <p className="mt-3 break-words text-xs text-[#a3a3a3]">{backup.path}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {backup.versions.map((version) => (
                    <span
                      key={version}
                      className="rounded-full border border-[#3f3f3f] px-2 py-1 text-xs"
                    >
                      {displayVersion(version)}
                    </span>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <aside className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Restaurer</h2>
        <PathDisplay
          label="Destination WoW"
          path={config.gameDir}
          placeholder="Aucun dossier WoW configure"
        />

        {selectedVisibleBackup ? (
          <div className="mt-5 space-y-4">
            <div>
              <p className="text-sm font-semibold">Archive selectionnee</p>
              <p className="mt-1 break-words text-sm text-[#a3a3a3]">
                {selectedVisibleBackup.name}
              </p>
            </div>
            <div className="rounded-md border border-[#2f2f2f] bg-[#111111] p-3 text-sm text-[#a3a3a3]">
              Version cible: <span className="font-semibold text-[#f5f5f5]">{displayVersion(activeRestoreVersion)}</span>
            </div>
            <Button
              className="h-10 w-full bg-[#c2413a] text-white hover:bg-[#a33632]"
              disabled={!config.gameDir || restoring || gameVersions.length === 0}
              onClick={onRestore}
              type="button"
            >
              {restoring ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Restaurer
            </Button>
          </div>
        ) : (
          <EmptyState
            icon={RotateCcw}
            title="Selection requise"
            detail="Choisis une archive dans la liste."
          />
        )}
      </aside>
    </div>
  );
}
