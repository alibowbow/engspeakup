import { performance } from 'perf_hooks';

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodePcm16Original(data: string): Float32Array {
  const bytes = base64ToBytes(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const pcm = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm[index] = view.getInt16(index * 2, true) / 32768;
  }
  return pcm;
}

// Generate some dummy PCM16 base64 data
const dummyData = new Uint8Array(24000 * 2 * 10); // 10 seconds of 24kHz 16-bit PCM
for (let i = 0; i < dummyData.length; i++) {
  dummyData[i] = Math.floor(Math.random() * 256);
}
let binaryStr = "";
for (let i = 0; i < dummyData.length; i++) {
  binaryStr += String.fromCharCode(dummyData[i]);
}
const testBase64 = btoa(binaryStr);

console.log("Starting benchmark for original decodePcm16...");

// Warmup
for (let i=0; i<10; i++) {
  decodePcm16Original(testBase64);
}

const originalStart = performance.now();
for (let i = 0; i < 50; i++) {
  decodePcm16Original(testBase64);
}
const originalTime = performance.now() - originalStart;

console.log(`Original Time: ${originalTime.toFixed(2)} ms`);

function decodePcm16Optimized(data: string): Float32Array {
  const bytes = base64ToBytes(data);
  const int16View = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const sampleCount = int16View.length;
  const pcm = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm[index] = int16View[index] / 32768;
  }
  return pcm;
}

console.log("Starting benchmark for optimized decodePcm16...");

// Warmup
for (let i=0; i<10; i++) {
  decodePcm16Optimized(testBase64);
}

const optimizedStart = performance.now();
for (let i = 0; i < 50; i++) {
  decodePcm16Optimized(testBase64);
}
const optimizedTime = performance.now() - optimizedStart;

console.log(`Optimized Time: ${optimizedTime.toFixed(2)} ms`);
console.log(`Improvement: ${((originalTime - optimizedTime) / originalTime * 100).toFixed(2)}%`);
