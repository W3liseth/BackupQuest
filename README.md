# BackupQuest

[English](#english) | [Français](#français)

## English

BackupQuest is a desktop application designed to simplify the backup and restoration of World of Warcraft addons and settings. Built with Electron, it provides a user-friendly interface for managing your WoW backups efficiently.

### Features

- **Easy Backup**: One-click backup of your WoW addons and settings
- **Multiple Storage Options**:
  - Local storage
  - Google Drive integration
- **Scheduled Backups**: Set up automatic backups at your preferred time
- **Version Management**: Keep track of different backup versions
- **Restore Functionality**: Easily restore your addons and settings
- **Cross-Platform**: Works on Windows, macOS, and Linux

### Installation

1. Download the latest release from the releases page
2. Run the installer
3. Follow the installation wizard

### Configuration

1. Launch BackupQuest
2. Set your World of Warcraft installation path
3. Choose your backup storage location (local or Google Drive)
4. Configure backup schedule (optional)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/BackupQuest.git

# Install dependencies
npm install

# Start the development server
npm start

# Build the application for windows
npm build:win
```

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
```

## Français

BackupQuest est une application de bureau conçue pour simplifier la sauvegarde et la restauration des addons et paramètres de World of Warcraft. Développée avec Electron, elle offre une interface conviviale pour gérer efficacement vos sauvegardes WoW.

### Fonctionnalités

- **Sauvegarde Simple** : Sauvegarde en un clic de vos addons et paramètres WoW
- **Options de Stockage Multiples** :
  - Stockage local
  - Intégration Google Drive
- **Sauvegardes Planifiées** : Configurez des sauvegardes automatiques à l'heure de votre choix
- **Gestion des Versions** : Suivez les différentes versions de vos sauvegardes
- **Fonctionnalité de Restauration** : Restaurez facilement vos addons et paramètres
- **Multi-plateforme** : Fonctionne sur Windows, macOS et Linux

### Installation

1. Téléchargez la dernière version depuis la page des releases
2. Exécutez l'installateur
3. Suivez l'assistant d'installation

### Configuration

1. Lancez BackupQuest
2. Définissez le chemin d'installation de World of Warcraft
3. Choisissez votre emplacement de sauvegarde (local ou Google Drive)
4. Configurez la planification des sauvegardes (optionnel)

### Configuration du Développement

```bash
# Cloner le dépôt
git clone https://github.com/yourusername/BackupQuest.git

# Installer les dépendances
npm install

# Démarrer le serveur de développement
npm start

# Construire l'application pour Windows
npm build:win
```

### Variables d'Environnement

Créez un fichier `.env` à la racine du projet avec les variables suivantes :

```
GOOGLE_CLIENT_ID=votre_client_id
GOOGLE_CLIENT_SECRET=votre_client_secret
GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
```

## Fonctionnalités

- Sauvegarde des dossiers Interface et WTF
- Support des versions Retail et Classic
- Sauvegarde locale ou sur Google Drive
- Planification automatique des sauvegardes
- Interface utilisateur moderne et intuitive
- Restauration facile des sauvegardes

## Utilisation

1. Lancez l'application
2. Sélectionnez le dossier d'installation de World of Warcraft
3. Choisissez la version du jeu (Retail ou Classic)
4. Sélectionnez le type de sauvegarde (locale ou Google Drive)
5. Si vous choisissez la sauvegarde locale, sélectionnez le dossier de destination
6. Utilisez le bouton "Sauvegarder maintenant" pour effectuer une sauvegarde manuelle
7. Optionnellement, configurez une sauvegarde automatique dans la section "Planification"

## Sauvegarde sur Google Drive

Pour utiliser la sauvegarde sur Google Drive :

1. Activez l'option "Google Drive" dans les paramètres
2. Suivez les instructions pour autoriser l'application à accéder à votre compte Google
3. Vos sauvegardes seront automatiquement synchronisées avec votre Google Drive

## Licence

GNU GPLv3