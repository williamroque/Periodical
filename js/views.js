import {
    DAY_MS,
    PHASES,
    getCategoryBadge,
    getCategoryName,
    hasFinePointer,
} from './config.js';
import { ICONS } from './icons.js';
import {
    buildConstellationSvg,
    escapeHtml,
    formatAuthorLine,
    formatIsoDate,
    getArxivAbsUrl,
    getArxivHtmlUrl,
    hashString,
    select,
    truncateText,
} from './utils.js';
import {
    getCurrentPaper,
    getExcludedIdSet,
    getSavedIdSet,
    pool,
    scheduleSave,
    startDwellTimer,
    state,
    stopDwellTimer,
} from './state.js';
import { buildDailyStack, rankCandidatePool } from './ranking.js';
import { showToast } from './ui.js';
import { bindCardInteractions, goToPreviousPaper } from './actions.js';
import { openLibraryDialog, renderLibraryBadge } from './dialogs.js';

export const stageEl = select('#stage');

export function appendMorePapers(count = 5) {
    const day = state.day;
    const picks = rankCandidatePool(count, getExcludedIdSet(day.ids), 'm' + day.extra);
    if (picks.length === 0) {
        showToast('That was everything announced today');
        return;
    }
    day.extra += picks.length;
    day.ids.push(...picks.map((pick) => pick.id));
    for (const pick of picks) {
        day.why[pick.id] = pick.why;
    }
    scheduleSave();
    renderApp('in');
}

export function renderApp(animationClass = 'in') {
    select('#date').textContent = pool.date
        ? formatIsoDate(pool.date, { weekday: 'short', day: 'numeric', month: 'short' })
        : '';
    renderLibraryBadge();

    if (pool.papers.length === 0) {
        renderEmptyView();
        return;
    }
    if (!state.onboarded) {
        renderOnboardingView();
        return;
    }
    const paper = getCurrentPaper();
    if (!paper) {
        renderCaughtUpView();
        return;
    }
    renderPaperCard(paper, animationClass);
}

export function updateChromeVisibility(mode) {
    select('#dock').hidden = mode !== 'card';
    select('#progress').hidden = mode === 'onboarding' || mode === 'empty';
    if (mode !== 'card') {
        stopDwellTimer();
    }
}

export function renderProgressSegments() {
    const day = state.day;
    const segmentsHtml = day.ids.map((id, index) => {
        const phase = day.ph[id];
        const paper = pool.byId.get(id);
        const isCurrent = index === day.i ? ' cur' : '';
        const phaseAttr = phase !== undefined ? `data-p='${phase}'` : '';
        const labelTitle = paper ? truncateText(paper.title, 70) : '';
        const labelPhase = phase !== undefined ? ` · ${PHASES[phase]}` : '';
        return `<span class='seg${isCurrent}' role='listitem' data-k='${index}' ${phaseAttr} title='${escapeHtml(labelTitle + labelPhase)}'></span>`;
    });
    select('#segs').innerHTML = segmentsHtml.join('');
    select('#count').textContent = `${Math.min(day.i + 1, day.ids.length)}/${day.ids.length}`;
}

export function renderPaperCard(paper, animationClass) {
    updateChromeVisibility('card');
    const day = state.day;
    if (day.ph[paper.id] === undefined) {
        day.ph[paper.id] = 0;
    }

    const phase = day.ph[paper.id];
    const why = day.why[paper.id];
    const remaining = day.ids.length - day.i;
    const isSaved = getSavedIdSet().has(paper.id);

    const facts = [];
    if (paper.caption) {
        facts.push(['Figure', `<dd class='cap'>${escapeHtml(paper.caption)}</dd>`]);
    }
    const extraAuthors = paper.nAuthors - paper.authors.length;
    const authorSuffix = extraAuthors > 0 ? ` and ${extraAuthors} more` : '';
    facts.push(['Authors', `<dd>${escapeHtml(paper.authors.join(', '))}${authorSuffix}</dd>`]);
    if (paper.comment) {
        facts.push(['Comments', `<dd>${escapeHtml(paper.comment)}</dd>`]);
    }
    if (paper.journal) {
        facts.push(['Journal', `<dd>${escapeHtml(paper.journal)}</dd>`]);
    }
    const areaList = paper.cats.map((cat) => escapeHtml(getCategoryName(cat))).join(' · ');
    facts.push(['Areas', `<dd>${areaList}</dd>`]);

    const detourFlag = why && why.kind === 'explore'
        ? `<span class='flag'>${ICONS.compass} Detour</span>`
        : '';

    let plateHtml;
    if (paper.fig) {
        const dimAttrs = paper.figW ? `width='${paper.figW}' height='${paper.figH}'` : '';
        plateHtml = (
            `<figure class='plate' data-zoom>` +
            `${detourFlag}` +
            `<img src='${escapeHtml(paper.fig)}' alt='Lead figure' decoding='async' fetchpriority='high' ${dimAttrs}>` +
            `</figure>`
        );
    } else {
        const hue = hashString(paper.cats[0] || 'x') % 360;
        plateHtml = (
            `<figure class='plate fp' style='--h:${hue}'>` +
            `${detourFlag}${buildConstellationSvg(paper)}` +
            `</figure>`
        );
    }

    const badges = [];
    if (paper.code) {
        badges.push(`<span class='tag code'>${ICONS.code} Code</span>`);
    }
    if (paper.journal) {
        badges.push(`<span class='tag'>Published</span>`);
    } else if (paper.accepted) {
        badges.push(`<span class='tag'>Accepted</span>`);
    }
    if (paper.type === 'cross') {
        badges.push(`<span class='tag'>Cross-list</span>`);
    }

    const reasonLine = why && why.kind !== 'explore'
        ? `<div class='why'>${ICONS.spark}<span>${escapeHtml(why.text)}</span></div>`
        : '';

    const externalLinks = [
        `<a class='chip-link' href='${getArxivAbsUrl(paper)}' target='_blank' rel='noopener'>arXiv ${ICONS.arrow}</a>`,
    ];
    if (paper.html) {
        externalLinks.push(`<a class='chip-link' href='${getArxivHtmlUrl(paper)}' target='_blank' rel='noopener' data-phase2>HTML ${ICONS.arrow}</a>`);
    }
    if (paper.code) {
        externalLinks.push(`<a class='chip-link' href='${escapeHtml(paper.code)}' target='_blank' rel='noopener'>Code ${ICONS.arrow}</a>`);
    }
    if (paper.doi) {
        externalLinks.push(`<a class='chip-link' href='https://doi.org/${escapeHtml(paper.doi)}' target='_blank' rel='noopener'>DOI ${ICONS.arrow}</a>`);
    }
    externalLinks.push(`<button class='chip-link' data-copy>${ICONS.copy} BibTeX</button>`);

    const wrapClasses = [
        'card-wrap',
        remaining <= 2 ? 'last' : '',
        remaining <= 1 ? 'only' : '',
    ].filter(Boolean).join(' ');

    stageEl.innerHTML = `
        <div class='${wrapClasses}'>
            <article class='card ${animationClass}' ${phase >= 1 ? 'data-open' : ''} aria-label='${escapeHtml(paper.title)}'>
                <span class='stamp skip'>Skip</span>
                <span class='stamp save'>Save</span>
                <div class='card-scroll'>
                    ${plateHtml}
                    <div class='body'>
                        <div class='head'>
                            <div class='kicker'>
                                <span class='cat'>
                                    <b>${escapeHtml(getCategoryBadge(paper.cats[0]))}</b>
                                    ${escapeHtml(getCategoryName(paper.cats[0]))}
                                </span>
                                <span class='arxiv-id'>${escapeHtml(paper.id)}</span>
                                ${badges.join('')}
                            </div>
                            <h2 class='micro'>${escapeHtml(paper.micro || paper.title)}</h2>
                            <h3 class='title'>${escapeHtml(paper.title)}</h3>
                            <p class='authors'>${formatAuthorLine(paper)}</p>
                            ${reasonLine}
                        </div>
                        <section class='deep' aria-label='Details'>
                            <div>
                                <p class='abstract'>${escapeHtml(paper.abstract)}</p>
                                <dl class='facts'>
                                    ${facts.map(([label, dd]) => `<dt>${label}</dt>${dd}`).join('')}
                                </dl>
                                <div class='links'>
                                    ${externalLinks.join('')}
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </article>
        </div>`;

    const cardEl = select('.card', stageEl);
    const imgEl = select('img', cardEl);
    if (imgEl) {
        const markReady = () => imgEl.classList.add('ready');
        if (imgEl.complete && imgEl.naturalWidth) {
            markReady();
        } else {
            imgEl.addEventListener('load', markReady, { once: true });
        }
        imgEl.addEventListener('error', () => {
            const plateEl = imgEl.closest('.plate');
            plateEl.className = 'plate fp';
            plateEl.removeAttribute('data-zoom');
            plateEl.style.setProperty('--h', hashString(paper.cats[0] || 'x') % 360);
            plateEl.innerHTML = buildConstellationSvg(paper);
        }, { once: true });
    }

    cardEl.addEventListener('animationend', () => {
        cardEl.classList.remove('in', 'in-back');
    }, { once: true });

    bindCardInteractions(cardEl, paper);
    renderProgressSegments();
    updateDockButtons(paper, phase, isSaved);
    startDwellTimer(paper.id);
    preloadUpcomingFigures();
    scheduleSave();
}

export function updateDockButtons(paper, phase, isSaved) {
    const deepBtn = select('#deepBtn');
    if (phase >= 1) {
        deepBtn.innerHTML = `${ICONS.pdf}<span>Open PDF</span><kbd>↵</kbd>`;
        deepBtn.setAttribute('aria-label', 'Open PDF');
    } else {
        deepBtn.innerHTML = `${ICONS.text}<span>Read abstract</span><kbd>Space</kbd>`;
        deepBtn.setAttribute('aria-label', 'Read abstract');
    }
    const saveBtn = select('#saveBtn');
    saveBtn.setAttribute('aria-pressed', String(isSaved));
    saveBtn.title = isSaved ? 'Saved — click to remove' : 'Save (→)';
    select('#backBtn').disabled = !state.day || state.day.i === 0;
}

export function preloadUpcomingFigures() {
    const day = state.day;
    for (const id of day.ids.slice(day.i + 1, day.i + 3)) {
        const nextPaper = pool.byId.get(id);
        if (nextPaper && nextPaper.fig) {
            const img = new Image();
            img.decoding = 'async';
            img.src = nextPaper.fig;
        }
    }
}

export function buildCategoryChipsHtml(selectedCats) {
    const counts = new Map();
    for (const paper of pool.papers) {
        const primary = paper.cats[0];
        if (primary) {
            counts.set(primary, (counts.get(primary) || 0) + 1);
        }
    }
    const sorted = [...counts.entries()].sort((a, b) => {
        const aAstro = a[0].startsWith('astro-ph') ? 1 : 0;
        const bAstro = b[0].startsWith('astro-ph') ? 1 : 0;
        if (aAstro !== bAstro) {
            return bAstro - aAstro;
        }
        return b[1] - a[1];
    });
    return sorted.slice(0, 10).map(([cat, count]) => {
        const isPressed = selectedCats.includes(cat);
        return (
            `<button class='chip' data-cat='${escapeHtml(cat)}' aria-pressed='${isPressed}'>` +
            `${escapeHtml(getCategoryName(cat))}<span class='n'>${count}</span>` +
            `</button>`
        );
    }).join('');
}

export function handleChipClick(event) {
    const chip = event.target.closest('.chip');
    if (!chip) {
        return;
    }
    const currentPressed = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!currentPressed));
}

export function collectSelectedCategories(container) {
    const buttons = container.querySelectorAll('.chip[aria-pressed=true]');
    return [...buttons].map((btn) => btn.dataset.cat);
}

export function renderOnboardingView() {
    updateChromeVisibility('onboarding');
    const formattedDate = formatIsoDate(pool.date, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
    });

    stageEl.innerHTML = `
        <section class='view'>
            <div class='eyebrow'>
                <i></i>${escapeHtml(pool.feed)} · ${pool.papers.length} new · ${escapeHtml(formattedDate)}
            </div>
            <h1 class='display'>Today’s preprints, <em>distilled</em> to the few that matter to you.</h1>
            <p class='lede'>A short, ranked stack instead of an endless list. It learns quietly from what you read, open and save — and none of it ever leaves this device.</p>
            <div class='field'>
                <label class='label' for='obPrompt'>What are you working on?</label>
                <textarea id='obPrompt' rows='3' placeholder='A sentence or a few keywords — the more specific, the better'>${escapeHtml(state.prompt)}</textarea>
            </div>
            <div class='field'>
                <span class='label'>Areas you follow <span style='color:var(--muted);font-weight:400'>· optional</span></span>
                <div class='chips' id='obCats'>${buildCategoryChipsHtml(state.cats)}</div>
            </div>
            <div class='row'>
                <button class='btn' id='obGo'>Build today’s stack ${ICONS.arrowRight}</button>
                <button class='link-btn' id='obSkip'>Just show me a balanced mix</button>
            </div>
            <p class='fineprint'>${ICONS.lock} No account, no tracking, no server. Stored in your browser.</p>
        </section>`;

    select('#obCats').addEventListener('click', handleChipClick);

    function startSession(usePromptText) {
        state.prompt = usePromptText ? select('#obPrompt').value.trim() : '';
        state.cats = collectSelectedCategories(select('#obCats'));
        state.onboarded = true;
        buildDailyStack();
        renderApp('in');
    }

    select('#obGo').onclick = () => startSession(true);
    select('#obSkip').onclick = () => startSession(false);
    select('#obPrompt').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            startSession(true);
        }
    });

    if (hasFinePointer) {
        setTimeout(() => select('#obPrompt')?.focus(), 350);
    }
}

export function findNextAnnouncementTime() {
    const now = new Date();
    const nyFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        timeZoneName: 'shortOffset',
    });

    for (let offsetDays = 0; offsetDays < 8; offsetDays++) {
        const probe = new Date(now.getTime() + offsetDays * DAY_MS);
        const parts = Object.fromEntries(
            nyFormatter.formatToParts(probe).map((part) => [part.type, part.value])
        );
        if (!['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(parts.weekday)) {
            continue;
        }
        const tzMatch = parts.timeZoneName.match(/GMT([+-]\d+)/);
        const utcOffsetHours = Number(tzMatch ? tzMatch[1] : -5);
        const candidate = new Date(
            Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 20 - utcOffsetHours)
        );
        if (candidate > now) {
            return candidate;
        }
    }
    return null;
}

export function renderCaughtUpView() {
    updateChromeVisibility('done');
    const day = state.day;
    renderProgressSegments();

    const phases = day.ids.map((id) => day.ph[id]).filter((ph) => ph !== undefined);
    const countAtLeast = (minPhase) => phases.filter((ph) => ph >= minPhase).length;
    const savedSet = getSavedIdSet();
    const savedToday = day.ids.filter((id) => savedSet.has(id)).length;

    const nextTime = findNextAnnouncementTime();
    const nextLabel = nextTime
        ? nextTime.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })
        : 'soon';

    const unseenRemaining = pool.papers.filter(
        (paper) => !day.ids.includes(paper.id) && !savedSet.has(paper.id)
    ).length;

    const moreButtonHtml = unseenRemaining > 0
        ? `<button class='link-btn' id='doneMore'>Show ${Math.min(5, unseenRemaining)} more of the ${unseenRemaining} left</button>`
        : '';
    const backButtonHtml = day.i > 0
        ? `<button class='link-btn' id='doneBack'>Back to the last paper</button>`
        : '';

    stageEl.innerHTML = `
        <section class='view'>
            <div class='eyebrow'><i></i>${escapeHtml(formatIsoDate(pool.date))}</div>
            <h1 class='display'>Review complete.</h1>
            <p class='lede'>The next arXiv announcement lands ${escapeHtml(nextLabel)}.</p>
            <blockquote class='quote'>
                <p>“For the mind does not require filling like a bottle, but rather, like wood, it only requires kindling to create in it an impulse to think independently and an ardent desire for the truth.”</p>
                <cite>— Plutarch</cite>
            </blockquote>
            <div class='tally'>
                <div><b>${phases.length}</b><span>Triaged</span></div>
                <div><b>${countAtLeast(1)}</b><span>Read</span></div>
                <div><b>${countAtLeast(2)}</b><span>Opened</span></div>
                <div><b>${savedToday}</b><span>Saved</span></div>
            </div>
            <div class='row'>
                <button class='btn' id='doneLib'>${ICONS.library} Open library</button>
                ${moreButtonHtml}
                ${backButtonHtml}
            </div>
        </section>`;

    select('#doneLib').onclick = openLibraryDialog;
    const moreBtn = select('#doneMore');
    if (moreBtn) {
        moreBtn.onclick = () => appendMorePapers(5);
    }
    const backBtn = select('#doneBack');
    if (backBtn) {
        backBtn.onclick = goToPreviousPaper;
    }
}

export function renderEmptyView(customMessage) {
    updateChromeVisibility('empty');
    const defaultMessage = 'Today’s feed hasn’t been generated. Run pipeline.py (or wait for the scheduled build) to create data/today.json.';
    stageEl.innerHTML = `
        <section class='view'>
            <div class='eyebrow'><i></i>No feed</div>
            <h1 class='display'>Nothing to triage <em>yet.</em></h1>
            <p class='lede'>${escapeHtml(customMessage || defaultMessage)}</p>
        </section>`;
}
