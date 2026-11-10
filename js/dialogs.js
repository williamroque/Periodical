import { DEFAULT_STATE, STORAGE_KEY } from './config.js';
import { ICONS } from './icons.js';
import { abbreviateAuthorName, clamp, escapeHtml, formatIsoDate, select } from './utils.js';
import { decodedVectorCache } from './vectors.js';
import {
    flushState,
    getCurrentPaper,
    getSavedIdSet,
    pool,
    replaceState,
    scheduleSave,
    state,
} from './state.js';
import { buildDailyStack, rerankRemainingStack } from './ranking.js';
import { copyTextToClipboard, downloadOrShareFile, formatBibtex } from './bibtex.js';
import { applyThemePreference, showToast } from './ui.js';
import { removeFromLibrary } from './actions.js';
import {
    buildCategoryChipsHtml,
    collectSelectedCategories,
    handleChipClick,
    renderApp,
    updateDockButtons,
} from './views.js';

const libraryDialog = select('#library');
const settingsDialog = select('#settings');
let settingsDraft = null;

export function renderLibraryBadge() {
    const unexportedCount = state.lib.filter((entry) => !entry.exported).length;
    const badgeHtml = unexportedCount > 0 ? `<span class='badge'>${unexportedCount}</span>` : '';
    select('#libBtn').innerHTML = ICONS.library + badgeHtml;
    const statusText = unexportedCount > 0 ? ` · ${unexportedCount} not yet exported` : '';
    select('#libBtn').title = `Library${statusText} (L)`;
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
        return `
            <div class='lib-item${newClass}' data-id='${escapeHtml(entry.id)}'>
                <h4>${escapeHtml(entry.title)}</h4>
                <p>${escapeHtml(leadAuthors + etAl)} · <span class='arxiv-id'>${escapeHtml(entry.id)}</span> · ${escapeHtml(dateLabel)}</p>
                <div class='lib-actions'>
                    <a href='https://arxiv.org/pdf/${escapeHtml(entry.id)}' target='_blank' rel='noopener'>PDF</a>
                    <a href='https://arxiv.org/abs/${escapeHtml(entry.id)}' target='_blank' rel='noopener'>arXiv</a>
                    <button data-act='copy'>Copy BibTeX</button>
                    <button data-act='remove' class='danger'>Remove</button>
                </div>
            </div>`;
    }).join('');
}

export function openLibraryDialog() {
    renderLibraryList();
    libraryDialog.showModal();
}

export function openSettingsDialog() {
    settingsDraft = { theme: state.theme };
    select('#setPrompt').value = state.prompt;
    select('#setCats').innerHTML = buildCategoryChipsHtml(state.cats);
    select('#setLimit').value = state.limit;
    select('#setLimitVal').textContent = state.limit;
    updateThemeControlButtons(state.theme);

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
    select('#libList').addEventListener('click', (event) => {
        const actionBtn = event.target.closest('button[data-act]');
        if (!actionBtn) {
            return;
        }
        const paperId = actionBtn.closest('.lib-item').dataset.id;
        const entry = state.lib.find((item) => item.id === paperId);
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

    select('#setCats').addEventListener('click', handleChipClick);
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
        const nextCats = collectSelectedCategories(select('#setCats'));
        const nextLimit = clamp(Number(select('#setLimit').value) || 10, 3, 30);
        const hasRankingChange = (
            nextPrompt !== state.prompt ||
            nextLimit !== state.limit ||
            nextCats.join() !== state.cats.join()
        );

        state.prompt = nextPrompt;
        state.cats = nextCats;
        state.limit = nextLimit;
        state.theme = settingsDraft.theme;
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
            if (!state.day || state.day.date !== pool.date) {
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
