import { DEFAULT_SCIX_PROXY } from './config.js';
import { pool, scheduleSave, state } from './state.js';

const WRITE_PERMISSIONS = new Set(['owner', 'admin', 'write']);
const LIBRARY_CACHE_MS = 5 * 60 * 1000;

export function getSciXProxyBase() {
    const raw = (state.scix?.proxyUrl || DEFAULT_SCIX_PROXY).trim();
    return raw.replace(/\/+$/, '');
}

export function hasSciXToken() {
    return Boolean(state.scix?.token?.trim());
}

export function normalizeArxivId(id) {
    return String(id || '').replace(/^arXiv:/i, '').replace(/v\d+$/, '').trim();
}

export function getSciXAbsUrl(paperOrId) {
    const id = typeof paperOrId === 'string' ? paperOrId : paperOrId?.id;
    return `https://scixplorer.org/abs/arXiv:${encodeURIComponent(normalizeArxivId(id))}`;
}

async function scixRequest(path, options = {}) {
    const token = state.scix?.token?.trim();
    if (!token) {
        const err = new Error('SciX API token is not configured');
        err.status = 401;
        throw err;
    }

    const base = getSciXProxyBase();
    const headers = {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
    };

    let response;
    try {
        response = await fetch(`${base}${path}`, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
    } catch (networkErr) {
        const err = new Error('Could not reach SciX proxy');
        err.cause = networkErr;
        throw err;
    }

    if (response.status === 401 || response.status === 403) {
        const err = new Error('Invalid or unauthorized SciX API token');
        err.status = response.status;
        throw err;
    }
    if (response.status === 429) {
        const err = new Error('SciX rate limit reached — try again shortly');
        err.status = 429;
        throw err;
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err = new Error(`SciX API error (${response.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
        err.status = response.status;
        throw err;
    }

    if (response.status === 204) {
        return null;
    }
    return response.json();
}

export async function fetchSciXLibraries(force = false) {
    const cacheAge = Date.now() - (state.scix.librariesFetchedAt || 0);
    if (!force && state.scix.libraries.length > 0 && cacheAge < LIBRARY_CACHE_MS) {
        return state.scix.libraries;
    }

    const data = await scixRequest('/v1/biblib/libraries');
    const rawLibs = Array.isArray(data?.libraries) ? data.libraries : [];
    const writable = rawLibs
        .filter((lib) => !lib.permission || WRITE_PERMISSIONS.has(lib.permission))
        .map((lib) => ({
            id: lib.id,
            name: lib.name || 'Untitled library',
            description: lib.description || '',
            num_documents: Number(lib.num_documents) || 0,
            permission: lib.permission || 'owner',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    state.scix.libraries = writable;
    state.scix.librariesFetchedAt = Date.now();
    const validIds = new Set(writable.map((lib) => lib.id));
    state.scix.defaultLibIds = (state.scix.defaultLibIds || []).filter((id) => validIds.has(id));
    scheduleSave();
    return writable;
}

export async function createSciXLibrary(name, description = '', isPublic = false) {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error('Library name cannot be empty');
    }
    const created = await scixRequest('/v1/biblib/libraries', {
        method: 'POST',
        body: { name: trimmed, description, public: isPublic },
    });
    await fetchSciXLibraries(true);
    return created?.id || null;
}

export async function resolveArxivBibcodes(arxivIds) {
    const uniqueIds = [...new Set(arxivIds.map(normalizeArxivId).filter(Boolean))];
    const resolved = new Map();
    if (uniqueIds.length === 0) {
        return resolved;
    }

    for (let i = 0; i < uniqueIds.length; i += 40) {
        const chunk = uniqueIds.slice(i, i + 40);
        const query = `identifier:(${chunk.map((id) => `arXiv:${id}`).join(' OR ')})`;
        const params = new URLSearchParams({
            q: query,
            fl: 'bibcode,identifier,alternate_bibcode',
            rows: String(chunk.length * 2),
        });
        const data = await scixRequest(`/v1/search/query?${params.toString()}`);
        const docs = data?.response?.docs || [];
        const chunkSet = new Set(chunk);

        for (const doc of docs) {
            if (!doc?.bibcode) {
                continue;
            }
            const identifiers = Array.isArray(doc.identifier) ? doc.identifier : [];
            for (const rawIdent of identifiers) {
                if (!/^arXiv:/i.test(rawIdent)) {
                    continue;
                }
                const clean = normalizeArxivId(rawIdent);
                if (chunkSet.has(clean) && !resolved.has(clean)) {
                    resolved.set(clean, doc.bibcode);
                }
            }
        }
    }
    return resolved;
}

export async function addBibcodesToLibrary(libraryId, bibcodes) {
    const clean = [...new Set((bibcodes || []).filter(Boolean))];
    if (clean.length === 0) {
        return null;
    }
    return scixRequest(`/v1/biblib/documents/${encodeURIComponent(libraryId)}`, {
        method: 'POST',
        body: { bibcode: clean, action: 'add' },
    });
}

function recordAddedPaper(arxivId, bibcode, libIds) {
    const cleanId = normalizeArxivId(arxivId);
    const prev = state.scix.added[cleanId]?.libIds || [];
    state.scix.added[cleanId] = {
        bibcode,
        libIds: [...new Set([...prev, ...libIds])],
        addedAt: Date.now(),
    };
    state.scix.queue = state.scix.queue.filter((item) => item.id !== cleanId);
}

export async function sendPaperToSciX(paper, targetLibIds) {
    const cleanId = normalizeArxivId(paper.id);
    const libIds = [...new Set((targetLibIds || []).filter(Boolean))];
    if (libIds.length === 0) {
        throw new Error('Select at least one SciX library');
    }

    const existingBibcode = state.scix.added[cleanId]?.bibcode;
    let bibcode = existingBibcode || null;
    if (!bibcode) {
        const resolved = await resolveArxivBibcodes([cleanId]);
        bibcode = resolved.get(cleanId) || null;
    }

    if (bibcode) {
        await Promise.all(libIds.map((libId) => addBibcodesToLibrary(libId, [bibcode])));
        recordAddedPaper(cleanId, bibcode, libIds);
        scheduleSave();
        return { status: 'added', bibcode, libIds };
    }

    const entry = {
        id: cleanId,
        title: paper.title || '',
        authors: (paper.authors || []).slice(0, 4),
        nAuthors: paper.nAuthors || (paper.authors || []).length,
        date: paper.date || pool.date || new Date().toISOString().slice(0, 10),
        cats: paper.cats || [],
        targetLibIds: libIds,
        addedAt: Date.now(),
        bibcode: null,
        status: 'pending',
    };

    const idx = state.scix.queue.findIndex((item) => item.id === cleanId);
    if (idx >= 0) {
        state.scix.queue[idx] = { ...state.scix.queue[idx], ...entry };
    } else {
        state.scix.queue.unshift(entry);
    }
    scheduleSave();
    return { status: 'queued', libIds };
}

export async function refreshSciXQueue() {
    if (!hasSciXToken() || state.scix.queue.length === 0) {
        return { readyCount: 0, pendingCount: 0, newlyReadyCount: 0 };
    }

    const pendingIds = state.scix.queue
        .filter((item) => item.status !== 'ready')
        .map((item) => item.id);

    let newlyReadyCount = 0;
    if (pendingIds.length > 0) {
        const resolved = await resolveArxivBibcodes(pendingIds);
        for (const item of state.scix.queue) {
            const bibcode = resolved.get(item.id);
            if (bibcode && item.status !== 'ready') {
                item.bibcode = bibcode;
                item.status = 'ready';
                newlyReadyCount += 1;
            }
        }
        if (newlyReadyCount > 0) {
            scheduleSave();
        }
    }

    const readyCount = state.scix.queue.filter((item) => item.status === 'ready').length;
    const pendingCount = state.scix.queue.length - readyCount;
    return { readyCount, pendingCount, newlyReadyCount };
}

export async function commitQueueItem(arxivId, overrideLibIds) {
    const cleanId = normalizeArxivId(arxivId);
    const item = state.scix.queue.find((entry) => entry.id === cleanId);
    if (!item) {
        return null;
    }

    const libIds = [...new Set((overrideLibIds || item.targetLibIds || []).filter(Boolean))];
    if (libIds.length === 0) {
        throw new Error('Select at least one SciX library');
    }

    let bibcode = item.bibcode;
    if (!bibcode) {
        const resolved = await resolveArxivBibcodes([cleanId]);
        bibcode = resolved.get(cleanId) || null;
    }
    if (!bibcode) {
        return { status: 'pending' };
    }

    await Promise.all(libIds.map((libId) => addBibcodesToLibrary(libId, [bibcode])));
    recordAddedPaper(cleanId, bibcode, libIds);
    scheduleSave();
    return { status: 'added', bibcode, libIds };
}

export async function commitAllReadyQueueItems() {
    const readyItems = state.scix.queue.filter((item) => item.status === 'ready' && item.bibcode);
    if (readyItems.length === 0) {
        return 0;
    }

    const byLibrary = new Map();
    for (const item of readyItems) {
        for (const libId of item.targetLibIds || []) {
            if (!byLibrary.has(libId)) {
                byLibrary.set(libId, []);
            }
            byLibrary.get(libId).push(item.bibcode);
        }
    }

    await Promise.all(
        [...byLibrary.entries()].map(([libId, bibcodes]) => addBibcodesToLibrary(libId, bibcodes))
    );

    for (const item of readyItems) {
        recordAddedPaper(item.id, item.bibcode, item.targetLibIds || []);
    }
    scheduleSave();
    return readyItems.length;
}

export function removeFromSciXQueue(arxivId) {
    const cleanId = normalizeArxivId(arxivId);
    state.scix.queue = state.scix.queue.filter((item) => item.id !== cleanId);
    scheduleSave();
}
