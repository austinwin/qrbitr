export const QRencode = {
  chunkData(data, chunkSize = 2000) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) chunks.push(data.slice(i, i + chunkSize));
    return chunks.map((chunk, index) => ({ id: index, total: chunks.length, data: chunk }));
  },
  generateQR(containerId, data) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    new (window.QRCode)(container, { text: data, width: 128, height: 128 });
  },
  rotateQRCodes(containerId, chunks) {
    let index = 0;
    const rotate = () => {
      if (index >= chunks.length) index = 0;
      this.generateQR(containerId, JSON.stringify(chunks[index]));
      index++;
      setTimeout(rotate, 1000);
    };
    rotate();
  },
};
/**
 * Encodes data into QR code format, handling segmentation if needed
 * 
 * @param {string} data - The text to encode
 * @param {Object} options - Encoding options
 * @returns {Object} The encoded data and metadata
 */
export function encodeData(data, options = {}) {
  const {
    errorCorrection = 'M',
    segmentSize = null,
    encoding = 'auto'
  } = options;
  
  // Default: single segment QR code
  if (!segmentSize) {
    return {
      data: [data],
      totalSegments: 1,
      errorCorrection
    };
  }
  
  // Handle segmentation for large data
  const segments = [];
  const bytes = new TextEncoder().encode(data);
  const totalBytes = bytes.length;
  
  // Calculate how many segments we need
  const actualSegmentSize = Math.min(segmentSize, 1000); // Limit to reasonable size
  const totalSegments = Math.ceil(totalBytes / actualSegmentSize);
  
  if (totalSegments === 1) {
    return {
      data: [data],
      totalSegments: 1,
      errorCorrection
    };
  }
  
  // Split the data into segments
  for (let i = 0; i < totalSegments; i++) {
    const start = i * actualSegmentSize;
    const end = Math.min(start + actualSegmentSize, totalBytes);
    
    // Create segment with metadata
    // Format: SEG|index|total|data
    // This allows the decoder to recognize and combine segments
    const segmentBytes = bytes.slice(start, end);
    const segmentData = new TextDecoder().decode(segmentBytes);
    const segmentWithMeta = `SEG|${i}|${totalSegments}|${segmentData}`;
    
    segments.push(segmentWithMeta);
  }
  
  return {
    data: segments,
    totalSegments,
    errorCorrection
  };
}