import { decodeQR } from '../modules/decode.js';
import { saveSession } from '../modules/storage.js';

export const ReceiveComponent = {
  name: 'ReceiveComponent',
  
  data() {
    return {
      decodedText: '',
      isScanning: false,
      hasCamera: false,
      selectedCamera: '',
      cameras: [],
      segments: [],
      manualMode: false,
      scanning: {
        active: false,
        lastFound: 0
      },
      error: null
    };
  },
  
  computed: {
    receivedSegments() {
      return this.segments.filter(s => s !== null).length;
    },
    
    totalSegments() {
      return this.segments.length > 0 ? this.segments.length : null;
    },
    
    hasSegments() {
      return this.segments.length > 0;
    },
    
    combinedOutput() {
      return this.segments.filter(s => s !== null).join('');
    },
    
    scannerAvailable() {
      return this.hasCamera && !this.manualMode;
    },
    
    progressPercentage() {
      if (!this.totalSegments) return 0;
      return (this.receivedSegments / this.totalSegments) * 100;
    }
  },
  
  methods: {
    async startCamera() {
      this.error = null;
      this.isScanning = true;
      
      try {
        // Re-enumerate cameras after permissions are granted
        await this.loadCameras();
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: this.selectedCamera ? { deviceId: { exact: this.selectedCamera } } : {
            facingMode: 'environment', // Prefer back camera for QR scanning
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        
        // After stream is obtained, check cameras again to ensure we have the complete list
        await this.loadCameras();
        
        this.$nextTick(() => {
          const video = this.$refs.video;
          if (!video) {
            console.error('Video element not found');
            this.error = 'Camera initialization failed. Please try again.';
            return;
          }
          
          // Make sure video is visible and properly sized
          video.style.display = 'block';
          
          // Don't set fixed dimensions on the video element
          // Let CSS handle the sizing instead
          
          // These attributes are critical for iOS/mobile Safari in PWA mode
          video.setAttribute('playsinline', true);
          video.setAttribute('autoplay', true);
          video.setAttribute('muted', true);
          video.setAttribute('webkit-playsinline', true); // Additional Safari support
          
          // Ensure video is visible before setting srcObject
          setTimeout(() => {
            // Detach any existing streams first
            if (video.srcObject) {
              const tracks = video.srcObject.getTracks();
              tracks.forEach(track => track.stop());
            }
            
            // Attach stream to video element
            video.srcObject = stream;
            
            // Play the video and handle errors
            video.play().catch(e => {
              console.error('Error playing video:', e);
              this.error = 'Failed to start camera feed. Please try again.';
            });
            
            this.scanning.active = true;
            this.scanCode();
          }, 100); // Small delay to ensure DOM is ready
        });
      } catch (err) {
        console.error('Error accessing camera:', err);
        this.error = 'Could not access the camera. Please check permissions.';
        this.isScanning = false;
      }
    },
    
    stopCamera() {
      this.isScanning = false;
      this.scanning.active = false;
      
      if (this.$refs.video && this.$refs.video.srcObject) {
        const tracks = this.$refs.video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        this.$refs.video.srcObject = null;
      }
    },
    
    async scanCode() {
      if (!this.scanning.active) return;
      
      const video = this.$refs.video;
      const canvas = this.$refs.canvas;
      if (!video || !canvas) return;
      
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        try {
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
          });
          
          if (code) {
            // Throttle processing to avoid duplicates (only process one code per second)
            const now = Date.now();
            if (now - this.scanning.lastFound > 1000) {
              this.processQRData(code.data);
              this.scanning.lastFound = now;
            }
          }
        } catch (err) {
          console.error('Error scanning QR code:', err);
        }
      }
      
      if (this.scanning.active) {
        requestAnimationFrame(() => this.scanCode());
      }
    },
    
    processQRData(data) {
      try {
        const result = decodeQR(data);
        
        if (result.isMultiSegment) {
          if (!this.segments[result.index] && result.index < 100) { // Sanity check on index
            // Create array of correct size if needed
            if (this.segments.length < result.total) {
              this.segments = Array(result.total).fill(null);
            }
            
            // This is a new segment we haven't seen before
            this.segments[result.index] = result.data;
            // Play a success sound
            this.playBeep();
            
            // Save session
            saveSession({
              type: 'receive',
              segments: this.segments
            });
            
            // Check if all segments are received
            if (!this.segments.includes(null) && this.segments.length === result.total) {
              this.stopCamera();
            }
          }
        } else {
          // Single segment data
          this.decodedText = result.data;
          this.segments = [result.data];
          this.stopCamera();
          this.playBeep();
          
          // Save session
          saveSession({
            type: 'receive',
            segments: this.segments
          });
        }
      } catch (error) {
        console.error('Error processing QR data:', error);
        this.error = 'Invalid QR code format. Please try again.';
      }
    },
    
    playBeep() {
      try {
        // Create a simple beep sound
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.value = 1000;
        gainNode.gain.value = 0.1;
        
        oscillator.start();
        setTimeout(() => oscillator.stop(), 100);
      } catch (e) {
        // Silent fail - audio not crucial
        console.log('Audio feedback not available');
      }
    },
    
    handleFileUpload(event) {
      this.error = null;
      const file = event.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = this.$refs.canvas;
          if (!canvas) return;
          
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          
          canvas.width = img.width;
          canvas.height = img.height;
          
          ctx.drawImage(img, 0, 0, img.width, img.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          try {
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert'
            });
            
            if (code) {
              this.processQRData(code.data);
            } else {
              this.error = 'No QR code found in the image';
            }
          } catch (err) {
            console.error('Error processing image:', err);
            this.error = 'Failed to process image. Please try another image.';
          }
        };
        img.onerror = () => {
          this.error = 'Invalid image file. Please try another image.';
        };
        img.src = e.target.result;
      };
      reader.onerror = () => {
        this.error = 'Failed to read the file. Please try again.';
      };
      reader.readAsDataURL(file);
    },
    
    toggleManualMode() {
      this.manualMode = !this.manualMode;
      if (this.isScanning) {
        this.stopCamera();
      }
      this.error = null;
    },
    
    copyToClipboard() {
      if (!this.combinedOutput) return;
      
      navigator.clipboard.writeText(this.combinedOutput)
        .then(() => {
          const btn = this.$refs.copyButton;
          if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
              btn.textContent = originalText;
            }, 2000);
          }
        })
        .catch(err => {
          console.error('Failed to copy:', err);
          this.error = 'Failed to copy to clipboard. Please try again.';
        });
    },
    
    clearData() {
      this.segments = [];
      this.decodedText = '';
      this.error = null;
      localStorage.removeItem('qrbitr_session');
    },
    
    async loadCameras() {
      try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
          this.hasCamera = false;
          this.error = 'Camera access is not supported in this browser. Please use image upload instead.';
          return;
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoCameras = devices.filter(device => device.kind === 'videoinput');
        
        // Keep track of previous camera count
        const previousCameraCount = this.cameras.length;
        
        this.cameras = videoCameras;
        this.hasCamera = videoCameras.length > 0;
        
        // If we found cameras and don't have one selected, select the first one
        if (this.cameras.length > 0 && (!this.selectedCamera || 
            !this.cameras.some(cam => cam.deviceId === this.selectedCamera))) {
          this.selectedCamera = this.cameras[0].deviceId;
        }
        
        // Log for debugging purposes
        console.log(`Cameras detected: ${this.cameras.length}`);
        
        return this.cameras;
      } catch (err) {
        console.error('Error listing cameras:', err);
        this.hasCamera = false;
        this.error = 'Could not detect cameras. Please use image upload instead.';
        return [];
      }
    },
    
    retryCamera() {
      this.loadCameras().then(() => {
        if (this.hasCamera) {
          this.startCamera();
        }
      });
    },
    
    switchCamera() {
      if (this.cameras.length <= 1) return;
      
      // Find current camera index
      const currentIndex = this.cameras.findIndex(cam => cam.deviceId === this.selectedCamera);
      // Get next camera index (cycle through available cameras)
      const nextIndex = (currentIndex + 1) % this.cameras.length;
      
      // Stop current camera
      this.stopCamera();
      
      // Select next camera
      this.selectedCamera = this.cameras[nextIndex].deviceId;
      
      // Restart camera with new selection
      this.$nextTick(() => {
        this.startCamera();
      });
    }
  },
  
  async mounted() {
    // Check camera availability
    await this.loadCameras();
    
    // Try to restore session if available
    try {
      const session = JSON.parse(localStorage.getItem('qrbitr_session'));
      if (session && session.type === 'receive' && session.segments) {
        this.segments = session.segments;
      }
    } catch (e) {
      console.error('Error restoring session:', e);
    }
  },
  
  beforeUnmount() {
    if (this.isScanning) {
      this.stopCamera();
    }
  },
  
  template: `
    <div class="receive-component">
      <div v-if="error" class="error-banner mb-4 p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded">
        <div class="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
          {{ error }}
        </div>
        <button @click="error = null" class="ml-2 text-sm underline">Dismiss</button>
      </div>
      
      <div class="action-buttons mb-4">
        <div class="flex gap-2 mb-2">
          <button 
            v-if="!isScanning && hasCamera && !manualMode" 
            @click="startCamera" 
            class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            <span class="flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
              </svg>
              Start Camera
            </span>
          </button>
          
          <button 
            v-if="isScanning" 
            @click="stopCamera" 
            class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            <span class="flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd" />
              </svg>
              Stop Camera
            </span>
          </button>
          
          <button 
            v-if="isScanning && cameras.length > 1" 
            @click="switchCamera" 
            class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            <span class="flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
              </svg>
              Switch Camera
            </span>
          </button>
        </div>
      </div>
      
      <div class="scanner-container mb-4">
        <div v-if="isScanning" class="relative bg-black rounded overflow-hidden" style="min-height: 240px;">
          <video 
            ref="video" 
            class="w-full h-auto" 
            playsinline 
            autoplay 
            muted
            webkit-playsinline
            style="max-height: 100%; object-fit: contain; max-width: 100%;"
          ></video>
          <div class="scan-overlay absolute inset-0 border-2 border-blue-500 opacity-70">
            <div class="scan-line"></div>
          </div>
        </div>
        <canvas ref="canvas" class="hidden"></canvas>
      </div>
      
      <div v-if="hasSegments" class="result-container border rounded p-3 mb-4 dark:border-gray-600">
        <div class="mb-2 flex justify-between items-center">
          <h3 class="font-bold">Decoded Data</h3>
          <span v-if="totalSegments > 1" class="text-sm">
            {{ receivedSegments }}/{{ totalSegments }} segments
          </span>
        </div>
        
        <div v-if="totalSegments > 1 && receivedSegments < totalSegments" class="mb-3">
          <div class="bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div 
              class="bg-blue-500 h-2.5 rounded-full" 
              :style="{ width: progressPercentage + '%' }"
            ></div>
          </div>
        </div>
        
        <div class="output-text mb-3 p-3 bg-gray-100 dark:bg-gray-700 rounded min-h-[100px] max-h-[200px] overflow-auto whitespace-pre-wrap break-words">
          {{ combinedOutput }}
        </div>
        
        <div class="flex gap-2">
          <button 
            ref="copyButton"
            @click="copyToClipboard" 
            class="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
            Copy
          </button>
          
          <button 
            @click="clearData" 
            class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            Clear
          </button>
        </div>
      </div>
      
      <div v-else-if="!isScanning" class="text-center p-6 bg-gray-50 dark:bg-gray-800 rounded border border-dashed dark:border-gray-700">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 6h1m-7 7l-4-4m4 4l4-4m-4-7a3 3 0 00-3 3h6a3 3 0 00-3-3z" />
        </svg>
        
        <p class="mb-4" v-if="hasCamera || manualMode">Start scanning or upload an image to decode QR codes</p>
        <p class="mb-4" v-else>No camera detected. Please use image upload instead.</p>
        
        <button 
          v-if="!hasCamera && !manualMode" 
          @click="retryCamera"
          class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry Camera Detection
        </button>
      </div>
      
      <style>
        .scan-line {
          position: absolute;
          width: 100%;
          height: 2px;
          background: rgba(0, 120, 255, 0.8);
          top: 50%;
          transform: translateY(-50%);
          animation: scan 2s infinite;
        }
        
        @keyframes scan {
          0% { top: 5%; }
          50% { top: 95%; }
          100% { top: 5%; }
        }
      </style>
    </div>
  `
};
