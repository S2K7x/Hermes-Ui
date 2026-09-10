<script lang="ts">
	import { icon as lookup, type IconName } from '$lib/icons';

	interface Props {
		name: IconName;
		/** Square side in px. 18 is the row/button default, 24 the large one. */
		size?: number;
		/** Stroke weight. Slightly lighter on the big sizes. */
		width?: number;
	}
	let { name, size = 18, width = 1.75 }: Props = $props();
	let icon = $derived(lookup(name));
</script>

<!--
	Decorative by construction: every control carrying an icon is named by its
	own text or by an `aria-label`, so the glyph must not be read out a second
	time. `focusable="false"` is for IE-era Edge and old Safari, which put an
	inline SVG in the tab order otherwise.
-->
<svg
	class="icon"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width={width}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#each icon.stroke ?? [] as d (d)}
		<path {d} />
	{/each}
	{#each icon.fill ?? [] as d (d)}
		<path {d} fill="currentColor" stroke="none" />
	{/each}
</svg>

<style>
	.icon {
		/* Sits on the text's optical centre rather than on its baseline, which
		   is the single thing that makes a drawn icon look placed rather than
		   dropped in. */
		display: inline-block;
		vertical-align: -0.18em;
		flex: 0 0 auto;
	}
</style>
