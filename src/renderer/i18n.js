const translations = {
    fr: {
        // Configuration
        configuration: 'Configuration',
        backupPath: 'Chemin de sauvegarde',
        browse: 'Parcourir',
        wowPath: 'Chemin de World of Warcraft',
        backupSettings: 'Paramètres de sauvegarde',
        enableSchedule: 'Activer la planification',
        scheduleSettings: 'Paramètres de planification',
        frequency: 'Fréquence',
        daily: 'Quotidien',
        weekly: 'Hebdomadaire',
        time: 'Heure',
        day: 'Jour',
        monday: 'Lundi',
        tuesday: 'Mardi',
        wednesday: 'Mercredi',
        thursday: 'Jeudi',
        friday: 'Vendredi',
        saturday: 'Samedi',
        sunday: 'Dimanche',

        // Sauvegarde
        backup: 'Sauvegarde',
        backupNow: 'Sauvegarder maintenant',
        restoreBackup: 'Restaurer une sauvegarde',
        manageBackups: 'Gestion des sauvegardes',
        backupList: 'Liste des sauvegardes',
        status: 'Statut',
        ready: 'Prêt',

        // Options
        options: 'Options',
        launch: 'Lancement',
        autoLaunch: 'Lancer BackupQuest au démarrage de l\'ordinateur',
        minimizeToTray: 'Minimiser dans le tray à la fermeture',
        backups: 'Sauvegardes',
        limitBackups: 'Limiter le nombre de sauvegardes à conserver',
        logoutGoogle: 'Se déconnecter de Google Drive',
        language: 'Langue',
        french: 'Français',
        english: 'Anglais',
        gameVersion: 'Version du jeu',
        backupType: 'Type de sauvegarde',
        selectBackup: 'Sélectionner une sauvegarde'
    },
    en: {
        // Configuration
        configuration: 'Configuration',
        backupPath: 'Backup Path',
        browse: 'Browse',
        wowPath: 'World of Warcraft Path',
        backupSettings: 'Backup Settings',
        enableSchedule: 'Enable Scheduling',
        scheduleSettings: 'Schedule Settings',
        frequency: 'Frequency',
        daily: 'Daily',
        weekly: 'Weekly',
        time: 'Time',
        day: 'Day',
        monday: 'Monday',
        tuesday: 'Tuesday',
        wednesday: 'Wednesday',
        thursday: 'Thursday',
        friday: 'Friday',
        saturday: 'Saturday',
        sunday: 'Sunday',

        // Backup
        backup: 'Backup',
        backupNow: 'Backup Now',
        restoreBackup: 'Restore Backup',
        manageBackups: 'Manage Backups',
        backupList: 'Backup List',
        status: 'Status',
        ready: 'Ready',

        // Options
        options: 'Options',
        launch: 'Launch',
        autoLaunch: 'Launch BackupQuest at computer startup',
        minimizeToTray: 'Minimize to tray when closing',
        backups: 'Backups',
        limitBackups: 'Limit number of backups to keep',
        logoutGoogle: 'Logout from Google Drive',
        language: 'Language',
        french: 'French',
        english: 'English',
        gameVersion: 'Game Version',
        backupType: 'Backup Type',
        selectBackup: 'Select a Backup'
    }
};

let currentLanguage = 'fr';

function setLanguage(lang) {
    if (translations[lang]) {
        currentLanguage = lang;
        updateUI();
    }
}

function getTranslation(key) {
    return translations[currentLanguage][key] || key;
}

function updateUI() {
    // Mettre à jour tous les éléments avec l'attribut data-i18n
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        element.textContent = getTranslation(key);
    });

    // Mettre à jour les placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        element.placeholder = getTranslation(key);
    });

    // Mettre à jour les titres
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
        const key = element.getAttribute('data-i18n-title');
        element.title = getTranslation(key);
    });
}

module.exports = {
    setLanguage,
    getTranslation,
    updateUI,
    currentLanguage
}; 