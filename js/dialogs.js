import { DAY_OFFSET_OPTIONS, DEFAULT_SCIX_PROXY, DEFAULT_STATE, RANKING_CRITERIA, RANKING_PRESETS, SORT_MODES, STORAGE_KEY } from './config.js';
import { ICONS } from './icons.js';
import { abbreviateAuthorName, clamp, escapeHtml, formatIsoDate, parseKeywords, select } from './utils.js';
import { decodedVectorCache } from './vectors.js';
import {
    activateDayStack,
    archiveState,
    flushState,
    getCurrentPaper,
    getSavedIdSet,
    ingestDailyFeed,
    normalizeRankingConfig,
    pool,
    replaceState,
    scheduleSave,
    state,
    stopDwellTimer,
} from './state.js';
import { buildDailyStack, rerankRemainingStack } from './ranking.js';
import { copyTextToClipboard, downloadOrShareFile, formatBibtex } from './bibtex.js';
import { applyThemePreference, showToast } from './ui.js';
import { removeFromLibrary } from './actions.js';
import {
    commitAllReadyQueueItems,
    commitQueueItem,
    createSciXLibrary,
    fetchSciXLibraries,
    getSciXAbsUrl,
    hasSciXToken,
    normalizeArxivId,
    refreshSciXQueue,
    removeFromSciXQueue,
    sendPaperToSciX,
} from './scix.js';
import {
    buildCategoryChipsHtml,
    buildQuartileChipsHtml,
    buildSourceChipsHtml,
    collectSelectedCategories,
    collectSelectedQuartiles,
    collectSelectedSources,
    handleChipClick,
    renderApp,
    updateDockButtons,
} from './views.js';

const libraryDialog = select('#library');
const settingsDialog = select('#settings');
const archiveDialog = select('#archive');
const scixPickerDialog = select('#scixPicker');
let settingsDraft = null;
let isSwitchingArchiveDay = false;
let activeLibraryTab = 'saved';
let activeSciXPaper = null;

function getLibraryNamesById(libIds) {
    const byId = new Map((state.scix?.libraries || []).map((lib) => [lib.id, lib.name]));
    return (libIds || []).map((id) => byId.get(id) || id);
}

export function renderLibraryBadge() {
    const unexportedCount = state.lib.filter((entry) => !entry.exported).length;
    const readySciXCount = (state.scix?.queue || []).filter((item) => item.status === 'ready').length;
    const totalQueueCount = (state.scix?.queue || []).length;
    const badgeCount = unexportedCount + readySciXCount;
    const badgeHtml = badgeCount > 0 ? `<span class='badge'>${badgeCount}</span>` : '';
    select('#libBtn').innerHTML = ICONS.library + badgeHtml;

    const parts = [];
    if (unexportedCount > 0) {
        parts.push(`${unexportedCount} not yet exported`);
    }
    if (readySciXCount > 0) {
        parts.push(`${readySciXCount} ready for SciX`);
    }
    const statusText = parts.length > 0 ? ` · ${parts.join(', ')}` : '';
    select('#libBtn').title = `Library${statusText} (L)`;

    const tabCountEl = select('#scixQueueTabCount');
    if (tabCountEl) {
        tabCountEl.textContent = totalQueueCount > 0 ? `(${totalQueueCount})` : '';
    }
}

export function renderLibraryList() {
    const unexported = state.lib.filter((entry) => !entry.exported);
    const total = state.lib.length;
    select('#libCount').textContent = total > 0 ? `${total} paper${total > 1 ? 's' : ''}` : '';
    select('#libTools').hidden = total === 0;

    const exportLabel = unexported.length > 0 && unexported.length < total
        ? `Export ${unexported.length} new to Zotero`
        : 'Export to Zotero';
    select('#exportBtn').innerHTML = `${ICONS.download}<span>${exportLabel}</span>`;
    select('#libFilter').hidden = total < 8;

    const filterQuery = select('#libFilter').value.trim().toLowerCase();
    const filtered = state.lib.filter((entry) => {
        if (!filterQuery) {
            return true;
        }
        const haystack = `${entry.title} ${entry.authors.join(' ')} ${entry.id}`.toLowerCase();
        return haystack.includes(filterQuery);
    });

    if (total === 0) {
        select('#libList').innerHTML = (
            `<div class='empty'>` +
            `<b>Nothing saved yet</b>` +
            `Swipe right or press → on a paper worth keeping.<br>It lands here, ready for Zotero.` +
            `</div>`
        );
        return;
    }

    select('#libList').innerHTML = filtered.map((entry) => {
        const newClass = entry.exported ? '' : ' new';
        const leadAuthors = entry.authors.slice(0, 2).map(abbreviateAuthorName).join(', ');
        const etAl = entry.nAuthors > 2 ? ' et al.' : '';
        const dateLabel = formatIsoDate(entry.date, { day: 'numeric', month: 'short' });
        const cleanId = normalizeArxivId(entry.id);
        const addedEntry = state.scix?.added?.[cleanId];
        const queuedEntry = (state.scix?.queue || []).find((item) => item.id === cleanId);
        const scixBtnLabel = addedEntry ? 'In SciX ✓' : (queuedEntry ? 'Queued' : '+ SciX');
        const libNamesLine = addedEntry && addedEntry.libIds?.length
            ? `<div class='lib-item-libs'>SciX: ${escapeHtml(getLibraryNamesById(addedEntry.libIds).join(', '))}</div>`
            : '';

        return `
            <div class='lib-item${newClass}' data-id='${escapeHtml(entry.id)}'>
                <h4>${escapeHtml(entry.title)}</h4>
                <p>${escapeHtml(leadAuthors + etAl)} · <span class='arxiv-id'>${escapeHtml(entry.id)}</span> · ${escapeHtml(dateLabel)}</p>
                ${libNamesLine}
                <div class='lib-actions'>
                    <a href='https://arxiv.org/pdf/${escapeHtml(entry.id)}' target='_blank' rel='noopener'>PDF</a>
                    <a href='https://arxiv.org/abs/${escapeHtml(entry.id)}' target='_blank' rel='noopener'>arXiv</a>
                    <a href='${getSciXAbsUrl(entry.id)}' target='_blank' rel='noopener'>SciX</a>
                    <button data-act='scix'>${scixBtnLabel}</button>
                    <button data-act='copy'>Copy BibTeX</button>
                    <button data-act='remove' class='danger'>Remove</button>
                </div>
            </div>`;
    }).join('');
}

export function renderSciXQueueList() {
    const queue = state.scix?.queue || [];
    const readyItems = queue.filter((item) => item.status === 'ready');
    const addAllBtn = select('#scixAddAllBtn');
    const checkBtn = select('#scixCheckBtn');
    select('#scixQueueTools').hidden = queue.length === 0;
    addAllBtn.disabled = readyItems.length === 0;
    addAllBtn.textContent = readyItems.length > 0 ? `Add all ready (${readyItems.length})` : 'Add all ready';
    checkBtn.disabled = !hasSciXToken() || queue.length === 0;

    if (queue.length === 0) {
        select('#scixQueueList').innerHTML = (
            `<div class='empty'>` +
            `<b>No papers waiting</b>` +
            `When you send a brand-new preprint to SciX before it’s indexed, it waits here until ready.` +
            `</div>`
        );
        return;
    }

    const sorted = [...queue].sort((a, b) => {
        if (a.status === 'ready' && b.status !== 'ready') {
            return -1;
        }
        if (b.status === 'ready' && a.status !== 'ready') {
            return 1;
        }
        return (b.addedAt || 0) - (a.addedAt || 0);
    });

    select('#scixQueueList').innerHTML = sorted.map((item) => {
        const isReady = item.status === 'ready';
        const pillClass = isReady ? 'ready' : 'pending';
        const pillText = isReady ? 'Ready in SciX' : 'Waiting for SciX';
        const leadAuthors = (item.authors || []).slice(0, 2).map(abbreviateAuthorName).join(', ');
        const etAl = (item.nAuthors || 0) > 2 ? ' et al.' : '';
        const targetNames = getLibraryNamesById(item.targetLibIds).join(', ') || 'No library selected';
        const primaryAction = isReady
            ? `<button data-qact='commit'>Add to SciX</button>`
            : `<button data-qact='check'>Check now</button>`;

        return `
            <div class='lib-item${isReady ? ' new' : ''}' data-qid='${escapeHtml(item.id)}'>
                <h4>${escapeHtml(item.title || item.id)}<span class='scix-pill ${pillClass}'>${pillText}</span></h4>
                <p>${escapeHtml(leadAuthors + etAl)} · <span class='arxiv-id'>${escapeHtml(item.id)}</span></p>
                <div class='lib-item-libs'>Libraries: ${escapeHtml(targetNames)}</div>
                <div class='lib-actions'>
                    ${primaryAction}
                    <button data-qact='edit'>Edit libraries</button>
                    <a href='${getSciXAbsUrl(item.id)}' target='_blank' rel='noopener'>SciX</a>
                    <button data-qact='remove' class='danger'>Remove</button>
                </div>
            </div>`;
    }).join('');
}

export function switchLibraryTab(tab = 'saved') {
    activeLibraryTab = tab === 'scix' ? 'scix' : 'saved';
    select('#libTabs').querySelectorAll('button[data-tab]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.tab === activeLibraryTab));
    });
    select('#libSavedPanel').hidden = activeLibraryTab !== 'saved';
    select('#scixQueuePanel').hidden = activeLibraryTab !== 'scix';
    if (activeLibraryTab === 'scix') {
        renderSciXQueueList();
    } else {
        renderLibraryList();
    }
}

export function openLibraryDialog(initialTab = 'saved') {
    switchLibraryTab(initialTab);
    renderLibraryBadge();
    libraryDialog.showModal();
}

function renderSciXPickerLibraries(selectedIds) {
    const libs = state.scix?.libraries || [];
    const selectedSet = new Set(selectedIds || []);
    if (libs.length === 0) {
        select('#scixPickLibs').innerHTML = `<p class='hint' style='margin: 6px 0 0'>No SciX libraries found yet. Create one below.</p>`;
        return;
    }
    select('#scixPickLibs').innerHTML = libs.map((lib) => `
        <label class='scix-pick-opt'>
            <span class='scix-pick-opt-left'>
                <input type='checkbox' value='${escapeHtml(lib.id)}' ${selectedSet.has(lib.id) ? 'checked' : ''}>
                <span>${escapeHtml(lib.name)}</span>
            </span>
            <span class='scix-pick-count'>${lib.num_documents}</span>
        </label>
    `).join('');
}

export async function openSciXPicker(paper) {
    if (!paper) {
        return;
    }
    activeSciXPaper = paper;
    const cleanId = normalizeArxivId(paper.id);
    select('#scixPickPaper').textContent = paper.title || cleanId;
    select('#scixNewLibName').value = '';

    const tokenPresent = hasSciXToken();
    select('#scixPickBody').hidden = !tokenPresent;
    select('#scixPickNoToken').hidden = tokenPresent;
    select('#scixPickSubmit').hidden = !tokenPresent;

    if (!tokenPresent) {
        scixPickerDialog.showModal();
        return;
    }

    const existingAdded = state.scix?.added?.[cleanId]?.libIds;
    const existingQueued = (state.scix?.queue || []).find((item) => item.id === cleanId)?.targetLibIds;
    const preselected = existingQueued || existingAdded || state.scix?.defaultLibIds || [];

    renderSciXPickerLibraries(preselected);
    scixPickerDialog.showModal();

    if ((state.scix?.libraries || []).length === 0) {
        try {
            await fetchSciXLibraries(true);
            renderSciXPickerLibraries(preselected);
        } catch (err) {
            showToast(err.message || 'Could not load SciX libraries');
        }
    }
}

function renderSciXSettingsControls() {
    select('#setScixToken').value = state.scix?.token || '';
    select('#setScixProxy').value = state.scix?.proxyUrl || DEFAULT_SCIX_PROXY;
    const libs = state.scix?.libraries || [];
    const statusEl = select('#scixStatus');
    const wrapEl = select('#setScixDefaultLibsWrap');

    if (!hasSciXToken()) {
        statusEl.textContent = 'Not connected · enter your SciX API token above';
        wrapEl.hidden = true;
        return;
    }
    statusEl.textContent = libs.length > 0
        ? `Connected · ${libs.length} librar${libs.length === 1 ? 'y' : 'ies'} loaded`
        : 'Token saved · click Connect to load libraries';

    wrapEl.hidden = libs.length === 0;
    if (libs.length > 0) {
        const defaultSet = new Set(state.scix?.defaultLibIds || []);
        select('#setScixDefaultLibs').innerHTML = libs.map((lib) => (
            `<button type='button' class='chip' data-scix-lib='${escapeHtml(lib.id)}' aria-pressed='${defaultSet.has(lib.id)}'>` +
            `${escapeHtml(lib.name)}` +
            `</button>`
        )).join('');
    }
}

export function renderArchiveList() {
    const days = archiveState.days.length > 0
        ? archiveState.days
        : (pool.date ? [{ date: pool.date, count: pool.papers.length }] : []);

    select('#arcCount').textContent = days.length > 0 ? `${days.length} day${days.length > 1 ? 's' : ''}` : '';

    if (days.length === 0) {
        select('#arcList').innerHTML = `<div class='empty'><b>No archive yet</b>Run pipeline.py to build the archive.</div>`;
        return;
    }

    select('#arcList').innerHTML = days.map((entry) => {
        const isCurrent = entry.date === pool.date;
        const isToday = entry.date === archiveState.todayDate;
        const dateTitle = formatIsoDate(entry.date, { weekday: 'short', day: 'numeric', month: 'short' });
        const subTitle = isToday ? 'Today' : `${entry.count} papers`;

        const dayStack = (state.day && state.day.date === entry.date)
            ? state.day
            : state.days?.[entry.date];
        let progressText = `${entry.count} papers`;
        if (dayStack && dayStack.ids.length > 0) {
            progressText = dayStack.i >= dayStack.ids.length
                ? 'Caught up'
                : `Paper ${dayStack.i + 1} of ${dayStack.ids.length}`;
        }

        return `
            <button class='arc-item' data-date='${escapeHtml(entry.date)}' aria-current='${isCurrent ? 'date' : 'false'}'>
                <span class='arc-date'>
                    <b>${escapeHtml(dateTitle)}</b>
                    <span>${escapeHtml(subTitle)}</span>
                </span>
                <span class='arc-meta'>${escapeHtml(progressText)}</span>
            </button>`;
    }).join('');
}

export function openArchiveDialog() {
    renderArchiveList();
    archiveDialog.showModal();
}

async function selectArchiveDate(date) {
    if (isSwitchingArchiveDay) {
        return;
    }
    if (date === pool.date) {
        archiveDialog.close();
        return;
    }

    isSwitchingArchiveDay = true;
    try {
        stopDwellTimer();
        flushState();
        const url = date === archiveState.todayDate ? 'data/today.json' : `data/archive/${date}.json`;
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        ingestDailyFeed(await response.json());
        if (state.onboarded && pool.papers.length > 0 && !activateDayStack(pool.date)) {
            buildDailyStack();
        }
        flushState();
        archiveDialog.close();
        renderApp('in');
    } catch (err) {
        console.warn('Could not load archive feed', err);
        showToast('Could not load that day’s papers');
    } finally {
        isSwitchingArchiveDay = false;
    }
}

function formatWeightLabel(val) {
    return val <= 0 ? 'Off' : `${val.toFixed(1)}×`;
}

function findMatchingPresetId(ranking) {
    if (ranking.sortBy !== 'weighted') {
        return '';
    }
    const match = RANKING_PRESETS.find((preset) => (
        Object.keys(preset.weights).every(
            (key) => Math.abs((ranking.weights[key] ?? 0) - preset.weights[key]) < 0.05
        )
    ));
    return match ? match.id : '';
}

function renderRankingControls(ranking) {
    const sortEl = select('#setSortBy');
    sortEl.innerHTML = SORT_MODES.map(
        (mode) => `<option value='${escapeHtml(mode.id)}'>${escapeHtml(mode.label)}</option>`
    ).join('');
    sortEl.value = ranking.sortBy;

    const activePresetId = findMatchingPresetId(ranking);
    select('#setRankPresets').innerHTML = RANKING_PRESETS.map((preset) => (
        `<button type='button' class='chip' data-preset='${escapeHtml(preset.id)}' aria-pressed='${preset.id === activePresetId}'>` +
        `${escapeHtml(preset.label)}` +
        `</button>`
    )).join('');

    const weightsEl = select('#setRankWeights');
    weightsEl.innerHTML = RANKING_CRITERIA.map((item) => {
        const val = ranking.weights[item.key] ?? 0;
        return (
            `<label class='weight-row'>` +
            `<span>${escapeHtml(item.label)}</span>` +
            `<input type='range' min='0' max='2' step='0.1' data-weight='${escapeHtml(item.key)}' value='${val}'>` +
            `<span class='weight-val'>${formatWeightLabel(val)}</span>` +
            `</label>`
        );
    }).join('');
    weightsEl.classList.toggle('disabled', ranking.sortBy !== 'weighted');
}

export function openSettingsDialog() {
    const ranking = normalizeRankingConfig(state.ranking);
    settingsDraft = { theme: state.theme, ranking };
    select('#setPrompt').value = state.prompt;
    select('#setSources').innerHTML = buildSourceChipsHtml(state.sources || []);
    select('#setKeywords').value = (state.keywords || []).join(', ');
    select('#setCats').innerHTML = buildCategoryChipsHtml(state.cats);
    select('#setQuartiles').innerHTML = buildQuartileChipsHtml(state.quartiles || []);
    renderRankingControls(ranking);
    select('#setLimit').value = state.limit;
    select('#setLimitVal').textContent = state.limit;
    const dayOffsetEl = select('#setDayOffset');
    dayOffsetEl.innerHTML = DAY_OFFSET_OPTIONS.map(
        (opt) => `<option value='${opt.value}'>${escapeHtml(opt.label)}</option>`
    ).join('');
    dayOffsetEl.value = String(state.preferredDayOffset || 0);
    updateThemeControlButtons(state.theme);
    renderSciXSettingsControls();

    const allSignals = Object.values(state.mem);
    const posCount = allSignals.filter((m) => m.w > 0).length;
    const negCount = allSignals.length - posCount;
    select('#setStats').textContent = (
        `Learned from ${posCount} positive and ${negCount} negative signals · ${state.lib.length} saved`
    );
    settingsDialog.showModal();
}

export function updateThemeControlButtons(activeTheme) {
    select('#setTheme').querySelectorAll('button').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.v === activeTheme));
    });
}

export function initDialogs() {
    select('#arcList').addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-date]');
        if (btn) {
            selectArchiveDate(btn.dataset.date);
        }
    });

    select('#libTabs').addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-tab]');
        if (btn) {
            switchLibraryTab(btn.dataset.tab);
        }
    });

    select('#libList').addEventListener('click', (event) => {
        const actionBtn = event.target.closest('button[data-act]');
        if (!actionBtn) {
            return;
        }
        const paperId = actionBtn.closest('.lib-item').dataset.id;
        const entry = state.lib.find((item) => item.id === paperId);
        if (actionBtn.dataset.act === 'scix' && entry) {
            openSciXPicker(entry);
            return;
        }
        if (actionBtn.dataset.act === 'copy' && entry) {
            const ok = copyTextToClipboard(formatBibtex([entry]));
            showToast(ok ? 'BibTeX copied' : 'Clipboard unavailable');
            entry.exported = true;
        } else if (actionBtn.dataset.act === 'remove') {
            removeFromLibrary(paperId);
            const currentPaper = getCurrentPaper();
            if (currentPaper) {
                updateDockButtons(currentPaper, state.day.ph[currentPaper.id] ?? 0, getSavedIdSet().has(currentPaper.id));
            }
        }
        scheduleSave();
        renderLibraryList();
        renderLibraryBadge();
    });

    select('#scixQueueList').addEventListener('click', async (event) => {
        const actionBtn = event.target.closest('button[data-qact]');
        if (!actionBtn) {
            return;
        }
        const qid = actionBtn.closest('.lib-item').dataset.qid;
        const qItem = (state.scix?.queue || []).find((item) => item.id === qid);
        const act = actionBtn.dataset.qact;

        if (act === 'remove') {
            removeFromSciXQueue(qid);
            renderSciXQueueList();
            renderLibraryBadge();
            return;
        }
        if (act === 'edit' && qItem) {
            openSciXPicker(qItem);
            return;
        }
        if (act === 'check') {
            actionBtn.disabled = true;
            try {
                const res = await refreshSciXQueue();
                renderSciXQueueList();
                renderLibraryBadge();
                showToast(res.newlyReadyCount > 0 ? 'Paper is now available in SciX' : 'Still waiting for SciX indexing');
            } catch (err) {
                showToast(err.message || 'Could not check SciX');
            } finally {
                actionBtn.disabled = false;
            }
            return;
        }
        if (act === 'commit' && qItem) {
            actionBtn.disabled = true;
            try {
                const res = await commitQueueItem(qid);
                if (res?.status === 'added') {
                    showToast('Added to SciX');
                }
                renderSciXQueueList();
                renderLibraryBadge();
            } catch (err) {
                showToast(err.message || 'Could not add to SciX');
            } finally {
                actionBtn.disabled = false;
            }
        }
    });

    select('#scixAddAllBtn').onclick = async () => {
        const btn = select('#scixAddAllBtn');
        btn.disabled = true;
        try {
            const count = await commitAllReadyQueueItems();
            showToast(`Added ${count} paper${count === 1 ? '' : 's'} to SciX`);
            renderSciXQueueList();
            renderLibraryBadge();
        } catch (err) {
            showToast(err.message || 'Could not add papers to SciX');
        } finally {
            btn.disabled = false;
        }
    };

    select('#scixCheckBtn').onclick = async () => {
        const btn = select('#scixCheckBtn');
        btn.disabled = true;
        try {
            const res = await refreshSciXQueue();
            renderSciXQueueList();
            renderLibraryBadge();
            if (res.readyCount > 0) {
                showToast(`${res.readyCount} paper${res.readyCount === 1 ? '' : 's'} ready in SciX`);
            } else {
                showToast('No new SciX records yet');
            }
        } catch (err) {
            showToast(err.message || 'Could not check SciX');
        } finally {
            btn.disabled = false;
        }
    };

    select('#scixNewLibBtn').onclick = async () => {
        const input = select('#scixNewLibName');
        const name = input.value.trim();
        if (!name) {
            showToast('Enter a library name');
            return;
        }
        const btn = select('#scixNewLibBtn');
        btn.disabled = true;
        try {
            const newId = await createSciXLibrary(name);
            input.value = '';
            const currentChecked = [...select('#scixPickLibs').querySelectorAll('input:checked')].map((el) => el.value);
            if (newId) {
                currentChecked.push(newId);
            }
            renderSciXPickerLibraries(currentChecked);
            showToast(`Created library "${name}"`);
        } catch (err) {
            showToast(err.message || 'Could not create SciX library');
        } finally {
            btn.disabled = false;
        }
    };

    select('#scixPickSubmit').onclick = async () => {
        if (!activeSciXPaper) {
            return;
        }
        const selectedLibIds = [...select('#scixPickLibs').querySelectorAll('input:checked')].map((el) => el.value);
        if (selectedLibIds.length === 0) {
            showToast('Select at least one library');
            return;
        }
        const btn = select('#scixPickSubmit');
        btn.disabled = true;
        try {
            const res = await sendPaperToSciX(activeSciXPaper, selectedLibIds);
            scixPickerDialog.close();
            if (res.status === 'added') {
                showToast(`Added to ${res.libIds.length} SciX librar${res.libIds.length === 1 ? 'y' : 'ies'}`);
            } else {
                showToast('Not yet in SciX — added to SciX Queue');
            }
            renderLibraryBadge();
            if (libraryDialog.open) {
                if (activeLibraryTab === 'scix') {
                    renderSciXQueueList();
                } else {
                    renderLibraryList();
                }
            }
            const currentPaper = getCurrentPaper();
            if (currentPaper && normalizeArxivId(currentPaper.id) === normalizeArxivId(activeSciXPaper.id)) {
                const cardBtn = document.querySelector('#stage [data-scix]');
                if (cardBtn) {
                    cardBtn.textContent = res.status === 'added' ? 'In SciX ✓' : 'Queued in SciX';
                }
            }
        } catch (err) {
            showToast(err.message || 'Could not send to SciX');
        } finally {
            btn.disabled = false;
        }
    };

    select('#scixOpenSettingsBtn').onclick = () => {
        scixPickerDialog.close();
        openSettingsDialog();
    };

    select('#libFilter').addEventListener('input', renderLibraryList);

    select('#exportBtn').onclick = async () => {
        const unexported = state.lib.filter((entry) => !entry.exported);
        const entriesToExport = unexported.length > 0 ? unexported : state.lib;
        const todayIso = new Date().toISOString().slice(0, 10);
        const suffix = unexported.length > 0 && unexported.length < state.lib.length ? '-new' : '';
        const filename = `arxiv-${todayIso}${suffix}.bib`;

        const delivered = await downloadOrShareFile(formatBibtex(entriesToExport), filename, 'application/x-bibtex');
        if (!delivered) {
            return;
        }
        for (const entry of entriesToExport) {
            entry.exported = true;
        }
        scheduleSave();
        renderLibraryList();
        renderLibraryBadge();
        const plural = entriesToExport.length > 1 ? 's' : '';
        showToast(`${entriesToExport.length} reference${plural} exported`);
    };

    select('#copyAllBtn').onclick = () => {
        const unexported = state.lib.filter((entry) => !entry.exported);
        const entriesToCopy = unexported.length > 0 ? unexported : state.lib;
        if (!copyTextToClipboard(formatBibtex(entriesToCopy))) {
            showToast('Clipboard unavailable');
            return;
        }
        for (const entry of entriesToCopy) {
            entry.exported = true;
        }
        scheduleSave();
        renderLibraryList();
        renderLibraryBadge();
        showToast(`Copied ${entriesToCopy.length} — in Zotero: Import from Clipboard`);
    };

    select('#setSources').addEventListener('click', handleChipClick);
    select('#setCats').addEventListener('click', handleChipClick);
    select('#setQuartiles').addEventListener('click', handleChipClick);
    select('#setScixDefaultLibs').addEventListener('click', handleChipClick);

    select('#scixConnectBtn').onclick = async () => {
        const btn = select('#scixConnectBtn');
        state.scix.token = select('#setScixToken').value.trim();
        state.scix.proxyUrl = select('#setScixProxy').value.trim() || DEFAULT_SCIX_PROXY;
        scheduleSave();

        if (!hasSciXToken()) {
            renderSciXSettingsControls();
            showToast('Enter a SciX API token first');
            return;
        }
        btn.disabled = true;
        select('#scixStatus').textContent = 'Connecting to SciX…';
        try {
            const libs = await fetchSciXLibraries(true);
            renderSciXSettingsControls();
            showToast(`Connected · ${libs.length} SciX librar${libs.length === 1 ? 'y' : 'ies'}`);
        } catch (err) {
            select('#scixStatus').textContent = err.message || 'Connection failed';
            showToast(err.message || 'Could not connect to SciX');
        } finally {
            btn.disabled = false;
        }
    };

    select('#setSortBy').addEventListener('change', (event) => {
        if (!settingsDraft) {
            return;
        }
        settingsDraft.ranking.sortBy = event.target.value;
        renderRankingControls(settingsDraft.ranking);
    });

    select('#setRankPresets').addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-preset]');
        if (!btn || !settingsDraft) {
            return;
        }
        const preset = RANKING_PRESETS.find((item) => item.id === btn.dataset.preset);
        if (!preset) {
            return;
        }
        settingsDraft.ranking = {
            sortBy: preset.sortBy,
            weights: { ...preset.weights },
        };
        renderRankingControls(settingsDraft.ranking);
    });

    select('#setRankWeights').addEventListener('input', (event) => {
        const input = event.target.closest('input[data-weight]');
        if (!input || !settingsDraft) {
            return;
        }
        const val = Number(input.value);
        settingsDraft.ranking.weights[input.dataset.weight] = val;
        input.nextElementSibling.textContent = formatWeightLabel(val);
        const activePresetId = findMatchingPresetId(settingsDraft.ranking);
        select('#setRankPresets').querySelectorAll('button[data-preset]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.preset === activePresetId));
        });
    });

    select('#setLimit').addEventListener('input', (event) => {
        select('#setLimitVal').textContent = event.target.value;
    });

    select('#setTheme').addEventListener('click', (event) => {
        const btn = event.target.closest('button');
        if (!btn) {
            return;
        }
        settingsDraft.theme = btn.dataset.v;
        updateThemeControlButtons(btn.dataset.v);
        applyThemePreference(btn.dataset.v);
    });

    settingsDialog.addEventListener('close', () => {
        if (!settingsDraft) {
            return;
        }
        const nextPrompt = select('#setPrompt').value.trim();
        const nextSources = collectSelectedSources(select('#setSources'));
        const nextKeywords = parseKeywords(select('#setKeywords').value);
        const nextCats = collectSelectedCategories(select('#setCats'));
        const nextQuartiles = collectSelectedQuartiles(select('#setQuartiles'));
        const nextRanking = normalizeRankingConfig(settingsDraft.ranking);
        const prevRanking = normalizeRankingConfig(state.ranking);
        const nextLimit = clamp(Number(select('#setLimit').value) || 10, 3, 30);
        const hasRankingChange = (
            nextPrompt !== state.prompt ||
            nextLimit !== state.limit ||
            nextSources.join() !== (state.sources || []).join() ||
            nextKeywords.join() !== (state.keywords || []).join() ||
            nextCats.join() !== state.cats.join() ||
            nextQuartiles.join() !== (state.quartiles || []).join() ||
            JSON.stringify(nextRanking) !== JSON.stringify(prevRanking)
        );

        state.prompt = nextPrompt;
        state.sources = nextSources;
        state.keywords = nextKeywords;
        state.cats = nextCats;
        state.quartiles = nextQuartiles;
        state.ranking = nextRanking;
        state.limit = nextLimit;
        state.preferredDayOffset = Math.max(0, Number(select('#setDayOffset').value) || 0);
        state.theme = settingsDraft.theme;
        state.scix.token = select('#setScixToken').value.trim();
        state.scix.proxyUrl = select('#setScixProxy').value.trim() || DEFAULT_SCIX_PROXY;
        state.scix.defaultLibIds = [...select('#setScixDefaultLibs').querySelectorAll('.chip[aria-pressed=true]')]
            .map((btn) => btn.dataset.scixLib);
        settingsDraft = null;
        scheduleSave();

        if (hasRankingChange && state.onboarded && state.day) {
            rerankRemainingStack();
            renderApp('in');
            showToast('Re-ranked the rest of today’s stack');
        }
    });

    select('#backupBtn').onclick = () => {
        flushState();
        const filename = `periodical-backup-${new Date().toISOString().slice(0, 10)}.json`;
        downloadOrShareFile(JSON.stringify(state), filename, 'application/json');
    };

    select('#restoreBtn').onclick = () => select('#restoreFile').click();

    select('#restoreFile').onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) {
            return;
        }
        try {
            const parsed = JSON.parse(await file.text());
            if (!parsed || typeof parsed !== 'object' || !('mem' in parsed)) {
                throw new Error('Invalid backup format');
            }
            replaceState({ ...structuredClone(DEFAULT_STATE), ...parsed });
            settingsDraft = null;
            decodedVectorCache.clear();
            if (state.onboarded && pool.papers.length > 0 && !activateDayStack(pool.date)) {
                buildDailyStack();
            }
            flushState();
            settingsDialog.close();
            applyThemePreference(state.theme);
            renderApp('in');
            showToast('Backup restored');
        } catch (err) {
            showToast('That file is not a Periodical backup');
        }
        event.target.value = '';
    };

    select('#resetLearnBtn').onclick = () => {
        if (!confirm('Forget everything learned from your reading? Your library and focus stay.')) {
            return;
        }
        state.mem = {};
        decodedVectorCache.clear();
        scheduleSave();
        openSettingsDialog();
        showToast('Learning reset');
    };

    select('#wipeBtn').onclick = () => {
        if (!confirm('Erase your focus, learning and library from this browser? This cannot be undone.')) {
            return;
        }
        localStorage.removeItem(STORAGE_KEY);
        replaceState(structuredClone(DEFAULT_STATE));
        settingsDraft = null;
        decodedVectorCache.clear();
        settingsDialog.close();
        applyThemePreference('auto');
        renderApp('in');
        showToast('Everything erased');
    };

    select('#keysLink').onclick = () => {
        settingsDialog.close();
        select('#keys').showModal();
    };
}
