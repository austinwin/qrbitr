import { PRNG } from './prng.js';

// Generate robust soliton distribution
export function robustSolitonDistribution(K, c = 0.03, delta = 0.05) {
  const R = c * Math.log(K / delta) * Math.sqrt(K);
  const S = K / R;
  const distribution = new Array(K + 1).fill(0);
  let totalWeight = 0;

  distribution[1] = 1 / K;
  for (let d = 2; d <= K; d++) {
    distribution[d] = 1 / (d * (d - 1));
  }

  for (let d = 1; d <= Math.floor(K / S); d++) {
    distribution[d] += R / (K * d);
  }

  const spikePos = Math.floor(S);
  if (spikePos > 0 && spikePos <= K) {
    distribution[spikePos] += R / K * Math.log(R / delta);
  }

  for (let d = 1; d <= K; d++) {
    totalWeight += distribution[d];
  }

  for (let d = 1; d <= K; d++) {
    distribution[d] /= totalWeight;
  }

  for (let d = 1; d <= K; d++) {
    distribution[d] += distribution[d - 1];
  }

  return distribution;
}

export function sampleDegree(distribution, rng) {
  const r = rng.next();
  for (let d = 1; d < distribution.length; d++) {
    if (r < distribution[d]) return d;
  }
  return 1;
}

export function createFountainChunk(sourceChunks, totalChunks, seed, distribution) {
  const rng = new PRNG(seed);
  const degree = sampleDegree(distribution, rng);
  const indices = rng.selectUnique(degree, totalChunks);

  let maxSize = 0;
  for (const idx of indices) {
    if (sourceChunks[idx] && sourceChunks[idx].length > maxSize) {
      maxSize = sourceChunks[idx].length;
    }
  }

  const result = new Uint8Array(maxSize);
  for (const idx of indices) {
    if (sourceChunks[idx]) {
      const chunk = sourceChunks[idx];
      for (let j = 0; j < chunk.length; j++) {
        result[j] ^= chunk[j];
      }
    }
  }

  return { data: result, seed, degree, indices };
}

export function runPeelingDecoder(sourceChunks, fountainChunks, expectedTotal, debugCallback) {
  let progress = true;
  let decodingRound = 0;

  while (progress && Object.keys(sourceChunks).length < expectedTotal && decodingRound < 10) {
    progress = false;
    decodingRound++;

    for (const seedStr in fountainChunks) {
      const fountain = fountainChunks[seedStr];
      if (fountain.missingCount === 1) {
        const missing = fountain.indices.filter(idx => !sourceChunks[idx]);
        const missingIdx = missing[0];

        const recoveredChunk = new Uint8Array(fountain.data.length);
        recoveredChunk.set(fountain.data);

        for (const idx of fountain.indices) {
          if (idx !== missingIdx && sourceChunks[idx]) {
            const chunk = sourceChunks[idx];
            const len = Math.min(chunk.length, recoveredChunk.length);
            for (let j = 0; j < len; j++) {
              recoveredChunk[j] ^= chunk[j];
            }
          }
        }

        let isValid = recoveredChunk.length === 0;
        for (let i = 0; i < recoveredChunk.length; i++) {
          if (recoveredChunk[i] !== 0) {
            isValid = true;
            break;
          }
        }

        if (isValid) {
          sourceChunks[missingIdx] = recoveredChunk;
          progress = true;
          debugCallback(`✨ Recovered chunk ${missingIdx} via peeling`);
          for (const s in fountainChunks) {
            const f = fountainChunks[s];
            if (f.indices.includes(missingIdx)) {
              f.missingCount--;
            }
          }
        }
      }
    }
  }

  debugCallback(`📊 After peeling: ${Object.keys(sourceChunks).length}/${expectedTotal} chunks`);
}

export function runGaussianElimination(sourceChunks, fountainChunks, expectedTotal, debugCallback) {
  const missing = [];
  for (let i = 0; i < expectedTotal; i++) {
    if (!sourceChunks[i]) missing.push(i);
  }

  if (missing.length === 0) return;
  if (missing.length > 50) {
    debugCallback(`⚠️ Too many missing chunks (${missing.length}) for Gaussian elimination`);
    return;
  }

  const relevantFountains = [];
  for (const seedStr in fountainChunks) {
    const fountain = fountainChunks[seedStr];
    if (fountain.indices.some(idx => missing.includes(idx))) {
      relevantFountains.push(fountain);
    }
  }

  if (relevantFountains.length < missing.length) {
    debugCallback(`⚠️ Not enough relevant fountain chunks (${relevantFountains.length}) for ${missing.length} missing`);
    return;
  }

  let maxSize = 0;
  for (const idx in sourceChunks) {
    maxSize = Math.max(maxSize, sourceChunks[idx].length);
  }
  for (const fountain of relevantFountains) {
    maxSize = Math.max(maxSize, fountain.data.length);
  }

  const recovered = missing.map(() => new Uint8Array(maxSize));

  for (let bytePos = 0; bytePos < maxSize; bytePos++) {
    const coefficients = new Array(relevantFountains.length);
    for (let i = 0; i < relevantFountains.length; i++) {
      coefficients[i] = new Array(missing.length).fill(0);
      for (let j = 0; j < missing.length; j++) {
        if (relevantFountains[i].indices.includes(missing[j])) {
          coefficients[i][j] = 1;
        }
      }
    }

    const constants = new Array(relevantFountains.length).fill(0);
    for (let i = 0; i < relevantFountains.length; i++) {
      const fountain = relevantFountains[i];
      let value = bytePos < fountain.data.length ? fountain.data[bytePos] : 0;
      for (const sourceIdx of fountain.indices) {
        if (!missing.includes(sourceIdx) && sourceChunks[sourceIdx]) {
          const sourceChunk = sourceChunks[sourceIdx];
          value ^= bytePos < sourceChunk.length ? sourceChunk[bytePos] : 0;
        }
      }
      constants[i] = value;
    }

    const result = solveLinearBinary(coefficients, constants);
    if (result) {
      for (let i = 0; i < missing.length; i++) {
        recovered[i][bytePos] = result[i];
      }
    } else {
      debugCallback(`⚠️ Failed to solve for byte position ${bytePos}`);
      return;
    }
  }

  for (let i = 0; i < missing.length; i++) {
    sourceChunks[missing[i]] = recovered[i];
    debugCallback(`✨ Recovered chunk ${missing[i]} via Gaussian elimination`);
  }

  debugCallback(`📊 After Gaussian: ${Object.keys(sourceChunks).length}/${expectedTotal} chunks`);
}

function solveLinearBinary(coefficients, constants) {
  const numEquations = coefficients.length;
  const numVariables = coefficients[0].length;

  if (numEquations < numVariables) return null;

  const augmented = coefficients.map((row, i) => [...row, constants[i]]);

  let row = 0;
  for (let col = 0; col < numVariables; col++) {
    let pivotRow = -1;
    for (let i = row; i < numEquations; i++) {
      if (augmented[i][col] === 1) {
        pivotRow = i;
        break;
      }
    }

    if (pivotRow === -1) continue;

    if (pivotRow !== row) {
      [augmented[row], augmented[pivotRow]] = [augmented[pivotRow], augmented[row]];
    }

    for (let i = 0; i < numEquations; i++) {
      if (i !== row && augmented[i][col] === 1) {
        for (let j = col; j <= numVariables; j++) {
          augmented[i][j] ^= augmented[row][j];
        }
      }
    }

    row++;
    if (row >= numEquations) break;
  }

  for (let i = row; i < numEquations; i++) {
    if (augmented[i][numVariables] === 1) {
      return null;
    }
  }

  const solution = new Array(numVariables).fill(0);
  for (let i = row - 1; i >= 0; i--) {
    let sum = augmented[i][numVariables];
    let pivotCol = -1;

    for (let j = 0; j < numVariables; j++) {
      if (augmented[i][j] === 1) {
        if (pivotCol === -1) {
          pivotCol = j;
        } else {
          sum ^= solution[j];
        }
      }
    }

    if (pivotCol !== -1) {
      solution[pivotCol] = sum;
    }
  }

  return solution;
}