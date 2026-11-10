import { DEFAULT_STATE, STORAGE_KEY } from './config.js';
import { clamp, truncateText } from './utils.js';
import { decodeVector, dotProduct, encodeVector, setVectorDimension } from './vectors.js';
import { showToast } from './ui.js';

export function loadUserState() {
    try {
        const savedJson = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('triage.v4');
        if (savedJson) {
            return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(savedJson) };
        }
        const legacyRaw = localStorage.getItem('arxiv_triage_cfg_v3');
        const legacy = JSON.parse(legacyRaw || 'null');
        if (legacy && legacy.prompt) {
            return {
                ...structuredClone(DEFAULT_STATE),
                prompt: legacy.prompt,
                limit: clamp(legacy.limit || 10, 3, 30),
                onboarded: true,
            };
        }
    } catch (err) {
        console.warn('Resetting unreadable local state', err);
    }
    return structuredClone(DEFAULT_STATE);
}

export let state = loadUserState();
let saveTimerId = 0;

export function replaceState(nextState) {
    state = nextState;
}

export function scheduleSave() {
    clearTimeout(saveTimerId);
    saveTimerId = setTimeout(flushState, 150);
}

export function flushState() {
    clearTimeout(saveTimerId);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        pruneMemoryEntries(250);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (err2) {
            showToast('Browser storage is full — consider a backup and reset');
        }
    }
}

export function pruneMemoryEntries(maxCount = 600) {
    const entries = Object.entries(state.mem);
    if (entries.length <= maxCount) {
        return;
    }
    entries.sort((a, b) => b[1].t - a[1].t);
    state.mem = Object.fromEntries(entries.slice(0, maxCount));
}

export let pool = {
    date: null,
    feed: 'astro-ph',
    papers: [],
    byId: new Map(),
    tau: 0.79,
    docs: null,
    avgDocLength: 1,
};

export function ingestDailyFeed(rawJson) {
    const doc = Array.isArray(rawJson) ? { papers: rawJson } : (rawJson || {});
    const papers = [];

    for (const item of doc.papers || []) {
        const vec = decodeVector(item.vec);
        if (!vec) {
            continue;
        }
        const cleanId = String(item.id).replace(/v\d+$/, '');
        const authors = item.authors || [];
        const encodedVec = typeof item.vec === 'string' ? item.vec : encodeVector(vec);

        papers.push({
            id: cleanId,
            v: vec,
            q: encodedVec,
            ver: item.v || 1,
            type: item.type || 'new',
            title: item.title || '',
            micro: item.micro || '',
            abstract: item.abstract || '',
            authors,
            nAuthors: item.n_authors || authors.length,
            cats: item.cats || item.categories || [],
            comment: item.comment || '',
            journal: item.journal || '',
            doi: item.doi || '',
            accepted: Boolean(item.accepted),
            code: item.code || item.github_url || '',
            html: Boolean(item.html),
            fig: item.fig || item.hero_img || '',
            figW: item.fig_w || 0,
            figH: item.fig_h || 0,
            caption: item.caption || '',
        });
    }

    if (papers.length > 0) {
        setVectorDimension(papers[0].v.length);
    }

    const fallbackDate = new Date().toISOString().slice(0, 10);
    const publishedDates = (doc.papers || [])
        .map((p) => p.published)
        .filter(Boolean)
        .sort();
    const feedDate = doc.date || publishedDates.pop() || fallbackDate;

    pool = {
        date: feedDate,
        generated: doc.generated,
        feed: doc.feed || 'astro-ph',
        papers,
        byId: new Map(papers.map((p) => [p.id, p])),
        tau: estimateSimilarityThreshold(papers),
        docs: null,
        avgDocLength: 1,
    };
}

export function estimateSimilarityThreshold(papers) {
    const similarities = [];
    const step = Math.max(1, Math.floor(papers.length / 120));
    for (let i = 0; i < papers.length; i += step) {
        for (let j = i + step; j < papers.length; j += step) {
            similarities.push(dotProduct(papers[i].v, papers[j].v));
        }
    }
    if (similarities.length < 10) {
        return 0.8;
    }
    similarities.sort((a, b) => a - b);
    return similarities[Math.floor(similarities.length * 0.92)];
}

export function computeSignalWeight(paperId, wasExplicitSkip) {
    const phase = state.day.ph[paperId] ?? 0;
    const dwellMs = state.day.dw[paperId] || 0;

    if (state.lib.some((entry) => entry.id === paperId)) {
        return 1.0;
    }
    if (phase >= 2) {
        return 0.7;
    }
    if (phase === 1) {
        return 0.28 + Math.min(0.17, (dwellMs / 90000) * 0.17);
    }
    if (!wasExplicitSkip) {
        return null;
    }
    if (dwellMs < 3500) {
        return -1.0;
    }
    if (dwellMs < 9000) {
        return -0.5;
    }
    return -0.15;
}

export function recordLearningSignal(paperId, wasExplicitSkip = false) {
    const paper = pool.byId.get(paperId);
    if (!paper) {
        return;
    }
    const weight = computeSignalWeight(paperId, wasExplicitSkip);
    if (weight === null) {
        return;
    }
    const record = {
        q: paper.q,
        w: weight,
        t: Date.now(),
    };
    if (weight > 0) {
        record.ti = truncateText(paper.title, 80);
    }
    state.mem[paperId] = record;
    pruneMemoryEntries();
    scheduleSave();
}

export const activeDwell = { id: null, startedAt: 0 };

export function startDwellTimer(paperId) {
    stopDwellTimer();
    activeDwell.id = paperId;
    activeDwell.startedAt = document.hidden ? 0 : performance.now();
}

export function stopDwellTimer() {
    if (activeDwell.id && activeDwell.startedAt && state.day) {
        const elapsed = performance.now() - activeDwell.startedAt;
        state.day.dw[activeDwell.id] = (state.day.dw[activeDwell.id] || 0) + elapsed;
    }
    activeDwell.startedAt = 0;
}

export function getSavedIdSet() {
    return new Set(state.lib.map((entry) => entry.id));
}

export function getExcludedIdSet(additionalIds = []) {
    const excluded = getSavedIdSet();
    for (const id of additionalIds) {
        excluded.add(id);
    }
    return excluded;
}

export function getCurrentPaper() {
    if (!state.day || state.day.i >= state.day.ids.length) {
        return null;
    }
    return pool.byId.get(state.day.ids[state.day.i]) || null;
}
