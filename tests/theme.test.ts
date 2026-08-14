import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_PRESET,
	PRESETS,
	contrastRatio,
	effectivePalette,
	ensureContrast,
	ensureVisible,
	luminance,
	mixHex,
	normalizeHex,
	normalizeTheme,
	presetById,
	readability,
	readableInk,
	themeColor,
	themeVariables
} from '../src/lib/theme.ts';

// --- hex parsing -----------------------------------------------------------

test('normalizeHex accepts the forms a colour input can produce', () => {
	assert.equal(normalizeHex('#EE7C2B'), '#ee7c2b');
	assert.equal(normalizeHex('ee7c2b'), '#ee7c2b');
	assert.equal(normalizeHex('#ABC'), '#aabbcc');
	assert.equal(normalizeHex('  #abc  '), '#aabbcc');
});

test('normalizeHex refuses anything that is not a colour', () => {
	for (const bad of ['', 'red', '#12345', 'rgb(1,2,3)', '#ee7c2z', null, 42, {}, undefined]) {
		assert.equal(normalizeHex(bad), null, String(bad));
	}
});

test('normalizeHex refuses a CSS injection dressed as a colour', () => {
	assert.equal(normalizeHex('#fff; background: url(x)'), null);
	assert.equal(normalizeHex('var(--accent)'), null);
});

// --- colour arithmetic -----------------------------------------------------

test('luminance matches the WCAG anchors', () => {
	assert.equal(Math.round(luminance('#ffffff') * 1000) / 1000, 1);
	assert.equal(luminance('#000000'), 0);
});

test('contrastRatio is symmetric and bounded by 21', () => {
	assert.equal(Math.round(contrastRatio('#ffffff', '#000000')), 21);
	assert.equal(contrastRatio('#000000', '#ffffff'), contrastRatio('#ffffff', '#000000'));
	assert.equal(contrastRatio('#ee7c2b', '#ee7c2b'), 1);
});

test('mixHex interpolates between the two ends', () => {
	assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
	assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');
	assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
	// Out-of-range factors are clamped, not extrapolated.
	assert.equal(mixHex('#000000', '#ffffff', 5), '#ffffff');
	assert.equal(mixHex('#000000', '#ffffff', -5), '#000000');
});

test('readableInk picks the ink that is actually readable', () => {
	assert.equal(readableInk('#ffffff'), '#1b1613');
	assert.equal(readableInk('#000000'), '#ffffff');
	// The default accent is a mid-bright orange: dark ink wins on it.
	assert.equal(readableInk('#ee7c2b'), '#1b1613');
	// The sage second accent is lighter still.
	assert.equal(readableInk('#a6be79'), '#1b1613');
});

test('ensureContrast deepens an accent only as far as white text needs', () => {
	const deep = ensureContrast('#ee7c2b', '#ffffff', '#2c211b');
	assert.ok(contrastRatio(deep, '#ffffff') >= 4.5, 'white must be readable on the result');
	// Still recognisably the accent: it did not walk all the way to the anchor.
	assert.notEqual(deep, '#2c211b');
	assert.ok(luminance(deep) < luminance('#ee7c2b'));
});

test('ensureContrast leaves a colour that already passes alone', () => {
	assert.equal(ensureContrast('#1c1b19', '#ffffff', '#000000'), '#1c1b19');
});

test('ensureContrast copes with a colour it cannot fix by deepening', () => {
	// Anchor and colour both bright: the loop runs out and returns the anchor
	// rather than looping forever or returning something unreadable.
	assert.equal(ensureContrast('#ffff00', '#ffffff', '#fffff0'), '#fffff0');
});

test('ensureVisible leaves a colour that already stands out alone', () => {
	// The default orange is already well clear of the dark surfaces.
	assert.equal(ensureVisible('#ee7c2b', ['#221f1c', '#141312'], '#f2ebe2'), '#ee7c2b');
});

test('ensureVisible lifts a colour that would vanish on one of the backgrounds', () => {
	// Fine on the pale surface, invisible on the dark one: the ring must clear
	// *both*, so it is nudged toward the ink.
	const ring = ensureVisible('#111111', ['#ffffff', '#101010'], '#ffffff');
	assert.notEqual(ring, '#111111');
	assert.ok(contrastRatio(ring, '#101010') >= 3);
	assert.ok(contrastRatio(ring, '#ffffff') >= 3);
});

test('ensureVisible falls back on the ink rather than looping', () => {
	// Nothing between white and white can clear a white background.
	assert.equal(ensureVisible('#ffffff', ['#ffffff'], '#fffffe'), '#fffffe');
});

test('the focus ring stays visible whatever accent is chosen', () => {
	// WCAG 1.4.11: a focus indicator needs 3:1 against what it sits on, and it
	// sits on the page, on a panel and inside a sunken field.
	const accents = [
		...PRESETS.flatMap((p) => [p.dark.accent, p.light.accent]),
		'#ffff00',
		'#ffffff',
		'#000000',
		'#7f7f7f',
		'#141312'
	];
	for (const preset of PRESETS) {
		for (const mode of ['dark', 'light'] as const) {
			for (const accent of accents) {
				const ring = themeVariables({ preset: preset.id, mode, accent })['--focus'];
				const palette = effectivePalette(normalizeTheme({ preset: preset.id, mode, accent }));
				for (const bg of [palette.surface, palette.bg, palette.sunken]) {
					assert.ok(
						contrastRatio(ring, bg) >= 3,
						`${preset.id}/${mode}/${accent} → ${ring} is ${contrastRatio(ring, bg).toFixed(2)}:1 on ${bg}`
					);
				}
			}
		}
	}
});

test('readability reports the ratio and whether AA is met', () => {
	const white = readability('#ffffff');
	assert.equal(white.ink, '#1b1613');
	assert.ok(white.ok);
	// The pinch point: a mid grey where neither ink reaches AA (4.24:1). This
	// is the case the panel exists to warn about.
	assert.equal(readability('#7b7b7b').ok, false);
	assert.equal(readability('#7b7b7b').ratio, 4.24);
});

// --- settings normalisation ------------------------------------------------

test('normalizeTheme falls back on every field it cannot trust', () => {
	assert.deepEqual(normalizeTheme(null), {
		preset: DEFAULT_PRESET,
		mode: 'dark',
		accent: null,
		accent2: null
	});
	assert.deepEqual(normalizeTheme({ preset: 'inconnu', mode: 'sepia', accent: 'red' }), {
		preset: DEFAULT_PRESET,
		mode: 'dark',
		accent: null,
		accent2: null
	});
});

test('normalizeTheme keeps what it can trust', () => {
	assert.deepEqual(normalizeTheme({ preset: 'nocturne', mode: 'light', accent2: '#ABC' }), {
		preset: 'nocturne',
		mode: 'light',
		accent: null,
		accent2: '#aabbcc'
	});
});

test('presetById never returns undefined', () => {
	assert.equal(presetById('verger').id, 'verger');
	assert.equal(presetById('n-importe-quoi').id, PRESETS[0].id);
});

test('preset ids are unique and every preset defines both modes', () => {
	const ids = PRESETS.map((p) => p.id);
	assert.equal(new Set(ids).size, ids.length);
	const keys = Object.keys(PRESETS[0].dark).sort();
	for (const preset of PRESETS) {
		assert.deepEqual(Object.keys(preset.dark).sort(), keys, preset.id);
		assert.deepEqual(Object.keys(preset.light).sort(), keys, preset.id);
		for (const palette of [preset.dark, preset.light]) {
			for (const [name, value] of Object.entries(palette)) {
				assert.equal(normalizeHex(value), value, `${preset.id}.${name}`);
			}
		}
	}
});

test('a preset stays legible: text on its own surface passes AA in both modes', () => {
	for (const preset of PRESETS) {
		for (const palette of [preset.dark, preset.light]) {
			assert.ok(
				contrastRatio(palette.text, palette.surface) >= 4.5,
				`${preset.id}: ${palette.text} on ${palette.surface}`
			);
			assert.ok(
				contrastRatio(palette.muted, palette.surface) >= 3,
				`${preset.id} muted: ${palette.muted} on ${palette.surface}`
			);
		}
	}
});

// --- settings → CSS --------------------------------------------------------

test('a custom accent wins over the preset, per field', () => {
	const p = effectivePalette(normalizeTheme({ preset: 'verger', accent: '#123456' }));
	assert.equal(p.accent, '#123456');
	assert.equal(p.accent2, presetById('verger').dark.accent2);
});

test('themeVariables produces a value for every token, in both modes', () => {
	for (const mode of ['dark', 'light'] as const) {
		const vars = themeVariables({ mode });
		for (const [name, value] of Object.entries(vars)) {
			assert.match(name, /^--[a-z0-9-]+$/, name);
			assert.ok(value.length > 0, name);
		}
	}
});

test('the mode changes what the variables say', () => {
	assert.notEqual(themeVariables({ mode: 'dark' })['--bg'], themeVariables({ mode: 'light' })['--bg']);
});

test('white is readable on the user bubble whatever accent is chosen', () => {
	// Every preset accent, plus the pathological cases a colour input allows.
	const accents = [
		...PRESETS.flatMap((p) => [p.dark.accent, p.light.accent, p.dark.accent2, p.light.accent2]),
		'#ffff00',
		'#ffffff',
		'#000000',
		'#7f7f7f'
	];
	for (const accent of accents) {
		for (const mode of ['dark', 'light'] as const) {
			const bubble = themeVariables({ mode, accent })['--user-bubble'];
			assert.ok(
				contrastRatio(bubble, '#ffffff') >= 4.4,
				`${accent} (${mode}) → ${bubble} is ${contrastRatio(bubble, '#ffffff').toFixed(2)}:1`
			);
		}
	}
});

test('themeColor is the page background, which is what the status bar shows', () => {
	assert.equal(themeColor({ preset: 'nocturne', mode: 'light' }), presetById('nocturne').light.bg);
});

/**
 * The stylesheet's literals are only the pre-hydration default. A token
 * declared there but never produced here would keep its default colour when
 * the user picks another preset — a stale swatch nobody would think to look
 * for. This is the guard against that.
 */
test('every themable token in app.css is produced by themeVariables', () => {
	const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
	const produced = new Set(Object.keys(themeVariables({})));
	// Shapes are the design, not a preference: they are never themed.
	const shapes = /^--(radius|gap|rail-width)/;

	const declared = new Set<string>();
	for (const match of css.matchAll(/^\t(--[a-z0-9-]+):/gm)) declared.add(match[1]);

	assert.ok(declared.size > 20, 'the stylesheet should declare the palette');
	for (const name of declared) {
		if (shapes.test(name)) continue;
		assert.ok(produced.has(name), `${name} is in app.css but never themed`);
	}
});
