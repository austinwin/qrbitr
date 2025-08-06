import { encodeData } from '../modules/encode.js';
import { saveSession } from '../modules/storage.js';
import { debounce } from '../utils.js';

// Check if QRCode library exists and load it if needed
const ensureQRCodeLibrary = () => new Promise((resolve, reject) => {
  const ready = () => {
    return typeof window !== 'undefined' && 
           typeof window.QRCode === 'function';
  };
  
  // If library is already loaded, resolve immediately
  if (ready()) return resolve();
  
  let checkAttempts = 0;
  const maxAttempts = 10;
  
  const checkQRCode = () => {
    checkAttempts++;
    if (ready()) {
      resolve();
    } else if (checkAttempts < maxAttempts) {
      // Try again in 100ms
      setTimeout(checkQRCode, 100);
    } else {
      reject(new Error('QRCode.js loaded but constructor not found after multiple attempts'));
    }
  };
  
  const s = document.createElement('script');
  s.src = 'js/qrcode.min.js';
  s.async = true;
  s.onload = () => setTimeout(checkQRCode, 100); // Delay check after load
  s.onerror = () => reject(new Error('Failed to load js/qrcode.min.js'));
  document.head.appendChild(s);
  
  // Add timeout to prevent hanging
  setTimeout(() => {
    if (!ready()) {
      reject(new Error('QRCode library loading timed out after 5 seconds'));
    }
  }, 5000);
});

export const SendComponent = {
  name: 'SendComponent',
  template: `
    <div class="send-component">
      <div class="form-group mb-4">
        <label for="text-input" class="block mb-2">Text to encode:</label>
        <textarea 
          id="text-input"
          v-model="text"
          @input="onTextChange"
          class="w-full p-2 border rounded h-24 resize-y dark:bg-gray-700 dark:text-white dark:border-gray-600"
          placeholder="Enter text to convert to QR code..."
        ></textarea>
      </div>

      <div class="form-group mb-4">
        <button @click="toggleAdvanced" class="text-sm underline">
          {{ showAdvanced ? 'Hide' : 'Show' }} Advanced Options
        </button>
        
        <div v-if="showAdvanced" class="mt-3 p-3 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
          <div class="mb-2">
            <label class="block mb-1 text-sm">Error Correction:</label>
            <select v-model="errorCorrection" class="p-1 border rounded text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" @change="generateQR">
              <option value="L">Low (7%)</option>
              <option value="M">Medium (15%)</option>
              <option value="Q">Quartile (25%)</option>
              <option value="H">High (30%)</option>
            </select>
          </div>
          
          <div class="mb-2">
            <label class="block mb-1 text-sm">Segmentation:</label>
            <select v-model="segmentMode" class="p-1 border rounded text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" @change="generateQR">
              <option value="single">Single QR Code</option>
              <option value="multi">Multiple QR Codes</option>
            </select>
          </div>
          
          <div v-if="segmentMode === 'multi'" class="mb-2">
            <label class="block mb-1 text-sm">Segment Size (bytes):</label>
            <input
              type="number"
              v-model="segmentSize"
              min="50"
              max="2000"
              step="50"
              class="p-1 border rounded text-sm w-20 dark:bg-gray-700 dark:text-white dark:border-gray-600"
              @change="generateQR"
            />
          </div>
          
          <div class="mb-2">
            <label class="block mb-1 text-sm">Encoding:</label>
            <select v-model="encoding" class="p-1 border rounded text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" @change="generateQR">
              <option value="auto">Auto Detect</option>
              <option value="utf8">UTF-8</option>
              <option value="iso88591">ISO-8859-1</option>
              <option value="shiftjis">Shift JIS</option>
            </select>
          </div>
        </div>
      </div>

      <div v-if="text" class="qr-output text-center p-4 bg-white dark:bg-gray-700 rounded shadow-sm mb-4">
        <div v-if="qrError" class="text-red-600 dark:text-red-400 mb-3 p-3 bg-red-50 dark:bg-red-900 rounded">
          {{ qrError }}
          <button @click="retryQRCode" class="ml-2 underline text-sm">Retry</button>
        </div>
        <div v-if="isLoading" class="flex justify-center items-center py-10">
          <div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
        </div>
        <div ref="qrcode" class="mx-auto"></div>
        
        <div v-if="isMultiSegment" class="mt-4">
          <!-- Progress bar -->
          <div class="mb-3">
            <div class="bg-gray-200 dark:bg-gray-600 rounded-full h-2.5">
              <div 
                class="bg-blue-500 h-2.5 rounded-full transition-all duration-300" 
                :style="{ width: ((currentSegment + 1) / totalSegments * 100) + '%' }"
              ></div>
            </div>
          </div>

          <!-- Controls -->
          <div class="flex items-center justify-between" style="margin-top:12px;">
            <div class="flex items-center gap-2">
              <div class="flex items-center">
                <label class="text-sm mr-2">Speed:</label>
                <span class="mr-2"></span>
                <select v-model="rotationInterval" @change="updateRotation" class="text-sm p-1 rounded border dark:bg-gray-700 dark:border-gray-600">
                  <option :value="1000">Fast (1s)</option>
                  <option :value="2000">Medium (2s)</option>
                  <option :value="3000">Slow (3s)</option>
                </select>
              </div>
            </div>
            <div class="flex flex-col items-end text-sm">
              <span>Progress: {{ currentSegment + 1 }} of {{ totalSegments }}</span>
              <span v-if="isRotating"> ({{ countdownSeconds }}s)</span>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="text-center p-6 bg-gray-50 dark:bg-gray-800 rounded border border-dashed dark:border-gray-700">
        <p>Enter text above to generate a QR code</p>
      </div>
    </div>
  `,
  data() {
    return {
      text: '',
      currentSegment: 0,
      totalSegments: 1,
      qrCodeData: '',
      showAdvanced: false,
      errorCorrection: 'M',
      segmentMode: 'single',
      segmentSize: 500,
      isSending: false,
      encoding: 'auto',
      qrError: null,
      isLoading: false,
      libraryLoaded: false,
      retryCount: 0,
      // Auto-rotation properties
      isRotating: false,
      rotationInterval: 2000, // 2 seconds default
      rotationTimer: null,
      countdownSeconds: 2,
      countdownTimer: null
    };
  },
  computed: {
    canNavigate() {
      return this.totalSegments > 1;
    },
    isMultiSegment() {
      return this.totalSegments > 1;
    }
  },
  methods: {
    generateQR() {
      if (!this.text) return;
      
      this.isSending = true;
      this.isLoading = true;
      this.qrError = null;
      
      try {
        const result = encodeData(this.text, {
          errorCorrection: this.errorCorrection,
          segmentSize: this.segmentMode === 'multi' ? this.segmentSize : null,
          encoding: this.encoding
        });
        
        this.qrCodeData = result.data[this.currentSegment];
        this.totalSegments = result.data.length;
        
        // Save session for potential recovery
        saveSession({
          type: 'send',
          text: this.text,
          settings: {
            errorCorrection: this.errorCorrection,
            segmentMode: this.segmentMode,
            segmentSize: this.segmentSize,
            encoding: this.encoding
          }
        });
        
        // Automatically start rotation if there are multiple segments
        this.$nextTick(() => {
          this.renderQRCode();
          
          // Always start rotation for multi-segment, no pause/stop
          if (this.isMultiSegment && this.totalSegments > 1) {
            this.startRotation();
          }
        });
      } catch (error) {
        console.error('Error generating QR code:', error);
        this.qrError = 'Failed to generate QR code. The data may be too large or in an unsupported format.';
        this.isLoading = false;
      } finally {
        this.isSending = false;
      }
    },
    
    // Helper to robustly check for QRCode constructor with retries
    async checkQRCode(maxAttempts = 5, delayMs = 200) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Try all common global shapes
        let QR = window.QRCode;
        if (typeof QR === 'function') return QR;
        if (QR && typeof QR.default === 'function') return QR.default;
        // Some builds may use lowercase
        QR = window.qrcode;
        if (typeof QR === 'function') return QR;
        if (QR && typeof QR.default === 'function') return QR.default;
        // Wait and retry
        await new Promise(res => setTimeout(res, delayMs));
      }
      throw new Error('QRCode.js loaded but constructor not found after multiple attempts');
    },

    async renderQRCode() {
      const qrContainer = this.$refs.qrcode;
      if (!qrContainer || !this.qrCodeData) return;

      // Clear previous QR code
      qrContainer.innerHTML = '';

      // Ensure container is styled for centering and sizing
      qrContainer.style.display = 'flex';
      qrContainer.style.justifyContent = 'center';
      qrContainer.style.alignItems = 'center';
      qrContainer.style.width = '100%';
      qrContainer.style.height = '256px'; // or '100%' if you want it to fill parent
      qrContainer.style.minHeight = '256px';

      try {
        // Ensure QRCode library is loaded
        await ensureQRCodeLibrary();

        this.libraryLoaded = true;

        // Robustly get QRCode constructor
        const QR = await this.checkQRCode();

        // Use pixel numbers for width/height (not '100%')
        new QR(qrContainer, {
          text: this.qrCodeData,
          width: 256,
          height: 256,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QR.CorrectLevel?.[this.errorCorrection] ||
                        (QR.CorrectLevel?.M && QR.CorrectLevel[this.errorCorrection]) ||
                        1 // Default to medium if structure unknown
        });

        // Make QR code responsive and centered
        const qrEl = qrContainer.querySelector('canvas, img, svg');
        if (qrEl) {
          qrEl.style.width = '100%';
          qrEl.style.height = '100%';
          qrEl.style.maxWidth = '256px';
          qrEl.style.maxHeight = '256px';
          qrEl.style.display = 'block';
          qrEl.style.margin = '0 auto';
        }

        this.qrError = null;
      } catch (error) {
        this.qrError = 'Error creating QR code: ' + error.message;
        this.isLoading = false;
        console.error('Error creating QR code:', error);
      } finally {
        this.isLoading = false;
      }
    },
    
    retryQRCode() {
      if (this.retryCount < 3) {
        this.retryCount++;
        this.renderQRCode();
      } else {
        this.qrError = 'QR Code generation failed after multiple attempts. Please check your connection and reload the page.';
      }
    },
    
    startRotation() {
      if (this.isMultiSegment) {
        this.isRotating = true;
        this.countdownSeconds = this.rotationInterval / 1000;

        if (this.countdownTimer) clearInterval(this.countdownTimer);
        if (this.rotationTimer) clearInterval(this.rotationTimer);

        // Start countdown timer
        this.countdownTimer = setInterval(() => {
          this.countdownSeconds -= 1;
          if (this.countdownSeconds <= 0) {
            this.countdownSeconds = this.rotationInterval / 1000;
          }
        }, 1000);

        // Start rotation timer
        this.rotationTimer = setInterval(() => {
          if (this.currentSegment >= this.totalSegments - 1) {
            this.currentSegment = 0;
          } else {
            this.currentSegment++;
          }
          this.generateQR();
        }, this.rotationInterval);
      }
    },

    updateRotation() {
      // Update rotation speed while keeping it running
      if (this.isMultiSegment) {
        this.startRotation();
      }
    },
    
    toggleAdvanced() {
      this.showAdvanced = !this.showAdvanced;
    },
    
    onTextChange: debounce(function() {
      if (this.text) {
        this.stopRotation(); // Stop any ongoing rotation
        this.currentSegment = 0;
        this.generateQR();
      }
    }, 500),
    
    stopRotation() {
      if (this.rotationTimer) {
        clearInterval(this.rotationTimer);
        this.rotationTimer = null;
      }
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      this.isRotating = false;
    },
  },
  
  beforeUnmount() {
    // Cleanup any timers when component is destroyed
    this.stopRotation();
  },
  
  async mounted() {
    // Try to load QRCode library at component mount
    try {
      await ensureQRCodeLibrary();
      this.libraryLoaded = true;
    } catch (err) {
      console.warn('QRCode library not available on mount, will try again when needed', err);
    }
    
    // Try to restore session if available
    try {
      const session = JSON.parse(localStorage.getItem('qrbitr_session'));
      if (session && session.type === 'send') {
        this.text = session.text || '';
        this.errorCorrection = session.settings?.errorCorrection || 'M';
        this.segmentMode = session.settings?.segmentMode || 'single';
        this.segmentSize = session.settings?.segmentSize || 500;
        this.encoding = session.settings?.encoding || 'auto';
        
        if (this.text) {
          this.generateQR();
        }
      }
    } catch (e) {
      console.error('Error restoring session:', e);
    }
  }
};