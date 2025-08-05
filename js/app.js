import { SendComponent } from './components/SendComponent.js';
import { ReceiveComponent } from './components/ReceiveComponent.js';
import { storageAvailable } from './modules/storage.js';

const app = Vue.createApp({
  data() {
    return {
      activeTab: 'send',
      darkMode: false,
      showToast: false,
      toastMessage: ''
    };
  },
  mounted() {
    // Check for saved theme preference
    if (storageAvailable('localStorage')) {
      const savedTheme = localStorage.getItem('darkMode');
      if (savedTheme !== null) {
        this.darkMode = savedTheme === 'true';
      } else {
        // Use system preference as default if available
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          this.darkMode = true;
        }
      }
      this.applyTheme();
    }
  },
  methods: {
    switchTab(tab) {
      this.activeTab = tab;
    },
    toggleTheme() {
      this.darkMode = !this.darkMode;
      if (storageAvailable('localStorage')) {
        localStorage.setItem('darkMode', this.darkMode);
      }
      this.applyTheme();
    },
    applyTheme() {
      if (this.darkMode) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
    },
    shareApp() {
      const shareData = {
        title: 'QRBitr - QR Bit Data Transfer',
        text: 'Send and receive data via QR codes with QRBitr!',
        url: window.location.href
      };
      if (navigator.share) {
        navigator.share(shareData)
          .then(() => {
            // Optionally show a toast
            this.showToastMsg('Shared successfully!');
          })
          .catch((err) => {
            console.error('Error sharing:', err);
            if (err.name !== 'AbortError') {
              this.fallbackShare();
            }
          });
      } else {
        this.fallbackShare();
      }
    },
    fallbackShare() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(window.location.href)
          .then(() => {
            this.showToastMsg('URL copied to clipboard! Share it with your friends.');
          })
          .catch(err => {
            console.error('Clipboard API failed:', err);
            this.fallbackCopyUsingExecCommand();
          });
      } else {
        this.fallbackCopyUsingExecCommand();
      }
    },
    fallbackCopyUsingExecCommand() {
      try {
        const dummy = document.createElement('textarea');
        dummy.style.position = 'fixed';
        dummy.style.top = '0';
        dummy.style.left = '0';
        dummy.style.width = '1px';
        dummy.style.height = '1px';
        dummy.style.opacity = '0';
        dummy.value = window.location.href;
        document.body.appendChild(dummy);
        dummy.style.visibility = 'visible';
        dummy.focus();
        dummy.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(dummy);
        if (successful) {
          this.showToastMsg('URL copied to clipboard! Share it with your friends.');
        } else {
          this.showManualShareInstructions();
        }
      } catch (err) {
        console.error('execCommand error:', err);
        this.showManualShareInstructions();
      }
    },
    showManualShareInstructions() {
      // Simple modal for manual copy
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]';
      const shareUrl = window.location.href;
      modal.innerHTML = `
        <div class="bg-white p-4 rounded-lg w-11/12 max-w-md">
          <h3 class="text-lg font-bold mb-2">Share QRBitr</h3>
          <p class="mb-2">Copy this URL to share:</p>
          <div class="relative mb-4">
            <input type="text" readonly value="${shareUrl}" 
                   class="bg-gray-100 p-2 pr-16 rounded w-full border border-gray-300 select-all" 
                   onclick="this.select()">
            <button id="copy-btn" class="absolute right-1 top-1 bg-blue-500 text-white px-2 py-1 rounded text-sm">
              Copy
            </button>
          </div>
          <button class="bg-green-500 text-white px-4 py-2 rounded w-full" id="close-modal">
            Close
          </button>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector('#close-modal').onclick = () => document.body.removeChild(modal);
      modal.querySelector('#copy-btn').onclick = () => {
        const input = modal.querySelector('input');
        input.select();
        document.execCommand('copy');
        this.showToastMsg('URL copied to clipboard!');
      };
    },
    showToastMsg(msg) {
      this.toastMessage = msg;
      this.showToast = true;
      setTimeout(() => { this.showToast = false; }, 2000);
    }
  },
  components: {
    // Register inline HowToComponent
    'howto-component': {
      template: `
        <div class="howto-component p-4 bg-white dark:bg-gray-800 rounded shadow-sm">
          <h2 class="text-xl font-bold mb-3">How to use QRBitr</h2>
            <li>
              <b>Send:</b> Enter your text or data in the "Send" tab. Adjust advanced options if needed. A QR code will be generated.
            </li>
            <li>
              <b>Receive:</b> Go to the "Receive" tab and scan the QR code using your camera or upload an image.
            </li>
            <li>
              For large data, multiple QR codes will be generated and can be scanned in sequence.
            </li>
            <li>
              Use the <b>Share</b> button (top right) to share this app with others.
            </li>
            <li>
              Toggle <b>dark mode</b> with the moon/sun button.
            </li>
            <li>
              <b>Add to Home Screen:</b> For quick access, add QRBitr to your home screen as an app (look for "Add to Home Screen" in your browser menu).
            </li>
          <p class="text-sm opacity-70">Tip: No data is sent to any server. Everything runs locally in your browser.</p>
        </div>
      `
    }
  },
  template: `
    <div class="container mx-auto px-4 py-8 max-w-md">
      <header class="mb-6">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold">QRBitr - xferData</h1>
          </div>
          <div class="flex items-center gap-2">
            <button @click="toggleTheme" class="theme-toggle" aria-label="Toggle theme">
              <svg v-if="darkMode" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"></circle>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            </button>
            <button @click="shareApp" class="theme-toggle" aria-label="Share app">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <nav class="tabs mb-6 flex gap-2 px-1 sm:px-0">
        <button 
          @click="switchTab('send')" 
          :class="['tab-button', { active: activeTab === 'send' }]"
          :style="activeTab === 'send' ? 'background:#2563eb;color:#fff;font-weight:600;' : ''"
        >
          Send
        </button>
        <button 
          @click="switchTab('receive')" 
          :class="['tab-button', { active: activeTab === 'receive' }]"
          :style="activeTab === 'receive' ? 'background:#2563eb;color:#fff;font-weight:600;' : ''"
        >
          Receive
        </button>
        <button 
          @click="switchTab('howto')" 
          :class="['tab-button', { active: activeTab === 'howto' }]"
          :style="activeTab === 'howto' ? 'background:#2563eb;color:#fff;font-weight:600;' : ''"
        >
          How To
        </button>
      </nav>

      <main class="mb-6 px-1 sm:px-0">
        <send-component v-if="activeTab === 'send'"></send-component>
        <receive-component v-else-if="activeTab === 'receive'"></receive-component>
        <howto-component v-else></howto-component>
      </main>

      <footer class="text-center mt-10 pb-6 opacity-80">
        <p class="mb-0 text-sm flex flex-col sm:flex-row items-center justify-center gap-2">
          qrbitr © 2025 |
          <a href="https://github.com/austinwin/qrbitr" target="_blank" rel="noopener" class="hover:underline ml-1">GitHub</a>
          <span class="hidden sm:inline mx-1">|</span>
        </p>
        <p class="text-xs mt-1 opacity-60">
          If you find QRBitr useful, you can support its development
          <a href="https://buymeacoffee.com/austinwin" target="_blank" rel="noopener" class="text-amber-600 underline ml-1">on Buy Me a Coffee</a> ❤️
        </p>
      </footer>

      <transition name="fade">
        <div v-if="showToast" class="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-black text-white px-4 py-2 rounded shadow-lg z-50">
          {{ toastMessage }}
        </div>
      </transition>
    </div>
  `
});

// Register components
app.component('send-component', SendComponent);
app.component('receive-component', ReceiveComponent);

// Mount app
app.mount('#app');