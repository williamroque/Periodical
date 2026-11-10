import { clamp, getArxivPdfUrl, select } from './utils.js';
import {
    getCurrentPaper,
    getSavedIdSet,
    recordLearningSignal,
    scheduleSave,
    state,
    stopDwellTimer,
} from './state.js';
import { copyPaperBibtex, copyTextToClipboard, createLibraryEntry, formatBibtex } from './bibtex.js';
import { openFigureLightbox, showToast } from './ui.js';
import { renderApp, renderProgressSegments, stageEl, updateDockButtons } from './views.js';
import { renderLibraryBadge } from './dialogs.js';

export let isTransitioning = false;

export function expandCurrentCard() {
    const paper = getCurrentPaper();
    if (!paper) {
        return;
    }
    const cardEl = select('.card', stageEl);
    if (cardEl.hasAttribute('data-open')) {
        const scroller = select('.card-scroll', cardEl);
        scroller.scrollBy({ top: scroller.clientHeight * 0.8, behavior: 'smooth' });
        return;
    }
    cardEl.setAttribute('data-open', '');
    promotePaperPhase(paper.id, 1);

    const scroller = select('.card-scroll', cardEl);
    const abstractEl = select('.abstract', cardEl);
    if (abstractEl) {
        setTimeout(() => {
            const top = Math.max(0, abstractEl.offsetTop - 110);
            scroller.scrollTo({ top, behavior: 'smooth' });
        }, 260);
    }
}

export function collapseCurrentCard() {
    const cardEl = select('.card', stageEl);
    if (!cardEl) {
        return;
    }
    cardEl.removeAttribute('data-open');
    select('.card-scroll', cardEl).scrollTo({ top: 0, behavior: 'smooth' });
}

export function promotePaperPhase(paperId, nextPhase) {
    const day = state.day;
    if ((day.ph[paperId] ?? -1) >= nextPhase) {
        return;
    }
    day.ph[paperId] = nextPhase;
    recordLearningSignal(paperId);
    renderProgressSegments();
    const currentPaper = getCurrentPaper();
    if (currentPaper && currentPaper.id === paperId) {
        updateDockButtons(currentPaper, nextPhase, getSavedIdSet().has(paperId));
    }
}

export function openCurrentPdf(customUrl) {
    const paper = getCurrentPaper();
    if (!paper) {
        return;
    }
    window.open(customUrl || getArxivPdfUrl(paper), '_blank', 'noopener');
    if ((state.day.ph[paper.id] ?? 0) < 1) {
        select('.card', stageEl)?.setAttribute('data-open', '');
    }
    promotePaperPhase(paper.id, 2);
}

export function stepDeeper() {
    const paper = getCurrentPaper();
    if (!paper) {
        return;
    }
    if ((state.day.ph[paper.id] ?? 0) >= 1) {
        openCurrentPdf();
    } else {
        expandCurrentCard();
    }
}

export function saveCurrentPaper() {
    const paper = getCurrentPaper();
    if (!paper || isTransitioning) {
        return;
    }
    if (getSavedIdSet().has(paper.id)) {
        removeFromLibrary(paper.id, true);
        return;
    }

    const undoSnapshot = {
        id: paper.id,
        index: state.day.i,
        phase: state.day.ph[paper.id],
        memEntry: state.mem[paper.id],
    };

    state.lib.unshift(createLibraryEntry(paper));
    stopDwellTimer();
    promotePaperPhase(paper.id, 3);
    recordLearningSignal(paper.id);

    const copied = copyTextToClipboard(formatBibtex([state.lib[0]]));
    const message = copied ? 'Saved · BibTeX copied for Zotero' : 'Saved to library';
    showToast(message, 'Undo', () => undoPaperSave(undoSnapshot));
    advanceToNextCard('right');
}

export function removeFromLibrary(paperId, stayOnCard = false) {
    state.lib = state.lib.filter((entry) => entry.id !== paperId);
    if (state.day && state.day.ph[paperId] === 3) {
        state.day.ph[paperId] = 2;
    }
    if (state.mem[paperId]) {
        state.mem[paperId].w = 0.6;
    }
    scheduleSave();
    renderLibraryBadge();

    if (stayOnCard) {
        const paper = getCurrentPaper();
        if (paper) {
            updateDockButtons(paper, state.day.ph[paper.id] ?? 0, false);
        }
        renderProgressSegments();
        showToast('Removed from library');
    }
}

export function undoPaperSave(snapshot) {
    state.lib = state.lib.filter((entry) => entry.id !== snapshot.id);
    if (snapshot.memEntry) {
        state.mem[snapshot.id] = snapshot.memEntry;
    } else {
        delete state.mem[snapshot.id];
    }
    if (snapshot.phase === undefined) {
        delete state.day.ph[snapshot.id];
    } else {
        state.day.ph[snapshot.id] = snapshot.phase;
    }
    state.day.i = snapshot.index;
    scheduleSave();
    renderApp('in-back');
}

export function skipCurrentPaper() {
    const paper = getCurrentPaper();
    if (!paper || isTransitioning) {
        return;
    }
    stopDwellTimer();
    recordLearningSignal(paper.id, true);
    advanceToNextCard('left');
}

export function goToPreviousPaper() {
    if (!state.day || state.day.i === 0 || isTransitioning) {
        return;
    }
    const paper = getCurrentPaper();
    if (paper) {
        stopDwellTimer();
        recordLearningSignal(paper.id);
    }
    state.day.i = Math.min(state.day.i, state.day.ids.length) - 1;
    scheduleSave();
    renderApp('in-back');
}

export function jumpToPaperIndex(targetIndex) {
    if (isTransitioning || !state.day || targetIndex === state.day.i) {
        return;
    }
    const paper = getCurrentPaper();
    if (paper) {
        stopDwellTimer();
        recordLearningSignal(paper.id);
    }
    state.day.i = clamp(targetIndex, 0, state.day.ids.length - 1);
    scheduleSave();
    renderApp('in');
}

export function advanceToNextCard(direction) {
    const cardEl = select('.card', stageEl);
    isTransitioning = true;
    state.day.i += 1;
    scheduleSave();

    function completeTransition() {
        isTransitioning = false;
        renderApp('in');
    }

    if (!cardEl) {
        completeTransition();
        return;
    }
    cardEl.classList.remove('dragging', 'in', 'in-back');
    cardEl.style.transform = '';
    cardEl.classList.add(direction === 'left' ? 'out-left' : 'out-right');
    setTimeout(completeTransition, 260);
}

let suppressNextClick = false;

export function bindCardInteractions(cardEl, paper) {
    const zoomPlate = select('[data-zoom]', cardEl);
    if (zoomPlate) {
        zoomPlate.addEventListener('click', () => openFigureLightbox(paper));
    }

    select('.head', cardEl).addEventListener('click', () => {
        if (suppressNextClick || window.getSelection().toString()) {
            return;
        }
        if (cardEl.hasAttribute('data-open')) {
            collapseCurrentCard();
        } else {
            expandCurrentCard();
        }
    });

    select('[data-copy]', cardEl).addEventListener('click', () => copyPaperBibtex(paper));

    cardEl.querySelectorAll('a.chip-link').forEach((link) => {
        link.addEventListener('click', () => {
            const targetPhase = link.hasAttribute('data-phase2') ? 2 : 1;
            promotePaperPhase(paper.id, targetPhase);
        });
    });

    const skipStamp = select('.stamp.skip', cardEl);
    const saveStamp = select('.stamp.save', cardEl);
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let deltaX = 0;
    let isDragging = false;
    let isTracking = false;
    let activePointerId = null;

    cardEl.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' || isTransitioning || event.target.closest('a,button')) {
            return;
        }
        isTracking = true;
        isDragging = false;
        activePointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        startTime = performance.now();
        deltaX = 0;
    });

    cardEl.addEventListener('pointermove', (event) => {
        if (!isTracking || event.pointerId !== activePointerId) {
            return;
        }
        deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;

        if (!isDragging) {
            if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
                isDragging = true;
                cardEl.classList.add('dragging');
                cardEl.setPointerCapture(activePointerId);
            } else if (Math.abs(deltaY) > 12) {
                isTracking = false;
                return;
            } else {
                return;
            }
        }

        const translateY = Math.abs(deltaX) * 0.06;
        const rotation = deltaX / 24;
        cardEl.style.transform = `translate3d(${deltaX}px, ${translateY}px, 0) rotate(${rotation}deg)`;

        const stampOpacity = clamp(Math.abs(deltaX) / 110, 0, 1);
        skipStamp.style.opacity = deltaX < 0 ? stampOpacity : 0;
        saveStamp.style.opacity = deltaX > 0 ? stampOpacity : 0;
    });

    function finishPointerGesture(event) {
        if (!isTracking || event.pointerId !== activePointerId) {
            return;
        }
        isTracking = false;
        if (!isDragging) {
            return;
        }
        suppressNextClick = true;
        setTimeout(() => {
            suppressNextClick = false;
        }, 60);

        cardEl.classList.remove('dragging');
        const velocity = deltaX / Math.max(1, performance.now() - startTime);
        const width = cardEl.offsetWidth;
        const isCancelled = event.type === 'pointercancel';

        if (!isCancelled && (deltaX > width * 0.3 || (deltaX > 50 && velocity > 0.55))) {
            navigator.vibrate?.(8);
            saveCurrentPaper();
        } else if (!isCancelled && (deltaX < -width * 0.3 || (deltaX < -50 && velocity < -0.55))) {
            navigator.vibrate?.(8);
            skipCurrentPaper();
        } else {
            cardEl.style.transform = '';
            skipStamp.style.opacity = 0;
            saveStamp.style.opacity = 0;
        }
    }

    cardEl.addEventListener('pointerup', finishPointerGesture);
    cardEl.addEventListener('pointercancel', finishPointerGesture);
}
