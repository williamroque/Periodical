import { COLLABORATION_RE, DATA_SOURCES, JOURNAL_QUARTILES, NAME_PARTICLES, NAME_SUFFIXES } from './config.js';

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

const VENUE_PATTERNS = [
    [/\b(?:The\s+)?Astrophysical\s+Journal\s+Letters\b|\bApJL\b|\bApJ\s+Letters\b/i, 'ApJL'],
    [/\b(?:The\s+)?Astrophysical\s+Journal\s+Supplement(?:\s+Series)?\b|\bApJS\b/i, 'ApJS'],
    [/\b(?:The\s+)?Astrophysical\s+Journal\b|\bApJ\b/i, 'ApJ'],
    [/\b(?:The\s+)?Astronomical\s+Journal\b|\bAJ\b/, 'AJ'],
    [/\bResearch\s+Notes\s+of\s+the\s+AAS\b|\bRNAAS\b/i, 'RNAAS'],
    [/\bAAS\s+Journals?\b|\bAAS\b/, 'AAS'],
    [/\bMonthly\s+Notices\s+of\s+the\s+Royal\s+Astronomical\s+Society\s+Letters\b|\bMNRAS\s+Letters\b|\bMNRASL\b/i, 'MNRASL'],
    [/\bMonthly\s+Notices\s+of\s+the\s+Royal\s+Astronomical\s+Society\b|\bMNRAS\b/i, 'MNRAS'],
    [/\bResearch\s+in\s+Astronomy\s+and\s+Astrophysics\b|\bRAA\b/i, 'RAA'],
    [/\bAstronomy\s*(?:&|and)\s*Astrophysics\s+Letters\b|\bA&A\s+Letters\b|\bA&AL\b/i, 'A&AL'],
    [/\bAstronomy\s*(?:&|and)\s*Astrophysics\b|\bA&A\b/i, 'A&A'],
    [/\bPublications\s+of\s+the\s+Astronomical\s+Society\s+of\s+the\s+Pacific\b|\bPASP\b/i, 'PASP'],
    [/\bPublications\s+of\s+the\s+Astronomical\s+Society\s+of\s+Japan\b|\bPASJ\b/i, 'PASJ'],
    [/\bPublications\s+of\s+the\s+Astronomical\s+Society\s+of\s+Australia\b|\bPASA\b/i, 'PASA'],
    [/\b(?:The\s+)?Open\s+Journal\s+of\s+Astrophysics\b|\bOJA\b/i, 'OJA'],
    [/\b(?:The\s+)?Planetary\s+Science\s+Journal\b|\bPSJ\b/i, 'PSJ'],
    [/\bNature\s+Astronomy\b|\bNat\.?\s*Astron\.?/i, 'Nat. Astron.'],
    [/\bNature\s+Communications\b|\bNat\.?\s*Commun\.?/i, 'Nat. Commun.'],
    [/\bNature\s+Physics\b|\bNat\.?\s*Phys\.?/i, 'Nat. Phys.'],
    [/\bPhysical\s+Review\s+Letters\b|\bPhys\.?\s*Rev\.?\s*Lett\.?|\bPRL\b/i, 'PRL'],
    [/\bPhysical\s+Review\s+D\b|\bPhys\.?\s*Rev\.?\s*D\b|\bPRD\b/i, 'PRD'],
    [/\bPhysical\s+Review\s+C\b|\bPhys\.?\s*Rev\.?\s*C\b|\bPRC\b/i, 'PRC'],
    [/\bPhysical\s+Review\s+A\b|\bPhys\.?\s*Rev\.?\s*A\b|\bPRA\b/i, 'PRA'],
    [/\bPhysical\s+Review\s+X\b|\bPhys\.?\s*Rev\.?\s*X\b|\bPRX\b/i, 'PRX'],
    [/\bAstrophysics\s+and\s+Space\s+Science\b|\bAp&SS\b/i, 'Ap&SS'],
    [/\bSpace\s+Science\s+Reviews\b|\bSSRv\b/i, 'Space Sci. Rev.'],
    [/\bAdvances\s+in\s+Space\s+Research\b/i, 'Adv. Space Res.'],
    [/\bAstronomische\s+Nachrichten\b/i, 'AN'],
    [/\bActa\s+Astronautica\b/i, 'Acta Astronaut.'],
    [/\bIcarus\b/i, 'Icarus'],
    [/\bGalaxies\b/i, 'Galaxies'],
    [/\bJournal\s+of\s+Cosmology\s+and\s+Astroparticle\s+Physics\b|\bJCAP\b/i, 'JCAP'],
    [/\bJournal\s+of\s+High\s+Energy\s+Physics\b|\bJHEP\b/i, 'JHEP'],
    [/\bClassical\s+and\s+Quantum\s+Gravity\b|\bCQG\b/i, 'CQG'],
    [/\bEur\.?\s*Phys\.?\s*J\.?\s*C\b|\bEPJC\b/i, 'EPJC'],
    [/\bProc\.?\s*SPIE\b|\bSPIE\b/i, 'SPIE'],
    [/\bFront\.?\s*Astron\.?\s*Space\s*Sci\.?|\bFrontiers\s+in\s+Astronomy\s+and\s+Space\s+Sciences\b/i, 'Front. Astron. Space Sci.'],
    [/\bAPS\s+Open\s+Sci\.?/i, 'APS Open Sci.'],
    [/\bJETP\s+Lett(?:ers|\.)/i, 'JETP Lett.'],
    [/\bSolar\s+Physics\b|\bSol\.?\s*Phys\.?/i, 'Sol. Phys.'],
    [/\bNew\s+Astronomy\s+Reviews\b|\bNewAR\b/i, 'NewAR'],
    [/\bNew\s+Astronomy\b|\bNewA\b/i, 'NewA'],
    [/\bExperimental\s+Astronomy\b/i, 'Exp. Astron.'],
    [/\bJournal\s+of\s+Open\s+Source\s+Software\b|\bJOSS\b/i, 'JOSS'],
    [/\bNature\b/, 'Nature'],
    [/\bScience\b/, 'Science'],
];

const NO_VENUE_RE = /\bno\s+journal\b|\bnot\s+(?:yet\s+)?submitted\b/i;
const VENUE_CLAUSE_RE = /(?:submitted|accepted(?:\s+in\s+principle)?|to\s+be\s+published|to\s+appear|published|in\s+press)(?:\s+for\s+publication)?\s+(?:in|to|at|by|on)\s+(?:the\s+)?([^.;\n]+)/i;

function matchKnownVenue(text) {
    for (const [pattern, label] of VENUE_PATTERNS) {
        if (pattern.test(text)) {
            return label;
        }
    }
    return '';
}

export function getPaperVenue(paper) {
    if (paper.venue) {
        return paper.venue;
    }
    if (paper.journal) {
        const known = matchKnownVenue(paper.journal);
        if (known) {
            return known;
        }
        const short = paper.journal.split(/[,;(\d]/)[0].trim();
        return short ? short.slice(0, 28) : '';
    }
    const comment = paper.comment || '';
    if (!comment || NO_VENUE_RE.test(comment)) {
        return '';
    }
    const known = matchKnownVenue(comment);
    if (known) {
        return known;
    }
    const match = VENUE_CLAUSE_RE.exec(comment);
    if (match) {
        const raw = match[1].trim().split(/,\s*(?:on|held|open access|\d+\s+pages?)\b/i)[0].trim();
        const paren = /\(([A-Z0-9&+-]{2,12})\)/.exec(raw);
        if (paren) {
            return paren[1];
        }
        if (raw.length <= 28) {
            return raw;
        }
    }
    return '';
}

export function getPaperQuartile(paper) {
    const venue = getPaperVenue(paper);
    if (!venue) {
        return 'Unlisted';
    }
    return JOURNAL_QUARTILES[venue] || 'Q4';
}

export function parseKeywords(rawText) {
    const seen = new Set();
    const result = [];
    for (const part of String(rawText || '').split(',')) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }
        const key = trimmed.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(trimmed);
        }
    }
    return result;
}

export function buildKeywordRegex(keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = /^\w/.test(keyword) ? '\\b' : '';
    const suffix = /\w$/.test(keyword) ? '\\b' : '';
    return new RegExp(`${prefix}${escaped}${suffix}`, 'i');
}

const DATA_SOURCE_BY_ID = new Map(DATA_SOURCES.map((source) => [source.id, source]));

export function findMatchedKeywords(paper, selectedSources = [], customKeywords = []) {
    const text = `${paper.title || ''}\n${paper.abstract || ''}`;
    const labels = [];
    const patterns = [];

    for (const id of selectedSources || []) {
        const source = DATA_SOURCE_BY_ID.get(id);
        if (source && source.re.test(text)) {
            labels.push(source.label);
            patterns.push(source.re);
        }
    }

    for (const kw of customKeywords || []) {
        if (!kw) {
            continue;
        }
        const re = buildKeywordRegex(kw);
        if (re.test(text)) {
            labels.push(kw);
            patterns.push(re);
        }
    }

    return { labels, patterns };
}

export function highlightAbstract(abstractText, patterns) {
    if (!abstractText || !patterns || patterns.length === 0) {
        return escapeHtml(abstractText);
    }
    const ranges = [];
    for (const pat of patterns) {
        const flags = pat.flags.includes('g') ? pat.flags : `${pat.flags}g`;
        const globalRe = new RegExp(pat.source, flags);
        let match;
        while ((match = globalRe.exec(abstractText)) !== null) {
            if (match[0].length === 0) {
                break;
            }
            ranges.push([match.index, match.index + match[0].length]);
        }
    }
    if (ranges.length === 0) {
        return escapeHtml(abstractText);
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = ranges[i];
        if (curr[0] <= prev[1]) {
            prev[1] = Math.max(prev[1], curr[1]);
        } else {
            merged.push(curr);
        }
    }

    let html = '';
    let cursor = 0;
    for (const [start, end] of merged) {
        if (start > cursor) {
            html += escapeHtml(abstractText.slice(cursor, start));
        }
        html += `<mark class='kw-hit'>${escapeHtml(abstractText.slice(start, end))}</mark>`;
        cursor = end;
    }
    if (cursor < abstractText.length) {
        html += escapeHtml(abstractText.slice(cursor));
    }
    return html;
}
