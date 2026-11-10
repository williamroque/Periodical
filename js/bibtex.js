import {
    COLLABORATION_RE,
    NAME_PARTICLES,
    NAME_SUFFIXES,
    STOP_WORDS,
    hasFinePointer,
} from './config.js';
import { pool, state } from './state.js';
import { showToast } from './ui.js';

export function createLibraryEntry(paper) {
    return {
        id: paper.id,
        ver: paper.ver,
        title: paper.title,
        micro: paper.micro,
        abstract: paper.abstract,
        authors: paper.authors,
        nAuthors: paper.nAuthors,
        cats: paper.cats,
        comment: paper.comment,
        journal: paper.journal,
        doi: paper.doi,
        code: paper.code,
        date: pool.date,
        savedAt: Date.now(),
        exported: false,
    };
}

export function formatBibtexAuthor(fullName) {
    const trimmed = fullName.trim();
    if (COLLABORATION_RE.test(trimmed) || !/\s/.test(trimmed)) {
        return `{${trimmed}}`;
    }
    const parts = trimmed.split(/\s+/);
    let suffix = '';
    if (NAME_SUFFIXES.test(parts[parts.length - 1])) {
        suffix = parts.pop();
    }
    const familyParts = [parts.pop()];
    while (parts.length > 1 && NAME_PARTICLES.test(parts[parts.length - 1])) {
        familyParts.unshift(parts.pop());
    }
    const suffixPart = suffix ? `, ${suffix}` : '';
    return `${familyParts.join(' ')}${suffixPart}, ${parts.join(' ')}`;
}

export function escapeBibtexField(text) {
    return String(text || '')
        .replace(/[{}]/g, '')
        .replace(/([&%#_$])/g, '\\$1');
}

export function toAsciiSlug(text) {
    return text
        .normalize('NFKD')
        .replace(/[^\x00-\x7f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '');
}

export function formatBibtex(entries) {
    const usedKeys = new Set();
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    const blocks = entries.map((entry) => {
        const isModernId = /^\d{4}\./.test(entry.id);
        const year = isModernId
            ? 2000 + Number(entry.id.slice(0, 2))
            : new Date(entry.savedAt || Date.now()).getFullYear();
        const monthIdx = isModernId ? Number(entry.id.slice(2, 4)) - 1 : 0;

        const firstAuthor = entry.authors[0]
            ? toAsciiSlug(formatBibtexAuthor(entry.authors[0]).split(',')[0]).toLowerCase()
            : 'arxiv';
        const titleWord = (
            entry.title
                .split(/\s+/)
                .map(toAsciiSlug)
                .find((word) => word.length > 3 && !STOP_WORDS.has(word.toLowerCase())) || 'paper'
        ).toLowerCase();

        let citeKey = `${firstAuthor}${year}${titleWord}`;
        let collisionIdx = 0;
        while (usedKeys.has(citeKey)) {
            citeKey = `${firstAuthor}${year}${titleWord}${'abcdefghijklmnopqrstuvwxyz'[collisionIdx++]}`;
        }
        usedKeys.add(citeKey);

        const authorList = entry.authors.map(formatBibtexAuthor).join(' and ') +
            (entry.nAuthors > entry.authors.length ? ' and others' : '');
        const noteText = [entry.journal, entry.comment].filter(Boolean).join('. ');

        const fields = [
            ['title', `{${escapeBibtexField(entry.title)}}`],
            ['author', escapeBibtexField(authorList).replace(/\\_/g, '_')],
            ['year', year],
            ['month', months[monthIdx] || 'jan'],
            ['eprint', entry.id],
            ['archivePrefix', 'arXiv'],
            ['primaryClass', entry.cats[0] || ''],
            ['doi', entry.doi || `10.48550/arXiv.${entry.id}`],
            ['url', `https://arxiv.org/abs/${entry.id}`],
            ['keywords', entry.cats.join(', ')],
            ['abstract', escapeBibtexField(entry.abstract)],
        ];
        if (noteText) {
            fields.push(['note', escapeBibtexField(noteText)]);
        }

        const formattedFields = fields
            .filter((field) => field[1] !== '')
            .map(([key, val]) => `  ${key} = {${val}}`)
            .join(',\n');
        return `@misc{${citeKey},\n${formattedFields}\n}`;
    });

    return blocks.join('\n\n') + '\n';
}

export function copyTextToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
            return true;
        }
        return fallbackCopyText(text);
    } catch (err) {
        return false;
    }
}

export function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(textarea);
    textarea.select();
    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch (err) {
        copied = false;
    }
    textarea.remove();
    return copied;
}

export function copyPaperBibtex(paper) {
    const entry = state.lib.find((item) => item.id === paper.id) || createLibraryEntry(paper);
    const ok = copyTextToClipboard(formatBibtex([entry]));
    showToast(ok ? 'BibTeX copied — paste into Zotero' : 'Could not access the clipboard');
}

export async function downloadOrShareFile(content, filename, mimeType) {
    const file = new File([content], filename, { type: mimeType });
    if (!hasFinePointer && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: filename });
            return true;
        } catch (err) {
            if (err.name === 'AbortError') {
                return false;
            }
        }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = filename;
    document.body.append(link);
    link.click();
    setTimeout(() => {
        URL.revokeObjectURL(link.href);
        link.remove();
    }, 1500);
    return true;
}
