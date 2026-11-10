export const DAY_MS = 86400000;
export const STORAGE_KEY = 'periodical.v1';
export const DEFAULT_STATE = {
    prompt: '',
    cats: [],
    limit: 10,
    theme: 'auto',
    onboarded: false,
    mem: {},
    lib: [],
    day: null,
};

export const PHASES = ['Seen', 'Read', 'Opened', 'Saved'];
export const hasFinePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

export const CATEGORY_NAMES = {
    'astro-ph': 'Astrophysics',
    'astro-ph.GA': 'Galaxies',
    'astro-ph.CO': 'Cosmology',
    'astro-ph.EP': 'Planetary',
    'astro-ph.HE': 'High-energy',
    'astro-ph.IM': 'Instrumentation',
    'astro-ph.SR': 'Solar & stellar',
    'gr-qc': 'Gravitation',
    'hep-ph': 'HEP phenomenology',
    'hep-th': 'HEP theory',
    'hep-ex': 'HEP experiment',
    'nucl-th': 'Nuclear theory',
    'nucl-ex': 'Nuclear experiment',
    'quant-ph': 'Quantum physics',
    'physics.space-ph': 'Space physics',
    'physics.plasm-ph': 'Plasma physics',
    'physics.flu-dyn': 'Fluid dynamics',
    'physics.ao-ph': 'Atmospheric physics',
    'physics.comp-ph': 'Computational physics',
    'physics.data-an': 'Data analysis',
    'physics.optics': 'Optics',
    'physics.ins-det': 'Detectors',
    'physics.geo-ph': 'Geophysics',
    'physics.chem-ph': 'Chemical physics',
    'physics.atom-ph': 'Atomic physics',
    'physics.hist-ph': 'History of physics',
    'physics.soc-ph': 'Physics & society',
    'cond-mat.stat-mech': 'Statistical mechanics',
    'cs.LG': 'Machine learning',
    'cs.CV': 'Computer vision',
    'cs.AI': 'AI',
    'stat.ML': 'Statistical ML',
    'stat.ME': 'Statistical methods',
    'stat.AP': 'Applied statistics',
    'stat.CO': 'Statistical computing',
    'math.NA': 'Numerical analysis',
    'eess.SP': 'Signal processing',
    'eess.IV': 'Image processing',
};

export const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'can',
    'do', 'does', 'for', 'from', 'has', 'have', 'how', 'i', 'in',
    'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'over',
    'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
    'these', 'this', 'those', 'to', 'under', 'using', 'via', 'was',
    'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
    'why', 'will', 'with', 'within', 'without', 'work', 'working',
    'study', 'studies', 'research', 'paper', 'interested', 'interest',
    'my', 'me', 'about', 'also', 'between', 'based', 'new', 'use', 'used',
]);

export const NAME_PARTICLES = /^(van|von|der|den|de|del|della|di|da|du|le|la|dos|das|ter|ten|y|bin|al|el)$/i;
export const NAME_SUFFIXES = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
export const COLLABORATION_RE = /collaboration|team|consortium|survey|group|project/i;

export function getCategoryName(code) {
    if (!code) {
        return 'Astrophysics';
    }
    if (CATEGORY_NAMES[code]) {
        return CATEGORY_NAMES[code];
    }
    const prefix = code.split('.')[0];
    if (prefix === 'physics') {
        return 'Physics';
    }
    if (prefix === 'math') {
        return 'Mathematics';
    }
    if (prefix === 'cs') {
        return 'Computer science';
    }
    if (prefix === 'stat') {
        return 'Statistics';
    }
    if (prefix === 'cond-mat') {
        return 'Condensed matter';
    }
    return code;
}

export function getCategoryBadge(code) {
    return (code || '').split('.').pop().slice(0, 4).toUpperCase();
}
