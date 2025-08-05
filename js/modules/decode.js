export const QRdecode = {
  startScanning(videoElement, onData) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
      videoElement.srcObject = stream;
      videoElement.play();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const chunks = new Map();
      const scan = () => {
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
          ctx.drawImage(videoElement, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            try {
              const chunk = JSON.parse(code.data);
              chunks.set(chunk.id, chunk.data);
              onData(chunk, chunks);
              if (chunks.size === chunk.total) {
                const data = Array.from(chunks.entries()).sort(([a], [b]) => a - b).map(([, d]) => d).join('');
                onData({ complete: true, data });
                stream.getTracks().forEach(track => track.stop());
              }
            } catch (e) {}
          }
        }
        requestAnimationFrame(scan);
      };
      scan();
    });
  },
};
/**
 * Decodes QR code data, handling segmentation if present
 * 
 * @param {string} data - The raw data from QR code
 * @returns {Object} Decoded data with metadata
 */
export function decodeQR(data) {
  // Check if this is a segmented QR code
  if (data.startsWith('SEG|')) {
    // Extract metadata and content
    const parts = data.split('|');
    if (parts.length < 4) {
      throw new Error('Invalid segmented QR format');
    }
    
    const index = parseInt(parts[1], 10);
    const total = parseInt(parts[2], 10);
    
    // The actual data starts after the 3rd pipe
    const content = parts.slice(3).join('|');
    
    return {
      data: content,
      index,
      total,
      isMultiSegment: true
    };
  }
  
  // Regular non-segmented QR code
  return {
    data,
    index: 0,
    total: 1,
    isMultiSegment: false
  };
}