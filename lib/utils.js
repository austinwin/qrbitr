export function crc32(data) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function tryAdvancedDecompress(data) {
  console.log('🔧 Trying advanced decompression...');
  
  try {
    const result = pako.inflate(data, { raw: true });
    console.log('✅ Raw inflate succeeded');
    return result;
  } catch (err) {
    console.log('⚠️ Raw inflate failed');
  }

  for (let offset of [2, 4, 6, 8, 10]) {
    if (data.length <= offset) continue;
    try {
      const result = pako.inflate(data.slice(offset), { raw: true });
      console.log(`✅ Inflate with ${offset} byte offset succeeded`);
      return result;
    } catch (err) {}
  }

  console.log('❌ All decompression strategies failed');
  return null;
}