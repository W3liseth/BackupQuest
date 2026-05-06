import { Cloud, CloudOff, Loader2, Power, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppConfig } from "./types";
import { ToggleOption } from "./viewShared";

export function OptionsView({
  config,
  oauthBusy,
  oauthMessage,
  onConnectGoogle,
  onDisconnectGoogle,
  onSetCloseToTray,
  onSetStartOnLogin,
}: {
  config: AppConfig;
  oauthBusy: boolean;
  oauthMessage: string;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
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
