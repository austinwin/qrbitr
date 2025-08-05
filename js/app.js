import { SendComponent } from './components/SendComponent.js';
import { ReceiveComponent } from './components/ReceiveComponent.js';
import { storageAvailable } from './modules/storage.js';

const app = Vue.createApp({
  data() {
    return {
      activeTab: 'send',
      darkMode: false
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
    }
  },
  template: `
    <div class="container mx-auto px-4 py-8 max-w-md">
      <header class="mb-6">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold">QR Bitr</h1>
          <button @click="toggleTheme" class="theme-toggle" aria-label="Toggle theme">
            <svg v-if="darkMode" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"></circle>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>
        </div>
      </header>

      <nav class="tabs mb-6">
        <button 
          @click="switchTab('send')" 
          :class="['tab-button', { active: activeTab === 'send' }]">
          Send
        </button>
        <button 
          @click="switchTab('receive')" 
          :class="['tab-button', { active: activeTab === 'receive' }]">
          Receive
        </button>
      </nav>

      <main class="mb-6">
        <send-component v-if="activeTab === 'send'"></send-component>
        <receive-component v-else></receive-component>
      </main>

      <footer class="text-center text-sm mt-8 opacity-70">
        <p>qrbitr © 2025 | <a href="https://github.com/austinwin/qrbitr" target="_blank" rel="noopener">GitHub</a></p>
      </footer>
    </div>
  `
});

// Register components
app.component('send-component', SendComponent);
app.component('receive-component', ReceiveComponent);

// Mount app
app.mount('#app');