export let vectorDimension = 384;
export const decodedVectorCache = new Map();

export function setVectorDimension(dim) {
    vectorDimension = dim;
}

export function normalizeVector(vector) {
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) {
        sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
    }
    return vector;
}

export function decodeVector(encoded) {
    if (typeof encoded === 'string') {
        const binary = atob(encoded);
        const floatVec = new Float32Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            const byteVal = binary.charCodeAt(i);
            floatVec[i] = byteVal > 127 ? byteVal - 256 : byteVal;
        }
        return normalizeVector(floatVec);
    }
    if (Array.isArray(encoded) && encoded.length > 0) {
        return normalizeVector(Float32Array.from(encoded));
    }
    return null;
}

export function encodeVector(floatVec) {
    let maxAbs = 1e-9;
    for (let i = 0; i < floatVec.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(floatVec[i]));
    }
    let binary = '';
    for (let i = 0; i < floatVec.length; i++) {
        const quantized = Math.round((floatVec[i] / maxAbs) * 127);
        binary += String.fromCharCode((quantized + 256) & 255);
    }
    return btoa(binary);
}

export function getCachedVector(paperId, encodedVec) {
    let vec = decodedVectorCache.get(paperId);
    if (!vec) {
        vec = decodeVector(encodedVec);
        decodedVectorCache.set(paperId, vec);
    }
    return vec;
}

export function dotProduct(vecA, vecB) {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
        sum += vecA[i] * vecB[i];
    }
    return sum;
}

export function addScaledVector(target, source, scale) {
    for (let i = 0; i < target.length; i++) {
        target[i] += scale * source[i];
    }
}

export function computeZScores(rows, sourceKey, targetKey) {
    const count = rows.length;
    let mean = 0;
    for (const row of rows) {
        mean += row[sourceKey];
    }
    mean /= count;

    let variance = 0;
    for (const row of rows) {
        variance += (row[sourceKey] - mean) ** 2;
    }
    const stdDev = Math.sqrt(variance / count) || 1;

    for (const row of rows) {
        row[targetKey] = (row[sourceKey] - mean) / stdDev;
    }
}
