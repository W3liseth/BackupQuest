// Nouveau composant pour la gestion des mises à jour Electron
const { ipcRenderer } = require('electron');

class UpdateModal {
  constructor() {
    this.modal = null;
    this.createModal();
    this.registerIpcEvents();
  }

  createModal() {
    this.modal = document.createElement('div');
    this.modal.id = 'update-modal';
    this.modal.style.display = 'none';
    this.modal.innerHTML = `
      <div class="update-modal-content">
        <h2>Mise à jour disponible</h2>
        <p id="update-message">Recherche de mises à jour...</p>
        <div id="update-progress" style="display:none;">
          <progress id="update-progress-bar" value="0" max="100"></progress>
          <span id="update-progress-text"></span>
        </div>
        <div id="update-actions">
          <button id="check-update-btn">Vérifier les mises à jour</button>
          <button id="download-update-btn" style="display:none;">Télécharger la mise à jour</button>
          <button id="install-update-btn" style="display:none;">Redémarrer et installer</button>
          <button id="close-update-btn">Fermer</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    this.addEventListeners();
  }

  addEventListeners() {
    this.modal.querySelector('#close-update-btn').onclick = () => {
      this.hide();
    };
    this.modal.querySelector('#check-update-btn').onclick = () => {
      ipcRenderer.invoke('check-for-update');
      this.setMessage('Recherche de mises à jour...');
    };
    this.modal.querySelector('#download-update-btn').onclick = () => {
      ipcRenderer.invoke('download-update');
      this.setMessage('Téléchargement de la mise à jour...');
      this.showProgress();
    };
    this.modal.querySelector('#install-update-btn').onclick = () => {
      ipcRenderer.invoke('quit-and-install');
    };
  }

  registerIpcEvents() {
    ipcRenderer.on('update-message', (event, message) => {
      this.setMessage(message);
      this.hideProgress();
      this.show();
    });
    ipcRenderer.on('update-available', (event, info) => {
      this.setMessage('Nouvelle version disponible : ' + info.version);
      this.modal.querySelector('#download-update-btn').style.display = 'inline-block';
      this.modal.querySelector('#check-update-btn').style.display = 'none';
      this.show();
    });
    ipcRenderer.on('update-not-available', () => {
      this.setMessage('Aucune mise à jour disponible.');
      this.modal.querySelector('#download-update-btn').style.display = 'none';
      this.modal.querySelector('#check-update-btn').style.display = 'inline-block';
      this.hideProgress();
      this.show();
    });
    ipcRenderer.on('update-download-progress', (event, progress) => {
      this.showProgress();
      const percent = Math.round(progress.percent);
      this.modal.querySelector('#update-progress-bar').value = percent;
      this.modal.querySelector('#update-progress-text').textContent = percent + '%';
    });
    ipcRenderer.on('update-downloaded', () => {
      this.setMessage('Mise à jour téléchargée. Cliquez pour redémarrer et installer.');
      this.modal.querySelector('#install-update-btn').style.display = 'inline-block';
      this.modal.querySelector('#download-update-btn').style.display = 'none';
      this.hideProgress();
      this.show();
    });
  }

  setMessage(msg) {
    this.modal.querySelector('#update-message').textContent = msg;
  }

  showProgress() {
    this.modal.querySelector('#update-progress').style.display = 'block';
  }

  hideProgress() {
    this.modal.querySelector('#update-progress').style.display = 'none';
  }

  show() {
    this.modal.style.display = 'flex';
  }

  hide() {
    this.modal.style.display = 'none';
  }
}

module.exports = UpdateModal; 