export function buildIcon(paths, size = 20) {
    return (
        `<svg width='${size}' height='${size}' viewBox='0 0 24 24' fill='none' ` +
        `stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>` +
        `${paths}</svg>`
    );
}

export const ICONS = {
    skip: buildIcon(`<path d='M6 6l12 12M18 6L6 18'/>`, 22),
    close: buildIcon(`<path d='M6 6l12 12M18 6L6 18'/>`, 18),
    bookmark: buildIcon(`<path d='M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V4.5a1 1 0 0 1 1-1z'/>`, 22),
    back: buildIcon(`<path d='M9 14L4 9l5-5'/><path d='M4 9h10.5a5.5 5.5 0 0 1 0 11H11'/>`, 19),
    library: buildIcon(`<path d='M4 19.5V5a2 2 0 0 1 2-2h12a1 1 0 0 1 1 1v13H6a2 2 0 0 0-2 2.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H19v-4'/>`, 20),
    sliders: buildIcon(`<path d='M4 7h10M18 7h2M4 17h4M12 17h8'/><circle cx='16' cy='7' r='2'/><circle cx='10' cy='17' r='2'/>`, 20),
    text: buildIcon(`<path d='M4 6h16M4 12h16M4 18h10'/>`, 18),
    pdf: buildIcon(`<path d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'/><path d='M14 3v5h5'/>`, 18),
    arrow: buildIcon(`<path d='M7 17L17 7M8 7h9v9'/>`, 15),
    arrowRight: buildIcon(`<path d='M5 12h14M13 6l6 6-6 6'/>`, 18),
    code: buildIcon(`<path d='M8 8l-4 4 4 4M16 8l4 4-4 4'/>`, 13),
    compass: buildIcon(`<circle cx='12' cy='12' r='9'/><path d='M15.5 8.5l-2 5-5 2 2-5z'/>`, 14),
    spark: buildIcon(`<path d='M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6'/>`, 14),
    lock: buildIcon(`<rect x='5' y='11' width='14' height='10' rx='2'/><path d='M8 11V8a4 4 0 0 1 8 0v3'/>`, 14),
    copy: buildIcon(`<rect x='8' y='8' width='12' height='12' rx='2'/><path d='M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2'/>`, 15),
    download: buildIcon(`<path d='M12 4v11M7 10l5 5 5-5M5 20h14'/>`, 17),
};
