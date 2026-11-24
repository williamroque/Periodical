import { escapeHtml, select } from './utils.js';

export function applyThemePreference(theme) {
    if (theme === 'auto') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = theme;
    }
    requestAnimationFrame(() => {
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        select('meta[name=theme-color]').setAttribute('content', bg);
    });
}

const lightboxDialog = select('#lightbox');

export function openFigureLightbox(paper) {
    if (!paper.fig) {
        return;
    }
    select('img', lightboxDialog).src = paper.fig;
    select('p', lightboxDialog).textContent = paper.caption || '';
    lightboxDialog.showModal();
}

let toastTimerId = 0;
let toastHideTimerId = 0;

function hideToast(toastEl) {
    toastEl.classList.remove('on');
    clearTimeout(toastHideTimerId);
    toastHideTimerId = setTimeout(() => {
        if (!toastEl.classList.contains('on') && toastEl.hidePopover && toastEl.matches(':popover-open')) {
            try {
                toastEl.hidePopover();
            } catch {
                // Ignore
            }
        }
    }, 300);
}

export function showToast(message, actionLabel, actionCallback) {
    const toastEl = select('#toast');
    const buttonHtml = actionLabel ? `<button>${escapeHtml(actionLabel)}</button>` : '';
    toastEl.innerHTML = `<span>${escapeHtml(message)}</span>${buttonHtml}`;
    toastEl.classList.toggle('has-action', Boolean(actionLabel));

    if (actionLabel) {
        select('button', toastEl).onclick = () => {
            hideToast(toastEl);
            actionCallback();
        };
    }

    clearTimeout(toastHideTimerId);
    if (toastEl.showPopover) {
        try {
            if (toastEl.matches(':popover-open')) {
                toastEl.hidePopover();
            }
            toastEl.showPopover();
        } catch {
            // Ignore if unsupported
        }
    }

    toastEl.classList.add('on');
    clearTimeout(toastTimerId);
    toastTimerId = setTimeout(() => hideToast(toastEl), actionLabel ? 4800 : 2400);
}
