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

export function showToast(message, actionLabel, actionCallback) {
    const toastEl = select('#toast');
    const buttonHtml = actionLabel ? `<button>${escapeHtml(actionLabel)}</button>` : '';
    toastEl.innerHTML = `<span>${escapeHtml(message)}</span>${buttonHtml}`;
    toastEl.classList.toggle('has-action', Boolean(actionLabel));

    if (actionLabel) {
        select('button', toastEl).onclick = () => {
            toastEl.classList.remove('on');
            actionCallback();
        };
    }
    toastEl.classList.add('on');
    clearTimeout(toastTimerId);
    toastTimerId = setTimeout(() => {
        toastEl.classList.remove('on');
    }, actionLabel ? 4800 : 2400);
}
