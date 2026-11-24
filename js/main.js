import { ICONS } from './icons.js';
import { select } from './utils.js';
import {
    activateDayStack,
    activeDwell,
    archiveState,
    flushState,
    getCurrentPaper,
    ingestDailyFeed,
    pool,
    state,
    stopDwellTimer,
} from './state.js';
import { buildDailyStack } from './ranking.js';
import { copyPaperBibtex } from './bibtex.js';
import { applyThemePreference, openFigureLightbox } from './ui.js';
import {
    collapseCurrentCard,
    expandCurrentCard,
    goToPreviousPaper,
    jumpToPaperIndex,
    openCurrentPdf,
    saveCurrentPaper,
    skipCurrentPaper,
    stepDeeper,
} from './actions.js';
import { renderApp, renderEmptyView, stageEl } from './views.js';
import { initDialogs, openArchiveDialog, openLibraryDialog, openSettingsDialog } from './dialogs.js';

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopDwellTimer();
        flushState();
    } else if (activeDwell.id) {
        activeDwell.startedAt = performance.now();
    }
});

window.addEventListener('pagehide', () => {
    stopDwellTimer();
    flushState();
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyThemePreference(state.theme);
});

select('#lightbox').addEventListener('click', (event) => event.currentTarget.close());

document.querySelectorAll('dialog [data-close]').forEach((btn) => {
    if (!btn.textContent.trim()) {
        btn.innerHTML = ICONS.close;
    }
    btn.addEventListener('click', () => btn.closest('dialog').close());
});

document.querySelectorAll('dialog:not(#lightbox)').forEach((dlg) => {
    dlg.addEventListener('click', (event) => {
        if (event.target === dlg) {
            dlg.close();
        }
    });
});

select('#archiveBtn').innerHTML = ICONS.clock;
select('#setBtn').innerHTML = ICONS.sliders;
select('#backBtn').innerHTML = ICONS.back;
select('#skipBtn').innerHTML = ICONS.skip;
select('#saveBtn').innerHTML = ICONS.bookmark;

select('#archiveBtn').onclick = openArchiveDialog;
select('#libBtn').onclick = openLibraryDialog;
select('#setBtn').onclick = openSettingsDialog;
select('#backBtn').onclick = goToPreviousPaper;
select('#skipBtn').onclick = skipCurrentPaper;
select('#saveBtn').onclick = saveCurrentPaper;
select('#deepBtn').onclick = stepDeeper;

select('#segs').addEventListener('click', (event) => {
    const seg = event.target.closest('.seg');
    if (seg && getCurrentPaper()) {
        jumpToPaperIndex(Number(seg.dataset.k));
    }
});

window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
    }
    if (document.querySelector('dialog[open]')) {
        return;
    }
    if (event.target.closest('input, textarea, select, [contenteditable]')) {
        return;
    }

    const key = event.key;
    if (key === ',') {
        event.preventDefault();
        openSettingsDialog();
        return;
    }
    if (key === 'a' || key === 'A') {
        event.preventDefault();
        openArchiveDialog();
        return;
    }
    if (key === 'l' || key === 'L') {
        event.preventDefault();
        openLibraryDialog();
        return;
    }
    if (key === '?') {
        event.preventDefault();
        select('#keys').showModal();
        return;
    }

    const currentPaper = getCurrentPaper();
    if (!currentPaper) {
        if ((key === 'u' || key === 'Backspace') && state.day) {
            event.preventDefault();
            goToPreviousPaper();
        }
        return;
    }

    const scroller = select('.card-scroll', stageEl);
    const actions = {
        ' ': () => {
            if (event.shiftKey) {
                scroller.scrollBy({ top: -scroller.clientHeight * 0.8, behavior: 'smooth' });
            } else {
                expandCurrentCard();
            }
        },
        'Enter': () => openCurrentPdf(),
        'o': () => openCurrentPdf(),
        'p': () => openCurrentPdf(),
        'ArrowRight': saveCurrentPaper,
        's': saveCurrentPaper,
        'ArrowLeft': skipCurrentPaper,
        'x': skipCurrentPaper,
        'd': skipCurrentPaper,
        'u': goToPreviousPaper,
        'Backspace': goToPreviousPaper,
        'z': goToPreviousPaper,
        'ArrowDown': () => scroller.scrollBy({ top: 90, behavior: 'smooth' }),
        'ArrowUp': () => scroller.scrollBy({ top: -90, behavior: 'smooth' }),
        'f': () => openFigureLightbox(currentPaper),
        'c': () => copyPaperBibtex(currentPaper),
        'Escape': collapseCurrentCard,
    };

    const handler = actions[key] || actions[key.toLowerCase()];
    if (handler) {
        event.preventDefault();
        handler();
    }
});

async function initializeApp() {
    initDialogs();
    applyThemePreference(state.theme);
    try {
        const [todayRes, daysRes] = await Promise.all([
            fetch('data/today.json', { cache: 'no-cache' }),
            fetch('data/days.json', { cache: 'no-cache' }).catch(() => null),
        ]);
        if (!todayRes.ok) {
            throw new Error(`HTTP ${todayRes.status}`);
        }
        ingestDailyFeed(await todayRes.json());
        archiveState.todayDate = pool.date;

        let manifestDays = [];
        if (daysRes && daysRes.ok) {
            const manifest = await daysRes.json();
            if (manifest && Array.isArray(manifest.days)) {
                manifestDays = manifest.days.slice(0, 8);
            }
        }
        if (manifestDays.length === 0 && pool.date) {
            manifestDays = [{ date: pool.date, count: pool.papers.length }];
        }
        archiveState.days = manifestDays;
    } catch (err) {
        console.warn('Could not load data/today.json', err);
        const protocolHint = location.protocol === 'file:'
            ? 'Open this page through a web server (e.g. python3 -m http.server) so it can read data/today.json.'
            : undefined;
        renderEmptyView(protocolHint);
        return;
    }

    if (state.onboarded && pool.papers.length > 0) {
        if (!activateDayStack(pool.date)) {
            buildDailyStack();
        }
    }
    renderApp('in');
}

initializeApp();
