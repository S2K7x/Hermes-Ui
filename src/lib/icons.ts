/**
 * The app's icon set: stroked paths on a 24×24 grid, and nothing else.
 *
 * Every control used to be labelled with an emoji. Emoji are not an icon set:
 * they are a *font*, so each platform draws its own — a 🔑 is a flat yellow key
 * on one machine, a glossy three-dimensional one on the next — they carry
 * colours the theme has no say over, they sit on a baseline rather than on a
 * grid, and their size is whatever the text size happens to be. A row of them
 * reads as decoration, which is exactly what a settings menu must not.
 *
 * These are drawn instead: one weight, one grid, `currentColor` throughout, so
 * an icon takes the colour of the control it sits in and follows every palette
 * of point 19 for free. No dependency — an icon library would be kilobytes of
 * JavaScript on the boot path of a Pi for a few dozen paths.
 *
 * `stroke` paths are drawn with round caps and joins; `fill` paths are solid.
 * Nothing here is a component, so `tests/icons.test.ts` can check the whole set
 * without a DOM.
 */

export interface IconDef {
	/** Stroked outlines, the usual case. */
	stroke?: string[];
	/** Solid shapes, for the few marks that need a filled area. */
	fill?: string[];
}

export const ICONS = {
	// --- navigation and chrome ---------------------------------------------
	menu: { stroke: ['M4 7h16', 'M4 12h16', 'M4 17h16'] },
	search: { stroke: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4.2-4.2'] },
	close: { stroke: ['M6 6l12 12', 'M18 6L6 18'] },
	plus: { stroke: ['M12 5v14', 'M5 12h14'] },
	chevronLeft: { stroke: ['M14 6l-6 6 6 6'] },
	chevronRight: { stroke: ['M10 6l6 6-6 6'] },
	chevronDown: { stroke: ['M6 9l6 6 6-6'] },
	arrowUp: { stroke: ['M12 19V5', 'M6 11l6-6 6 6'] },
	arrowDown: { stroke: ['M12 5v14', 'M18 13l-6 6-6-6'] },
	stop: { stroke: ['M7 7h10v10H7z'] },

	// --- composer ------------------------------------------------------------
	paperclip: {
		stroke: [
			'M20 11.5l-8.3 8.3a5 5 0 0 1-7-7l8.4-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7'
		]
	},
	bookmark: { stroke: ['M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z'] },

	// --- settings hub --------------------------------------------------------
	settings: {
		stroke: [
			'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
			'M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.5 1z'
		]
	},
	archive: { stroke: ['M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M2 4h20v4H2z', 'M10 12h4'] },
	trash: {
		stroke: [
			'M4 7h16',
			'M10 11v6',
			'M14 11v6',
			'M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12',
			'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'
		]
	},
	users: {
		stroke: [
			'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19',
			'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
			'M21 19v-1.5a3.5 3.5 0 0 0-2.6-3.4',
			'M15.5 4.2a3.5 3.5 0 0 1 0 6.6'
		]
	},
	clock: { stroke: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.4 2'] },
	book: {
		stroke: [
			'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z',
			'M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z'
		]
	},
	key: {
		stroke: [
			'M2.6 17.4A2 2 0 0 0 2 18.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4z',
			'M16.5 7.5h.01'
		]
	},
	// A disc half in shadow: the appearance control, and the only mark here
	// that needs a filled area to read at 18px.
	contrast: { stroke: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'], fill: ['M12 3v18a9 9 0 0 0 0-18z'] },
	activity: { stroke: ['M3 12h4l3 8 4-16 3 8h4'] },
	keyboard: {
		stroke: ['M3 6h18v12H3z', 'M7 10h.01', 'M11 10h.01', 'M15 10h.01', 'M8 14h8']
	},
	moon: { stroke: ['M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z'] },
	sun: {
		stroke: [
			'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
			'M12 2v2',
			'M12 20v2',
			'M4.2 4.2l1.4 1.4',
			'M18.4 18.4l1.4 1.4',
			'M2 12h2',
			'M20 12h2',
			'M4.2 19.8l1.4-1.4',
			'M18.4 5.6l1.4-1.4'
		]
	},
	phone: { stroke: ['M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z', 'M11 18.5h2'] },

	// --- status and feedback -------------------------------------------------
	warning: { stroke: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'] },
	check: { stroke: ['M5 13l4 4 10-11'] },
	info: { stroke: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 8h.01'] },
	restore: { stroke: ['M3 12a9 9 0 1 0 2.6-6.4', 'M3 4v5h5'] },
	pencil: { stroke: ['M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z'] },
	branch: {
		stroke: [
			'M7 8v3a4 4 0 0 0 4 4h4',
			'M7 22v-6',
			'M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
			'M18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
		]
	},
	message: { stroke: ['M21 11.5a8 8 0 0 1-8 8H5l-2 3v-9a8 8 0 0 1 8-8h2a8 8 0 0 1 8 6z'] },
	command: {
		stroke: [
			'M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z'
		]
	},
	chart: { stroke: ['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M2 20h20'] },

	// --- tool families (see toolIcon) ----------------------------------------
	plug: { stroke: ['M9 2v6', 'M15 2v6', 'M6 8h12v3a6 6 0 0 1-12 0z', 'M12 17v5'] },
	thought: { stroke: ['M8 16.5a4 4 0 0 1-.6-8A5 5 0 0 1 17 9a3.7 3.7 0 0 1-.6 7.4z', 'M8.5 20h.01', 'M12 22.5h.01'] },
	globe: {
		stroke: [
			'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
			'M3.5 12h17',
			'M12 3a14 14 0 0 1 0 18',
			'M12 3a14 14 0 0 0 0 18'
		]
	},
	terminal: { stroke: ['M4 5h16v14H4z', 'M8 10l2.5 2.5L8 15', 'M13.5 15H17'] },
	code: { stroke: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'] },
	file: { stroke: ['M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z', 'M14 3v4h4'] },
	layers: { stroke: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'] },
	image: {
		stroke: ['M4 5h16v14H4z', 'M9.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M20 16l-5-5-9 8']
	},
	checkSquare: { stroke: ['M9 12l2 2 4.5-4.5', 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'] },
	wrench: {
		stroke: [
			'M15 4.5a4.5 4.5 0 0 0-6 5.9L4 15.4V20h4.6l5-5a4.5 4.5 0 0 0 5.9-6l-3 3-2.5-2.5z'
		]
	}
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** The same map, widened so a lookup has both fields. */
export const icon = (name: IconName): IconDef => ICONS[name];

/** Every name the set defines — the test uses it, so does nothing else. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
