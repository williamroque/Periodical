import { DAY_MS, STOP_WORDS, getCategoryName } from './config.js';
import { createSeededRandom, hashString, truncateText } from './utils.js';
import {
    addScaledVector,
    computeZScores,
    dotProduct,
    getCachedVector,
    normalizeVector,
    vectorDimension,
} from './vectors.js';
import { getExcludedIdSet, pool, scheduleSave, state } from './state.js';

export function tokenizeText(text) {
    const rawTokens = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\-]*/gu) || [];
    return rawTokens
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
        .map((token) => token.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'));
}

let promptVecCache = { key: '', vec: null };

export function synthesizePromptVector() {
    const text = state.prompt.trim();
    const cacheKey = `${pool.date}|${text}`;
    if (promptVecCache.key === cacheKey) {
        return promptVecCache.vec;
    }

    let synthesized = null;
    const queryTerms = [...new Set(tokenizeText(text))];

    if (queryTerms.length > 0 && pool.papers.length > 0) {
        if (!pool.docs) {
            pool.docs = pool.papers.map((paper) => {
                const tokens = tokenizeText(`${paper.title} ${paper.title} ${paper.abstract}`);
                const termFreq = new Map();
                for (const token of tokens) {
                    termFreq.set(token, (termFreq.get(token) || 0) + 1);
                }
                return { termFreq, length: tokens.length };
            });
            const totalLen = pool.docs.reduce((sum, doc) => sum + doc.length, 0);
            pool.avgDocLength = totalLen / pool.docs.length;
        }

        const docCount = pool.docs.length;
        const idfMap = new Map();
        for (const term of queryTerms) {
            let df = 0;
            for (const doc of pool.docs) {
                if (doc.termFreq.has(term)) {
                    df += 1;
                }
            }
            idfMap.set(term, Math.log(1 + (docCount - df + 0.5) / (df + 0.5)));
        }

        const scoredDocs = [];
        for (let i = 0; i < pool.docs.length; i++) {
            const doc = pool.docs[i];
            let bm25Score = 0;
            for (const term of queryTerms) {
                const freq = doc.termFreq.get(term) || 0;
                if (freq > 0) {
                    const normLen = 0.25 + 0.75 * (doc.length / pool.avgDocLength);
                    bm25Score += idfMap.get(term) * ((freq * 2.2) / (freq + 1.2 * normLen));
                }
            }
            if (bm25Score > 0) {
                scoredDocs.push({ index: i, score: bm25Score });
            }
        }

        scoredDocs.sort((a, b) => b.score - a.score);
        const topMatches = scoredDocs.slice(0, 7);
        if (topMatches.length > 0) {
            synthesized = new Float32Array(vectorDimension);
            const maxScore = topMatches[0].score;
            for (const match of topMatches) {
                const weight = (match.score / maxScore) ** 2;
                addScaledVector(synthesized, pool.papers[match.index].v, weight);
            }
            normalizeVector(synthesized);
        }
    }

    promptVecCache = { key: cacheKey, vec: synthesized };
    return synthesized;
}

export function getDecayedMemoryVectors() {
    const now = Date.now();
    const positive = [];
    const negative = [];

    for (const [id, entry] of Object.entries(state.mem)) {
        const ageDays = (now - entry.t) / DAY_MS;
        const halfLife = entry.w > 0 ? 45 : 21;
        const strength = Math.abs(entry.w) * (0.5 ** (ageDays / halfLife));
        if (strength < 0.03) {
            continue;
        }
        const item = {
            id,
            strength,
            vec: getCachedVector(id, entry.q),
            title: entry.ti || '',
        };
        if (entry.w > 0) {
            positive.push(item);
        } else {
            negative.push(item);
        }
    }

    positive.sort((a, b) => b.strength - a.strength);
    negative.sort((a, b) => b.strength - a.strength);
    return {
        positive: positive.slice(0, 160),
        negative: negative.slice(0, 160),
    };
}

export function rankCandidatePool(targetCount, excludedIds, seedSalt = '') {
    const candidates = pool.papers.filter((paper) => !excludedIds.has(paper.id));
    if (candidates.length === 0 || targetCount <= 0) {
        return [];
    }

    const { positive, negative } = getDecayedMemoryVectors();
    const queryVec = synthesizePromptVector();
    const preferredCats = new Set(state.cats);

    let memoryCentroid = null;
    let positiveMass = 0;
    if (positive.length > 0) {
        memoryCentroid = new Float32Array(vectorDimension);
        for (const item of positive) {
            addScaledVector(memoryCentroid, item.vec, item.strength);
            positiveMass += item.strength;
        }
        normalizeVector(memoryCentroid);
    }

    let profileVec = null;
    if (queryVec || memoryCentroid) {
        profileVec = new Float32Array(vectorDimension);
        if (queryVec) {
            addScaledVector(profileVec, queryVec, 1.0);
        }
        if (memoryCentroid) {
            const memoryBlend = queryVec ? (1.6 * positiveMass) / (positiveMass + 4) : 1.0;
            addScaledVector(profileVec, memoryCentroid, memoryBlend);
        }
        normalizeVector(profileVec);
    }

    const random = createSeededRandom(hashString(pool.date + seedSalt));
    const rows = candidates.map((paper) => {
        const profileSim = profileVec ? dotProduct(paper.v, profileVec) : 0;

        let maxPosSim = 0;
        let nearestPos = null;
        for (const item of positive) {
            const weightedSim = dotProduct(paper.v, item.vec) * Math.min(1, 0.5 + item.strength * 0.5);
            if (weightedSim > maxPosSim) {
                maxPosSim = weightedSim;
                nearestPos = item;
            }
        }

        let maxNegSim = 0;
        for (const item of negative) {
            const weightedSim = dotProduct(paper.v, item.vec) * Math.min(1, 0.4 + item.strength * 0.6);
            if (weightedSim > maxNegSim) {
                maxNegSim = weightedSim;
            }
        }

        const affinity = positive.length >= 2 ? 0.6 * profileSim + 0.4 * maxPosSim : profileSim;
        return {
            paper,
            affinity,
            maxPosSim,
            nearestPos,
            maxNegSim,
            jitter: random(),
        };
    });

    computeZScores(rows, 'affinity', 'zAffinity');
    computeZScores(rows, 'maxNegSim', 'zNegative');

    const negPenaltyWeight = 0.7 * Math.min(1, negative.length / 6);
    for (const row of rows) {
        const p = row.paper;
        const codeBoost = p.code ? 0.32 : 0;
        const venueBoost = p.accepted ? 0.18 : 0;
        const figBoost = p.fig ? 0.12 : 0;
        const crossPenalty = p.type === 'cross' ? 0.15 : 0;
        row.quality = codeBoost + venueBoost + figBoost - crossPenalty;

        let categoryBoost = 0;
        if (preferredCats.size > 0) {
            if (preferredCats.has(p.cats[0])) {
                categoryBoost = 0.55;
            } else if (p.cats.some((cat) => preferredCats.has(cat))) {
                categoryBoost = 0.22;
            } else {
                categoryBoost = -0.15;
            }
        }

        const baseRelevance = profileVec ? row.zAffinity : 0;
        const negativeDamping = negPenaltyWeight * Math.max(0, row.zNegative);
        const noise = (row.jitter - 0.5) * 0.14;

        row.score = baseRelevance - negativeDamping + row.quality + categoryBoost + noise;
        row.redundancy = -1;
    }

    const isPersonalized = Boolean(profileVec || negative.length > 0);
    const exploreSlots = isPersonalized && targetCount >= 4
        ? Math.max(1, Math.round(targetCount * 0.15))
        : 0;

    const selected = [];
    const remaining = rows.slice();
    const tau = pool.tau;

    function pickBestCandidate(scoreFn) {
        let bestIdx = -1;
        let bestVal = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const val = scoreFn(remaining[i]);
            if (val > bestVal) {
                bestVal = val;
                bestIdx = i;
            }
        }
        const picked = remaining.splice(bestIdx, 1)[0];
        for (const other of remaining) {
            const sim = dotProduct(other.paper.v, picked.paper.v);
            other.redundancy = Math.max(other.redundancy, sim);
        }
        return picked;
    }

    while (selected.length < targetCount - exploreSlots && remaining.length > 0) {
        const picked = pickBestCandidate((row) => {
            const clusterOverflow = Math.max(0, row.redundancy - tau) / (1 - tau);
            return row.score - 1.7 * clusterOverflow;
        });
        selected.push(picked);
    }

    const explorePicks = [];
    while (explorePicks.length < exploreSlots && remaining.length > 0) {
        const picked = pickBestCandidate((row) => {
            const novelty = 1 - Math.max(row.redundancy, row.maxPosSim);
            const negPenalty = 0.8 * Math.max(0, row.zNegative);
            return 3.2 * novelty + 0.6 * row.quality - negPenalty + 0.9 * row.jitter;
        });
        picked.isExplore = true;
        explorePicks.push(picked);
    }

    explorePicks.forEach((row, index) => {
        const rawPos = Math.round(((index + 1) * targetCount) / (exploreSlots + 1));
        const insertIndex = Math.min(selected.length, Math.max(2, rawPos));
        selected.splice(insertIndex, 0, row);
    });

    return selected.map((row) => ({
        id: row.paper.id,
        why: explainSelection(row, queryVec, preferredCats),
    }));
}

export function explainSelection(row, queryVec, preferredCats) {
    if (row.isExplore) {
        return { kind: 'explore', text: 'Outside your usual — a deliberate detour' };
    }
    if (row.nearestPos && row.nearestPos.title && row.maxPosSim > pool.tau + 0.02) {
        return { kind: 'like', text: `Close to “${truncateText(row.nearestPos.title, 54)}”` };
    }
    if (queryVec && row.zAffinity > 0.9) {
        return { kind: 'focus', text: 'Matches your research focus' };
    }
    if (preferredCats.has(row.paper.cats[0])) {
        return { kind: 'cat', text: `From ${getCategoryName(row.paper.cats[0])}` };
    }
    if (row.paper.code) {
        return { kind: 'code', text: 'Ships with code' };
    }
    return null;
}

export function buildDailyStack() {
    const picks = rankCandidatePool(state.limit, getExcludedIdSet());
    const whyMap = {};
    for (const pick of picks) {
        whyMap[pick.id] = pick.why;
    }
    state.day = {
        date: pool.date,
        ids: picks.map((pick) => pick.id),
        why: whyMap,
        i: 0,
        ph: {},
        dw: {},
        extra: 0,
    };
    scheduleSave();
}

export function rerankRemainingStack() {
    const day = state.day;
    const seenIds = day.ids.slice(0, day.i);
    const needed = Math.max(0, state.limit + day.extra - seenIds.length);
    const picks = rankCandidatePool(needed, getExcludedIdSet(seenIds), 'r' + Date.now());
    day.ids = seenIds.concat(picks.map((pick) => pick.id));
    for (const pick of picks) {
        day.why[pick.id] = pick.why;
    }
    scheduleSave();
}
