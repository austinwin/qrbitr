import { robustSolitonDistribution, sampleDegree, createFountainChunk, runPeelingDecoder, runGaussianElimination } from './lt-codes.js';
import { PRNG } from './prng.js';
import { crc32, formatBytes, bytesToBase64, base64ToBytes, tryAdvancedDecompress } from './utils.js';

export class QRStream {
  constructor(config = {}) {
    this.chunkSize = config.chunkSize || 800;
    this.redundancy = config.redundancy || 0.5;
    this.fps = config.fps || 20;
    this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024;
    this.solitonParams = {
      c: config.solitonC || 0.03,
      delta: config.solitonDelta || 0.05
    };
    this.debugCallback = config.debugCallback || (() => {});
    this.statusCallback = config.statusCallback || (() => {});
    this.progressCallback = config.progressCallback || (() => {});
    this.resultCallback = config.resultCallback || (() => {});
    this.speedCallback = config.speedCallback || (() => {});
    this.errorCallback = config.errorCallback || (() => {});
    this.endlessFountain = config.endlessFountain !== undefined ? config.endlessFountain : true;

    this.sendChunks = [];
    this.sendIndex = 0;
    this.loopTimer = null;
    this.sendSessionId = null;
    this.sid = null;
    this.sourceChunks = {};
    this.fountainChunks = {};
    this.expectedTotal = null;
    this.fileName = null;
    this.trailerDetected = false;
    this.isReceiving = false;
    this.startTime = null;
    this.receivedBytes = 0;
    this.speedUpdateInterval = null;
    this.fileCompressed = false;
    this.fileOriginalSize = 0;
    this.metaOriginalCrc = null;
    this.metaCompressedCrc = null;
    this.ltVersion = 0;
    this.baseChunks = [];
    this.sourceData = null;
    this.distribution = null;
    this.fountainsSent = 0;
    this.maxFountainSeed = 0xFFFFFFFF;
    this.isSending = false;
    this.fileMetadata = null;
    this.tempPauseTimer = null;
    this.trailerFrames = [];
    this.normalFrameIndex = 0;
    this.displayingTrailers = false;
    this.currentFrame = null; // Store the current frame for redrawing on resize
  }

  startSending(file, canvas) {
    if (this.isSending) {
      this.stopSending();
    }
    
    if (!file) {
      this.statusCallback('Choose a file');
      return;
    }
    if (file.size > this.maxFileSize) {
      this.statusCallback(`File too large (>${formatBytes(this.maxFileSize)})`);
      return;
    }

    this.isSending = true;
    this.sendSessionId = Math.floor(Math.random() * 0xFFFFFFFF);
    const reader = new FileReader();

    reader.onload = async (e) => {
      const arr = new Uint8Array(e.target.result);
      const originalCrc = crc32(arr);
      let compressedData = arr;
      let isCompressed = false;

      try {
        compressedData = pako.deflate(arr);
        if (compressedData.length < arr.length) {
          isCompressed = true;
          this.debugCallback(`🗜️ Compressed: ${arr.length} → ${compressedData.length} bytes (${Math.round(compressedData.length/arr.length*100)}%)`);
        } else {
          compressedData = arr;
          this.debugCallback(`🗜️ Compression skipped (no size benefit)`);
        }
      } catch (err) {
        this.debugCallback(`Compression failed: ${err}`);
        compressedData = arr;
      }

      const compressedCrc = isCompressed ? crc32(compressedData) : originalCrc;
      const totalChunks = Math.ceil(compressedData.length / this.chunkSize);
      this.sendChunks = [];
      this.baseChunks = [];
      this.sourceData = compressedData;
      this.fountainsSent = 0;
      const sourceChunks = [];

      for (let i = 0; i < totalChunks; i++) {
        sourceChunks.push(compressedData.slice(i * this.chunkSize, (i + 1) * this.chunkSize));
      }

      this.distribution = robustSolitonDistribution(totalChunks, this.solitonParams.c, this.solitonParams.delta);

      const metadataObj = {
        name: file.name,
        compressed: isCompressed,
        originalSize: arr.length,
        compressedSize: compressedData.length,
        totalChunks: totalChunks,
        chunkSize: this.chunkSize,
        originalCrc: originalCrc,
        compressedCrc: compressedCrc,
        ltVersion: 1,
        c: this.solitonParams.c,
        delta: this.solitonParams.delta
      };

      // Add metadata frame
      const metaFrame = this.createBinaryFrame({
        type: 1,
        index: 0,
        total: totalChunks,
        data: new TextEncoder().encode(JSON.stringify(metadataObj))
      });
      this.sendChunks.push(metaFrame);
      this.baseChunks.push(metaFrame);

      // Add source data frames
      for (let i = 0; i < totalChunks; i++) {
        const frame = this.createBinaryFrame({
          type: 2,
          index: i,
          total: totalChunks,
          data: sourceChunks[i]
        });
        this.sendChunks.push(frame);
        this.baseChunks.push(frame);
      }

      // Add initial fountain chunks for redundancy
      const initialFountainCount = Math.ceil(totalChunks * this.redundancy);
      this.debugCallback(`📊 Adding ${initialFountainCount} initial fountain chunks (${this.redundancy * 100}% redundancy)`);

      for (let i = 0; i < initialFountainCount; i++) {
        const frame = this.createFountainFrame(sourceChunks, totalChunks, i);
        this.sendChunks.push(frame);
      }
      this.fountainsSent = initialFountainCount;

      // Add trailer frames
      for (let i = 0; i < 5; i++) {
        const trailerFrame = this.createBinaryFrame({
          type: 3,
          index: 0,
          total: totalChunks,
          data: new Uint8Array(0)
        });
        this.sendChunks.push(trailerFrame);
        this.baseChunks.push(trailerFrame);
        this.trailerFrames.push(trailerFrame); // Store trailer frames separately
      }

      const totalFrames = this.sendChunks.length;
      this.debugCallback(`📤 Prepared ${totalFrames} QR frames (${totalChunks} data + ${initialFountainCount} fountain + 1 meta + 5 trailers)`);
      this.loopQR(canvas, sourceChunks, totalChunks);
    };

    reader.readAsArrayBuffer(file);
  }
  
  restartSending(canvas, percentage = 0) {
    if (!this.sourceData || !this.baseChunks) {
      throw new Error("No data to restart sending");
    }
    
    // Clear existing loop
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    
    // Calculate the starting position based on percentage
    if (percentage > 0 && this.sendChunks.length > 0) {
      // Find where data chunks start (after metadata frame)
      let dataChunkStart = 1;  // Start after metadata
      
      // Calculate position based on percentage and valid data chunks
      // Count only data frames (type 2) for percentage calculation
      const dataChunks = this.baseChunks.filter(frame => new DataView(frame.buffer).getUint16(8, false) === 2);
      const position = Math.floor(dataChunks.length * (percentage / 100));
      
      // Set starting index to position in the data chunks (skipping metadata)
      this.sendIndex = Math.min(position + dataChunkStart, this.sendChunks.length - 1);
      this.debugCallback(`🔄 Restarting from position: ${percentage}% (frame ${this.sendIndex})`);
    } else {
      // Reset sending index to 0 to start from beginning
      this.sendIndex = 0;
      this.debugCallback(`🔄 Restarting from beginning`);
    }
    
    this.fountainsSent = 0;
    
    // Start the loop again
    this.loopQR(canvas);
    this.isSending = true;
  }

  createFountainFrame(sourceChunks, totalChunks, seedOffset = 0) {
    // Use high-entropy seed generation to avoid collisions
    const seed = Math.floor(Math.random() * this.maxFountainSeed) + seedOffset;
    const fountainChunk = createFountainChunk(sourceChunks, totalChunks, seed, this.distribution);
    const fountainBuffer = new Uint8Array(8 + fountainChunk.data.length);
    const fountainView = new DataView(fountainBuffer.buffer);

    fountainView.setUint32(0, fountainChunk.seed, false);
    fountainView.setUint16(4, fountainChunk.degree, false);
    fountainView.setUint16(6, fountainChunk.indices.length, false);
    fountainBuffer.set(fountainChunk.data, 8);

    return this.createBinaryFrame({
      type: 4,
      index: this.fountainsSent,
      total: totalChunks,
      data: fountainBuffer
    });
  }

  loopQR(canvas, sourceChunks, totalChunks) {
    this.sendIndex = 0;
    this.normalFrameIndex = 0;
    this.displayingTrailers = false;
    
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
    }

    this.loopTimer = setInterval(() => {
      // Skip trailer display loop if we're showing trailers via magic signal
      if (this.displayingTrailers) {
        return;
      }
    
      // If we've gone through all prepared frames and endless fountain is enabled,
      // start generating new fountain frames dynamically
      if (this.endlessFountain && this.sendIndex >= this.sendChunks.length) {
        // After one complete cycle, alternate between base frames and new fountain frames
        if (this.sendIndex % 2 === 0 && this.baseChunks.length > 0) {
          // Send one of the base frames (metadata, data chunks, or trailers)
          const baseIndex = (this.fountainsSent + this.sendIndex) % this.baseChunks.length;
          const frame = this.baseChunks[baseIndex];
          this.displayFrame(canvas, frame);
        } else {
          // Generate and send a new fountain frame
          const frame = this.createFountainFrame(
            Array.from({ length: totalChunks }, (_, i) => 
              this.sourceData.slice(i * this.chunkSize, (i + 1) * this.chunkSize)),
            totalChunks,
            this.fountainsSent
          );
          this.fountainsSent++;
          this.displayFrame(canvas, frame);
          
          // Log periodic statistics
          if (this.fountainsSent % 100 === 0) {
            this.debugCallback(`🌊 Generated ${this.fountainsSent} fountain chunks so far`);
          }
        }
        this.sendIndex++;
      } else {
        // Normal frame display from pre-generated frames
        const frame = this.sendChunks[this.sendIndex];
        this.displayFrame(canvas, frame);
        this.sendIndex = (this.sendIndex + 1) % this.sendChunks.length;
      }
    }, 1000 / this.fps);
  }

  // New method to send trailer frames as a signal
  sendTrailerFrames() {
    if (!this.isSending || !this.trailerFrames || this.trailerFrames.length === 0) {
      throw new Error("No trailer frames available");
    }
    
    // Store the current frame index to resume from
    this.normalFrameIndex = this.sendIndex;
    this.displayingTrailers = true;
    
    // Clear existing loop temporarily
    const oldFps = this.fps;
    const canvas = document.querySelector('#sendCanvas');
    
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
    }
    
    let trailerIndex = 0;
    
    // Show each trailer frame for a short time
    const trailerInterval = setInterval(() => {
      if (trailerIndex >= this.trailerFrames.length) {
        clearInterval(trailerInterval);
        // Resume normal display
        this.displayingTrailers = false;
        this.sendIndex = this.normalFrameIndex;
        
        // Restart normal loop
        this.loopTimer = setInterval(() => {
          if (this.displayingTrailers) return;
          
          if (this.endlessFountain && this.sendIndex >= this.sendChunks.length) {
            // ...existing code for fountain mode...
          } else {
            // Normal frame display from pre-generated frames
            const frame = this.sendChunks[this.sendIndex];
            this.displayFrame(canvas, frame);
            this.sendIndex = (this.sendIndex + 1) % this.sendChunks.length;
          }
        }, 1000 / oldFps);
        
        return;
      }
      
      // Display trailer frame
      this.displayFrame(canvas, this.trailerFrames[trailerIndex]);
      trailerIndex++;
    }, 200); // Display each trailer frame for 200ms (5 frames = 1 second)
  }

  displayFrame(canvas, frame) {
    this.currentFrame = frame; // Store current frame for resize events
    
    let frameText = '';
    for (const byte of frame) {
      frameText += String.fromCharCode(byte);
    }
    QRCode.toCanvas(canvas, frameText, { width: 512, errorCorrectionLevel: 'L' }, err => {
      if (err) this.debugCallback(`QR Error: ${err}`);
    });
  }

  createBinaryFrame({ type, index, total, data }) {
    const headerSize = 16;
    const frame = new Uint8Array(headerSize + data.length);
    const view = new DataView(frame.buffer);

    frame[0] = 81; // Q
    frame[1] = 82; // R
    frame[2] = 66; // B
    frame[3] = 84; // T

    view.setUint32(4, this.sendSessionId, false);
    view.setUint16(8, type, false);
    view.setUint16(10, index, false);
    view.setUint16(12, total, false);
    view.setUint16(14, data.length, false);

    frame.set(data, headerSize);
    return frame;
  }

  startReceiving(video, canvas, enablePeeling = true, enableGaussian = true) {
    this.sid = null;
    this.sourceChunks = {};
    this.fountainChunks = {};
    this.expectedTotal = null;
    this.fileName = null;
    this.trailerDetected = false;
    this.isReceiving = true;
    this.startTime = Date.now();
    this.receivedBytes = 0;

    if (this.speedUpdateInterval) clearInterval(this.speedUpdateInterval);
    this.speedUpdateInterval = setInterval(() => this.updateTransferSpeed(), 1000);

    this.progressCallback(0);
    this.statusCallback('Initializing camera...');
    this.debugCallback('📋 Session log:');
    this.resultCallback('');

    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    }).then(stream => {
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const maxEdge = 720;
        let decodeWidth = video.videoWidth;
        let decodeHeight = video.videoHeight;
        if (decodeWidth > decodeHeight) {
          if (decodeWidth > maxEdge) {
            decodeHeight = Math.round(decodeHeight * (maxEdge / decodeWidth));
            decodeWidth = maxEdge;
          }
        } else {
          if (decodeHeight > maxEdge) {
            decodeWidth = Math.round(decodeWidth * (maxEdge / decodeHeight));
            decodeHeight = maxEdge;
          }
        }

        const decodeCanvas = document.createElement('canvas');
        decodeCanvas.width = decodeWidth;
        decodeCanvas.height = decodeHeight;
        const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });

        this.statusCallback('Ready! Scanning for QR codes...');
        this.scanLoop(video, canvas, decodeCanvas, decodeCtx, enablePeeling, enableGaussian);
      };
    }).catch(err => {
      this.debugCallback(`❌ Camera error: ${err.message}`);
      this.statusCallback('Failed to access camera');
      this.resultCallback(`Camera error: ${err.message}`);
      this.errorCallback();
    });
  }

  scanLoop(video, canvas, decodeCanvas, decodeCtx, enablePeeling, enableGaussian) {
    if (!this.isReceiving) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      decodeCtx.drawImage(video, 0, 0, decodeCanvas.width, decodeCanvas.height);
      const imageData = decodeCtx.getImageData(0, 0, decodeCanvas.width, decodeCanvas.height);

      try {
        const qr = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (qr) {
          const bytes = new Uint8Array(qr.data.length);
          for (let i = 0; i < qr.data.length; i++) {
            bytes[i] = qr.data.charCodeAt(i);
          }

          if (bytes.length >= 16 && bytes[0] === 81 && bytes[1] === 82 && bytes[2] === 66 && bytes[3] === 84) {
            const view = new DataView(bytes.buffer);
            const pktSid = view.getUint32(4, false);
            const pktType = view.getUint16(8, false);
            const pktIndex = view.getUint16(10, false);
            const pktTotal = view.getUint16(12, false);
            const pktDataLen = view.getUint16(14, false);
            const pktData = bytes.slice(16, 16 + pktDataLen);

            if (!this.sid) {
              this.sid = pktSid;
              this.statusCallback(`🟢 Scanning session ${this.sid}...`);
              this.debugCallback(`🟢 New session: ${this.sid}`);
            }

            if (pktSid === this.sid) {
              if (pktType === 1) {
                try {
                  const metadataText = new TextDecoder().decode(pktData);
                  const metadataObj = JSON.parse(metadataText);
                  this.fileName = metadataObj.name;
                  this.fileCompressed = metadataObj.compressed;
                  this.fileOriginalSize = metadataObj.originalSize;
                  this.expectedTotal = metadataObj.totalChunks;
                  this.metaOriginalCrc = metadataObj.originalCrc;
                  this.metaCompressedCrc = metadataObj.compressedCrc;
                  this.ltVersion = metadataObj.ltVersion || 0;
                  if (metadataObj.c !== undefined) this.solitonParams.c = metadataObj.c;
                  if (metadataObj.delta !== undefined) this.solitonParams.delta = metadataObj.delta;

                  this.debugCallback(`📋 Metadata: ${this.fileName}, compressed=${this.fileCompressed}, totalChunks=${this.expectedTotal}, ltVersion=${this.ltVersion}`);
                } catch (e) {
                  this.debugCallback(`⚠️ Metadata parse error: ${e.message}`);
                }
              }

              if (pktType === 2 && !(pktIndex in this.sourceChunks)) {
                this.sourceChunks[pktIndex] = pktData;
                this.receivedBytes += pktData.length;
                this.expectedTotal = pktTotal;
                this.updateProgress();
                this.debugCallback(`📦 Source chunk ${pktIndex}/${this.expectedTotal}`);

                for (const seed in this.fountainChunks) {
                  const f = this.fountainChunks[seed];
                  if (f.indices.includes(pktIndex)) {
                    f.missingCount--;
                  }
                }

                if (enablePeeling) {
                  runPeelingDecoder(this.sourceChunks, this.fountainChunks, this.expectedTotal, this.debugCallback);
                }
              }

              if (pktType === 4 && this.ltVersion > 0) {
                try {
                  if (pktData.length >= 8) {
                    const view = new DataView(pktData.buffer);
                    const seed = view.getUint32(0, false);
                    const degree = view.getUint16(4, false);
                    const indicesLen = view.getUint16(6, false);

                    if (!this.fountainChunks[seed]) {
                      const data = pktData.slice(8);
                      const rng = new PRNG(seed);
                      const distribution = robustSolitonDistribution(this.expectedTotal || pktTotal, this.solitonParams.c, this.solitonParams.delta);
                      const expectedDegree = sampleDegree(distribution, rng);
                      if (expectedDegree !== degree) {
                        this.debugCallback(`⚠️ Skipped fountain chunk: degree mismatch`);
                        video.requestVideoFrameCallback(() => this.scanLoop(video, canvas, decodeCanvas, decodeCtx, enablePeeling, enableGaussian));
                        return;
                      }

                      const indices = rng.selectUnique(degree, this.expectedTotal || pktTotal);
                      this.fountainChunks[seed] = {
                        data,
                        degree,
                        indices,
                        seed,
                        missingCount: indices.filter(idx => !this.sourceChunks[idx]).length
                      };

                      this.receivedBytes += data.length;
                      this.debugCallback(`🌊 Fountain chunk (degree=${degree})`);

                      if (enablePeeling) {
                        runPeelingDecoder(this.sourceChunks, this.fountainChunks, this.expectedTotal, this.debugCallback);
                      }

                      this.updateProgress();
                    }
                  }
                } catch (e) {
                  this.debugCallback(`⚠️ Fountain chunk error: ${e.message}`);
                }
              }

              if (pktType === 3) {
                this.expectedTotal = pktTotal;
                this.trailerDetected = true;
                this.debugCallback(`🎯 Trailer detected: ${pktTotal} chunks`);

                if (Object.keys(this.sourceChunks).length < this.expectedTotal) {
                  if (enablePeeling) {
                    runPeelingDecoder(this.sourceChunks, this.fountainChunks, this.expectedTotal, this.debugCallback);
                  }

                  if (enableGaussian && Object.keys(this.sourceChunks).length < this.expectedTotal) {
                    runGaussianElimination(this.sourceChunks, this.fountainChunks, this.expectedTotal, this.debugCallback);
                  }
                }
              }

              if (this.expectedTotal && Object.keys(this.sourceChunks).length >= this.expectedTotal) {
                this.isReceiving = false;
                this.statusCallback('🟡 Finalizing...');
                this.finalizeDecode();
                return;
              }
            }
          }
        }
      } catch (e) {
        this.debugCallback(`⚠️ QR error: ${e.message}`);
      }
    }

    if (this.isReceiving) {
      video.requestVideoFrameCallback(() => this.scanLoop(video, canvas, decodeCanvas, decodeCtx, enablePeeling, enableGaussian));
    }
  }

  updateTransferSpeed() {
    if (!this.isReceiving) return;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const speed = (this.receivedBytes / elapsed) / 1024;
    this.speedCallback(speed.toFixed(1));
  }

  updateProgress() {
    if (!this.expectedTotal) return;
    const got = Object.keys(this.sourceChunks).length;
    const pct = Math.round((got / this.expectedTotal) * 100);
    const fountainCount = Object.keys(this.fountainChunks).length;
    this.progressCallback(pct);
    this.statusCallback(`📦 ${got}/${this.expectedTotal} chunks + ${fountainCount} fountain`);
  }

  finalizeDecode() {
    if (this.speedUpdateInterval) clearInterval(this.speedUpdateInterval);

    const totalTime = (Date.now() - this.startTime) / 1000;
    const averageSpeed = (this.receivedBytes / totalTime) / 1024;
    this.speedCallback(`${averageSpeed.toFixed(1)} (${totalTime.toFixed(1)}s)`);

    if (Object.keys(this.sourceChunks).length < this.expectedTotal) {
      this.statusCallback(`⚠️ Incomplete: ${Object.keys(this.sourceChunks).length}/${this.expectedTotal} chunks`);
      this.debugCallback(`⛔ Missing chunks: ${[...Array(this.expectedTotal).keys()].filter(i => !this.sourceChunks[i]).join(', ')}`);
      this.errorCallback(); // Re-enable the button on incomplete
      return;
    }

    this.debugCallback('🧩 Assembling file...');

    try {
      let totalSize = 0;
      for (let i = 0; i < this.expectedTotal; i++) {
        if (!this.sourceChunks[i]) throw new Error(`Missing chunk ${i}`);
        totalSize += this.sourceChunks[i].length;
      }

      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (let i = 0; i < this.expectedTotal; i++) {
        combined.set(this.sourceChunks[i], offset);
        offset += this.sourceChunks[i].length;
      }

      this.debugCallback(`📦 Combined: ${formatBytes(combined.length)}`);

      if (this.metaCompressedCrc) {
        const crc = crc32(combined);
        this.debugCallback(`🔐 Compressed CRC: expected=${this.metaCompressedCrc.toString(16)}, got=${crc.toString(16)}`);
        if (crc !== this.metaCompressedCrc) {
          this.debugCallback(`⚠️ Warning: CRC mismatch in compressed data`);
        }
      }

      let result = combined;
      if (this.fileCompressed) {
        try {
          result = pako.inflate(combined);
          this.debugCallback(`✅ Decompressed: ${combined.length} → ${result.length} bytes`);

          if (this.metaOriginalCrc) {
            const crc = crc32(result);
            this.debugCallback(`🔐 Original CRC: expected=${this.metaOriginalCrc.toString(16)}, got=${crc.toString(16)}`);
            if (crc !== this.metaOriginalCrc) {
              this.debugCallback(`⚠️ Warning: CRC mismatch in decompressed data`);
            } else {
              this.debugCallback(`✅ CRC check passed!`);
            }
          }
        } catch (err) {
          this.debugCallback(`⚠️ Decompression failed: ${err.message}`);
          result = tryAdvancedDecompress(combined) || combined;
        }
      }

      const blob = new Blob([result]);
      const extension = this.fileName ? this.fileName.split('.').pop().toLowerCase() : '';
      const displayableText = ['txt', 'csv', 'json', 'log', 'md', 'html', 'css', 'js'];
      const displayableImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];
      const displayablePDF = ['pdf'];

      if (displayableText.includes(extension)) {
        const text = new TextDecoder().decode(result);
        this.resultCallback(`<h4>${this.fileName}</h4><pre>${text}</pre>`);
        this.statusCallback(`✅ Text file: ${this.fileName} (${formatBytes(blob.size)})`);
        this.debugCallback(`✅ File reception complete: ${this.fileName}`);
      } else if (displayableImage.includes(extension)) {
        const url = URL.createObjectURL(blob);
        this.resultCallback(`<h4>${this.fileName}</h4><img src="${url}" alt="${this.fileName}">`);
        this.statusCallback(`✅ Image: ${this.fileName} (${formatBytes(blob.size)})`);
        this.debugCallback(`✅ File reception complete: ${this.fileName}`);
      } else if (displayablePDF.includes(extension)) {
        const url = URL.createObjectURL(blob);
        this.resultCallback(`<h4>${this.fileName}</h4><iframe src="${url}" width="100%" height="600px"></iframe>`);
        this.statusCallback(`✅ PDF: ${this.fileName} (${formatBytes(blob.size)})`);
        this.debugCallback(`✅ File reception complete: ${this.fileName}`);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = this.fileName || 'received_file';
        a.click();
        this.statusCallback(`✅ Downloaded: ${this.fileName || 'received_file'} (${formatBytes(blob.size)})`);
        this.debugCallback(`✅ File reception complete: ${this.fileName}`);
        this.resultCallback(`<div style="text-align: center; padding: 1rem; background: #e8f5e9; border-radius: 8px;">
                            <h4>File Downloaded</h4>
                            <p>Name: ${this.fileName || 'received_file'}</p>
                            <p>Size: ${formatBytes(blob.size)}</p>
                            </div>`);
      }
    } catch (error) {
      this.debugCallback(`⛔ Error: ${error.message}`);
      this.statusCallback(`⚠️ Failed: ${error.message}`);
    }
    
    this.errorCallback(); // Re-enable the button when complete
  }

  stopSending() {
    this.isSending = false;
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  stopReceiving() {
    this.isReceiving = false;
    if (this.speedUpdateInterval) clearInterval(this.speedUpdateInterval);
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.errorCallback(); // Re-enable the button
  }
}