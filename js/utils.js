import { COLLABORATION_RE, NAME_PARTICLES, NAME_SUFFIXES } from './config.js';

export function select(selector, root = document) {
    return root.querySelector(selector);
}

export function escapeHtml(value) {
    const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '\x22': '&quot;',
        '\'': '&#39;',
    };
    return String(value ?? '').replace(/[&<>\x22']/g, (ch) => entities[ch]);
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function truncateText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }
    const clipped = text.slice(0, maxLength - 1).replace(/[\s,;:.]+\S*$/, '');
    return clipped + '…';
}

export function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
}

export function createSeededRandom(seed) {
    return function nextRandom() {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function abbreviateAuthorName(fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2 || COLLABORATION_RE.test(fullName)) {
        return fullName;
    }
    const familyParts = [];
    while (parts.length > 1) {
        const token = parts.pop();
        familyParts.unshift(token);
        const prev = parts[parts.length - 1] || '';
        if (!NAME_PARTICLES.test(prev) && !NAME_SUFFIXES.test(prev)) {
            break;
        }
    }
    const initials = parts
        .map((word) => word.split('-').map((seg) => seg[0] + '.').join('-'))
        .join(' ');
    return `${initials} ${familyParts.join(' ')}`;
}

export function formatAuthorLine(paper, maxAuthors = 3) {
    const names = paper.authors.slice(0, maxAuthors).map((name) => escapeHtml(abbreviateAuthorName(name)));
    const remaining = paper.nAuthors - names.length;
    const suffix = remaining > 0 ? ` <span style='opacity:.7'>+${remaining}</span>` : '';
    return names.join(', ') + suffix;
}

export function getArxivAbsUrl(paper) {
    return `https://arxiv.org/abs/${paper.id}`;
}

export function getArxivPdfUrl(paper) {
    const versionSuffix = paper.ver ? `v${paper.ver}` : '';
    return `https://arxiv.org/pdf/${paper.id}${versionSuffix}`;
}

export function getArxivHtmlUrl(paper) {
    const versionSuffix = paper.ver ? `v${paper.ver}` : '';
    return `https://arxiv.org/html/${paper.id}${versionSuffix}`;
}

export function formatIsoDate(isoString, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
    const [year, month, day] = isoString.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, options);
}

export function buildConstellationSvg(paper) {
    const random = createSeededRandom(hashString(paper.id));
    const stars = Array.from({ length: 34 }, () => [
        random() * 640,
        10 + random() * 120,
        random() ** 2.2,
    ]);
    const brightest = stars
        .slice()
        .sort((a, b) => b[2] - a[2])
        .slice(0, 6)
        .sort((a, b) => a[0] - b[0]);

    const pathCoords = brightest
        .map((star) => `${star[0].toFixed(1)} ${star[1].toFixed(1)}`)
        .join(' L');
    const circles = stars
        .map((star) => {
            const radius = (0.7 + star[2] * 2.4).toFixed(2);
            const opacity = (0.25 + star[2] * 0.7).toFixed(2);
            return `<circle cx='${star[0].toFixed(1)}' cy='${star[1].toFixed(1)}' r='${radius}' fill='currentColor' opacity='${opacity}'/>`;
        })
        .join('');

    return (
        `<svg viewBox='0 0 640 140' preserveAspectRatio='xMidYMid slice' aria-hidden='true'>` +
        `<path d='M${pathCoords}' fill='none' stroke='currentColor' stroke-width='1' opacity='.35'/>` +
        `${circles}</svg>`
    );
}
