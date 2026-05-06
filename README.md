<p align="center">
  <img src="src-tauri/icons/icon.png" alt="BackupQuest" width="128" />
</p>

<h1 align="center">BackupQuest</h1>

<p align="center">
  Application desktop moderne pour sauvegarder et restaurer les dossiers World of Warcraft
  <strong>Interface</strong>, <strong>WTF</strong> et <strong>Fonts</strong>.
</p>

<p align="center">
  <strong>Rust</strong> + <strong>Tauri</strong> + <strong>React</strong> + <strong>Vite</strong> + <strong>TypeScript</strong> + <strong>Tailwind CSS</strong> + <strong>shadcn/ui</strong>
</p>

---

## Apercu

BackupQuest permet de proteger facilement la configuration de World of Warcraft : addons, profils, macros, reglages d'interface et polices personnalisees. L'application detecte automatiquement le dossier du jeu, liste les versions disponibles, puis permet de sauvegarder en local, sur Google Drive, ou les deux.

Elle est pensee pour un usage quotidien : sauvegarde manuelle, sauvegarde automatique configurable, restauration par version, barre de progression, nettoyage preventif des archives incompletes et integration au system tray.

## Fonctionnalites

- Detection automatique du dossier World of Warcraft.
- Selection manuelle du dossier du jeu, modifiable a tout moment.
- Detection des versions disponibles : Retail, Classic, PTR, Beta, etc.
- Sauvegardes separees par version du jeu.
- Sauvegarde des dossiers `Interface`, `WTF` et `Fonts` lorsque `Fonts` est present.
- Indicateurs dynamiques pour la disponibilite des dossiers surveilles.
- Supervision instantanee des changements sur les dossiers du jeu.
- Sauvegarde locale, Google Drive, ou les deux.
- Creation automatique du dossier Google Drive `BackupQuest`.
- Connexion Google via OAuth2 dans le navigateur.
- Sauvegarde manuelle avec barre de progression.
- Sauvegarde automatique journaliere ou hebdomadaire.
- Selection de l'heure et des minutes via menus deroulants.
- Report automatique d'une sauvegarde planifiee si World of Warcraft est lance.
- Notifications systeme au debut et a la fin des sauvegardes.
- Retention configurable : conserver uniquement les derniers backups.
- Suppression automatique des sauvegardes incompletes.
- Restauration avec onglets par version du jeu.
- Suppression d'un backup depuis la section restauration.
- Barre de progression pendant la restauration.
- Demarrage avec le systeme.
- Fermeture dans le system tray.
- Interface sombre avec barre de titre personnalisee.

## Interface

BackupQuest est organise autour d'un menu lateral clair :

- `Dashboard` : resume de l'etat de l'application, activite recente et derniers backups.
- `Backup` : configuration des versions, destinations, retention et sauvegardes automatiques.
- `Restauration` : archives disponibles par version, restauration et suppression.
- `Options` : connexion Google Drive, demarrage systeme et comportement du system tray.

## Prerequis

- Windows 10 ou Windows 11.
- Node.js et npm.
- Rust stable.
- Microsoft Edge WebView2 Runtime.
- Un projet Google Cloud avec OAuth2 active, uniquement si la sauvegarde Google Drive est utilisee.

## Installation

```powershell
npm install
```

## Configuration Google Drive

Les identifiants OAuth2 Google sont lus depuis un fichier `.env` et injectes au moment de la compilation.

1. Copier le fichier d'exemple :

```powershell
Copy-Item .env.example .env
```

2. Renseigner les valeurs :

```env
BACKUPQUEST_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
BACKUPQUEST_GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

3. Relancer le build ou le serveur Tauri apres modification du fichier `.env`.

La connexion Google s'effectue ensuite depuis `Options`. Le bouton ouvre le navigateur pour autoriser BackupQuest a utiliser Google Drive. Une fois connecte, le bouton devient `Se deconnecter`.

## Lancement en developpement

```powershell
npm run tauri dev
```

## Build de production

```powershell
npm run tauri build
```

Les installateurs generes se trouvent ensuite dans :

```text
src-tauri/target/release/bundle/
```

Selon la configuration Tauri, vous pouvez y retrouver un installeur `msi`, `nsis`, ou les deux.

## Structure des sauvegardes

BackupQuest cree un dossier de sauvegarde par version du jeu afin d'eviter de melanger les archives.

Exemple local :

```text
BackupQuest/
  _retail_/
    BackupQuest_20260506_213000_retail.zip
  _classic_/
    BackupQuest_20260506_214500_classic.zip
```

Exemple Google Drive :

```text
BackupQuest/
  _retail_/
  _classic_/
  _classic_era_/
```

Chaque archive contient les dossiers disponibles pour la version concernee :

```text
Interface/
WTF/
Fonts/
```

Le dossier `Fonts` est optionnel. S'il n'existe pas, BackupQuest peut tout de meme effectuer la sauvegarde avec `Interface` et `WTF`.

## Sauvegarde automatique

La sauvegarde automatique se configure depuis la section `Backup`.

Deux frequences sont disponibles :

- `Journalier` : choix de l'heure et des minutes.
- `Hebdomadaire` : choix des jours, de l'heure et des minutes.

Si une version de World of Warcraft est en cours d'execution au moment prevu, BackupQuest reporte la sauvegarde jusqu'a la fermeture du jeu. Si le jeu est relance immediatement, la sauvegarde reportee est annulee et attendra la prochaine fermeture.

## Retention et securite

BackupQuest peut limiter le nombre de backups conserves par version et par destination.

Par exemple, si la retention est reglee sur `5`, l'application conserve les cinq sauvegardes les plus recentes et supprime les plus anciennes lorsqu'une sixieme archive est creee.

Pour reduire le risque de corruption, les archives en cours de creation utilisent un etat temporaire. Les sauvegardes inachevees ou incompletes sont nettoyees automatiquement au demarrage et avant les operations sensibles.

## Restauration

La section `Restauration` affiche des onglets pour chaque version detectee du jeu. Chaque onglet liste uniquement les sauvegardes de cette version.

Depuis cette section, il est possible de :

- selectionner une archive ;
- restaurer les dossiers sauvegardes ;
- suivre la progression de la restauration ;
- supprimer un backup inutile.

## Structure du projet

```text
.
  src/                 Frontend React, TypeScript, Tailwind et shadcn/ui
  src/components/      Composants d'interface
  src-tauri/           Backend Rust et configuration Tauri
  src-tauri/icons/     Icones de l'application
  .env.example         Exemple de configuration OAuth2 Google
```

## Scripts utiles

```powershell
npm run dev
npm run build
npm run preview
npm run tauri dev
npm run tauri build
```

## Depannage

### Google Drive retourne une erreur 401

Reconnecter le compte Google depuis `Options`. Si le probleme persiste, verifier les valeurs du fichier `.env`, puis relancer le build.

### Aucune version du jeu n'est detectee

Utiliser la selection manuelle du dossier World of Warcraft depuis la section `Backup`, puis verifier que les dossiers de version comme `_retail_` ou `_classic_` existent.

### Les notifications n'affichent pas BackupQuest

Utiliser de preference l'application installee via le build Tauri. Windows associe mieux le nom et l'icone de l'application lorsqu'elle est installee.

### Une sauvegarde automatique ne se lance pas

Verifier que BackupQuest est ouvert ou present dans le system tray, que la sauvegarde automatique est activee et que World of Warcraft n'est pas encore en cours d'execution.

## Licence

Projet personnel BackupQuest.
