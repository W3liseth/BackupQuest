import {
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  Loader2,
  Power,
  RefreshCw,
  Rocket,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppConfig, UpdateState, UpdateStatus } from "./types";
import { ToggleOption } from "./viewShared";

export function OptionsView({
  config,
  oauthBusy,
  oauthMessage,
  updateState,
  onCheckForUpdates,
  onConnectGoogle,
  onDisconnectGoogle,
  onInstallUpdate,
  onSetAutoCheckUpdates,
  onSetCloseToTray,
  onSetStartOnLogin,
}: {
  config: AppConfig;
  oauthBusy: boolean;
  oauthMessage: string;
  updateState: UpdateState;
  onCheckForUpdates: () => void;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
  onInstallUpdate: () => void;
  onSetAutoCheckUpdates: (enabled: boolean) => void;
  onSetCloseToTray: (enabled: boolean) => void;
  onSetStartOnLogin: (enabled: boolean) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Application</h2>
        <p className="mt-2 text-sm text-[#a3a3a3]">
          Controle le comportement de BackupQuest avec Windows et la zone de notification.
        </p>
        <div className="mt-4 grid gap-2">
          <ToggleOption
            active={config.startOnLogin}
            icon={Power}
            label="Demarrer avec le systeme"
            onClick={() => onSetStartOnLogin(!config.startOnLogin)}
          />
          <ToggleOption
            active={config.closeToTray}
            icon={X}
            label="Fermer dans le system tray"
            onClick={() => onSetCloseToTray(!config.closeToTray)}
          />
        </div>
      </section>

      <UpdaterPanel
        autoCheckUpdates={config.autoCheckUpdates}
        onCheckForUpdates={onCheckForUpdates}
        onInstallUpdate={onInstallUpdate}
        onSetAutoCheckUpdates={onSetAutoCheckUpdates}
        updateState={updateState}
      />

      <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Authentification Google</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
          <GoogleDrivePanel
            config={config}
            oauthBusy={oauthBusy}
            oauthMessage={oauthMessage}
            onConnectGoogle={onConnectGoogle}
            onDisconnectGoogle={onDisconnectGoogle}
          />
        </div>
      </section>
    </div>
  );
}

function UpdaterPanel({
  autoCheckUpdates,
  updateState,
  onCheckForUpdates,
  onInstallUpdate,
  onSetAutoCheckUpdates,
}: {
  autoCheckUpdates: boolean;
  updateState: UpdateState;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onSetAutoCheckUpdates: (enabled: boolean) => void;
}) {
  const percent = updatePercent(updateState);
  const busy = updateState.status === "checking" || updateState.status === "downloading";
  const hasUpdate = updateState.status === "available";

  return (
    <section className="rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Mises a jour</h2>
          <p className="mt-2 text-sm text-[#a3a3a3]">
            BackupQuest verifie toujours les mises a jour au demarrage et peut continuer a les
            surveiller pendant que l'application reste ouverte.
          </p>
        </div>
        <Rocket className="size-5 shrink-0 text-[#ffffff]" />
      </div>

      <div className="mt-4">
        <ToggleOption
          active={autoCheckUpdates}
          icon={RefreshCw}
          label="Verifier automatiquement"
          onClick={() => onSetAutoCheckUpdates(!autoCheckUpdates)}
        />
      </div>

      <div className="mt-4 rounded-md border border-[#2f2f2f] bg-[#111111] p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {updateState.status === "none" || updateState.status === "installed" ? (
            <CheckCircle2 className="size-4 text-[#86efac]" />
          ) : updateState.status === "checking" || updateState.status === "downloading" ? (
            <Loader2 className="size-4 animate-spin text-[#ffffff]" />
          ) : (
            <RefreshCw className="size-4 text-[#ffffff]" />
          )}
          <span>{statusLabel(updateState.status)}</span>
        </div>
        <p className="mt-2 text-sm text-[#a3a3a3]">{updateState.message}</p>
        {updateState.body && (
          <p className="backupquest-scroll mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-[#050505] p-3 text-xs text-[#c7c7c7]">
            {updateState.body}
          </p>
        )}

        {updateState.status === "downloading" && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-[#a3a3a3]">
              <span>Telechargement</span>
              <span>{updateState.contentLength ? `${percent}%` : "En cours"}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1f1f1f]">
              <div
                className="h-full rounded-full bg-[#ffffff] transition-all duration-300"
                style={{ width: `${updateState.contentLength ? percent : 35}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          className="bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
          disabled={busy}
          onClick={onCheckForUpdates}
          type="button"
        >
          {updateState.status === "checking" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Verifier
        </Button>

        <Button
          className="bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
          disabled={!hasUpdate || busy}
          onClick={onInstallUpdate}
          type="button"
        >
          {updateState.status === "downloading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Installer
        </Button>
      </div>
    </section>
  );
}

function statusLabel(status: UpdateStatus) {
  if (status === "checking") {
    return "Verification";
  }
  if (status === "available") {
    return "Mise a jour disponible";
  }
  if (status === "none") {
    return "A jour";
  }
  if (status === "downloading") {
    return "Installation";
  }
  if (status === "installed") {
    return "Installee";
  }
  if (status === "error") {
    return "Erreur";
  }
  return "Pret";
}

function updatePercent(updateState: UpdateState) {
  if (!updateState.contentLength || updateState.contentLength <= 0) {
    return updateState.status === "installed" ? 100 : 0;
  }
  return Math.max(
    0,
    Math.min(100, Math.round((updateState.downloadedBytes / updateState.contentLength) * 100)),
  );
}

function GoogleDrivePanel({
  config,
  oauthBusy,
  oauthMessage,
  onConnectGoogle,
  onDisconnectGoogle,
}: {
  config: AppConfig;
  oauthBusy: boolean;
  oauthMessage: string;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
}) {
  const connected = Boolean(config.google.accessToken);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-md border border-[#2f2f2f] bg-[#111111] p-3 text-sm">
        {connected ? (
          <Cloud className="size-4 text-[#ffffff]" />
        ) : (
          <CloudOff className="size-4 text-[#b35039]" />
        )}
        <span>{connected ? "connecté" : "non connecté"}</span>
      </div>
      <Button
        className={`w-full ${
          connected
            ? "bg-[#c2413a] text-white hover:bg-[#a33632]"
            : "bg-[#ffffff] text-[#030303] hover:bg-[#e5e5e5]"
        }`}
        disabled={oauthBusy}
        onClick={connected ? onDisconnectGoogle : onConnectGoogle}
        type="button"
      >
        {oauthBusy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : connected ? (
          <CloudOff className="size-4" />
        ) : (
          <Cloud className="size-4" />
        )}
        {connected ? "Se deconnecter" : "Se connecter"}
      </Button>
      {oauthMessage && <p className="text-xs text-[#a3a3a3]">{oauthMessage}</p>}
    </div>
  );
}
