// ==UserScript==
// @name         Ticket image viewer
// @namespace    ticket-photo-viewer
// @version      1.00
// @description  Browse ticket photo attachments in an interactive gallery with zoom and fullscreen viewing.
// @icon         https://drive-render.corp.amazon.com/view/aolenche@/Icons/Ticket image viewer.png
// @author       aolenche
// @match        https://t.corp.amazon.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      maxis-file-service-prod-iad.iad.proxy.amazon.com
// @connect      maxis-file-service-prod-dub.dub.proxy.amazon.com
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Ticket-image-viewer.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Ticket-image-viewer.user.js
// ==/UserScript==

(() => {
    'use strict';

    const HOST_ID = 'ticket-photo-gallery';
    const FILE_HOSTS = new Set([
        'maxis-file-service-prod-iad.iad.proxy.amazon.com',
        'maxis-file-service-prod-dub.dub.proxy.amazon.com'
    ]);
    const ORIGINAL_LIMIT = 32 * 1024 * 1024;
    const VIEW_SURFACE_LIMIT = 96 * 1024 * 1024;
    const PIXEL_LIMIT = 64 * 1024 * 1024;
    const IMAGE_PATTERN = /\.(?:jpe?g|png|webp|avif|gif|bmp)$/i;
    const LOADING_VARIANT_COUNT = 50;
    let loadingVariant = chooseLoadingVariant();

    const STYLE = `
:host {
    display: block;
    margin: 16px 0;
    min-width: 0;
    color-scheme: light;
    --surface: #ffffff;
    --stage: #f2f3f3;
    --text: #414d5c;
    --heading: #0f141a;
    --muted: #52606d;
    --accent: #006ce0;
    --hover: #e9f4ff;
    --line: #d5dbdb;
    --control-line: #8c98a3;
    --radius: 16px;
    --button-radius: 20px;
    --thumb-size: 168px;
    --viewer-height: clamp(300px, 44vh, 540px);
    font: 14px "Amazon Ember", "Helvetica Neue", Roboto, Arial, sans-serif;
    color: var(--text);
}
:host([data-dark]) {
    color-scheme: dark;
    --surface: #161d26;
    --stage: #0d1117;
    --text: #c6c6cd;
    --heading: #ebebf0;
    --muted: #a4a4ad;
    --accent: #42b4ff;
    --hover: #1b232d;
    --line: #232b37;
    --control-line: #424650;
}
:host([data-widget]) { margin: 0; }
.drag-handle { cursor: grab; touch-action: none; color: var(--muted); margin-left: auto; }
:host([data-dragging]) { opacity: .55; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.gallery {
    background: var(--surface);
    border-radius: var(--radius);
    overflow: clip;
    min-width: 0;
    box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
}
.header, .heading, .actions, .tools, .file {
    display: flex;
    align-items: center;
    gap: 8px;
}
.header { padding: 16px 20px 12px; justify-content: space-between; flex-wrap: wrap; }
.heading { min-width: 0; }
h2 { margin: 0; font-size: 18px; font-weight: 700; color: var(--heading); }
.heading-toggle { font: inherit; color: var(--heading); gap: 8px; min-height: 24px; padding: 0; border: 0; border-radius: 0; }
.heading-toggle:hover:not(:disabled), .heading-toggle:active:not(:disabled) { background: transparent; transform: none; }
.heading-toggle svg { width: 20px; height: 20px; color: var(--text); transition: transform 150ms ease; }
.heading-toggle[aria-expanded="false"] svg { transform: rotate(-90deg); }
.heading-toggle .total { font-size: 14px; font-weight: 400; }
.content { min-width: 0; }
.total, .counter { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
button {
    font: inherit;
    font-weight: 700;
    color: var(--accent);
    border: 1px solid transparent;
    border-radius: var(--button-radius);
    background: transparent;
    min-height: 32px;
    padding: 4px 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    flex: 0 0 auto;
    cursor: pointer;
    transition: background-color 120ms ease, transform 100ms ease;
}
button:hover:not(:disabled) { background: var(--hover); }
button:active:not(:disabled) { transform: scale(.96); }
button:disabled { opacity: .38; cursor: default; }
button[aria-pressed="true"] { background: var(--hover); border-color: var(--accent); }
button:focus-visible, .viewport:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
}
.icon { width: 32px; padding: 6px; }
svg { width: 16px; height: 16px; display: block; flex: 0 0 auto; }
.toolbar {
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    border-top: 1px solid var(--line);
}
.file { flex: 1 1 180px; min-width: 0; }
.filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.counter { font-size: 12px; }
.tools { gap: 2px; flex-wrap: wrap; }
.zoom { min-width: 54px; font-size: 12px; font-variant-numeric: tabular-nums; }
.divider { width: 1px; height: 18px; margin: 0 5px; background: var(--control-line); }
.download { border-color: var(--accent); padding: 4px 14px; margin-left: 6px; }
.stage { position: relative; height: var(--viewer-height); background: var(--stage); overflow: hidden; isolation: isolate; }
.viewport {
    position: absolute;
    inset: 12px 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: pan-y;
    outline-offset: -3px;
}
.photo {
    display: block;
    flex: 0 0 auto;
    max-width: none;
    max-height: none;
    user-select: none;
    transform-origin: center;
    transition: transform 150ms ease;
}
.viewport.zoomed { cursor: grab; touch-action: none; }
.viewport.dragging { cursor: grabbing; }
.viewport.dragging .photo, .viewport.gesturing .photo { transition: none; }
.fit-photo { position: absolute; display: block; pointer-events: none; }
.navigation {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    width: min(380px, calc(100% - 32px));
    z-index: 2;
}
.nav {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    height: 64px;
    padding: 0;
    background: color-mix(in srgb, var(--surface) 28%, transparent);
    border: 0;
    border-radius: 8px;
    color: var(--heading);
}
.nav:hover:not(:disabled), .nav:active:not(:disabled) { background: color-mix(in srgb, var(--surface) 72%, transparent); transform: none; }
.nav:focus-visible { outline-offset: -4px; }
.nav svg {
    width: 44px;
    height: 44px;
    opacity: 0;
    filter: drop-shadow(0 1px 3px var(--stage));
    transition: opacity 150ms ease, transform 150ms ease;
}
.stage:hover .nav:not(:disabled) svg, .nav:focus-visible svg { opacity: .8; }
.nav:hover:not(:disabled) svg { opacity: 1; transform: scale(1.08); }
.dimensions {
    position: absolute;
    right: 12px;
    bottom: 10px;
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 12px;
    background: var(--surface);
    color: var(--text);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
}
.message {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;
    padding: 24px 55px;
    color: var(--text);
    text-align: center;
}
.message button { border-color: var(--accent); }
.loading-animation { display: flex; align-items: center; justify-content: center; gap: var(--loading-gap); height: 52px; color: #20baff; --loading-rise: 12px; --loading-travel: 9px; --loading-size: 12px; --loading-gap: 13px; }
.loading-dot { display: block; width: var(--loading-size); height: var(--loading-size); flex: 0 0 auto; border-radius: 50%; background: currentColor; opacity: .8; --loading-home: calc(var(--loading-size) + var(--loading-gap)); --loading-angle: 0deg; }
.loading-dot:nth-child(2) { --loading-offset: -.18s; --loading-home: 0px; --loading-angle: 120deg; background: #ffb000; }
.loading-dot:nth-child(3) { --loading-offset: -.36s; --loading-home: calc((var(--loading-size) + var(--loading-gap)) * -1); --loading-angle: 240deg; }
.message.loading:not([hidden]) .loading-dot,
.tile[data-loading-visible]:not(.failed) .thumb-missing:not([hidden]) .loading-dot {
    animation: var(--loading-motion, dot-wave) 1.8s ease-in-out infinite;
    animation-delay: calc(var(--loading-phase, 0s) + var(--loading-offset, 0s));
}
:host([data-loading-variant="0"]) { --loading-motion: dot-wave; }
:host([data-loading-variant="1"]) { --loading-motion: dot-hop; }
:host([data-loading-variant="2"]) { --loading-motion: dot-swing; }
:host([data-loading-variant="3"]) { --loading-motion: dot-flip; }
:host([data-loading-variant="4"]) { --loading-motion: dot-spin; }
:host([data-loading-variant="5"]) { --loading-motion: dot-orbit; }
:host([data-loading-variant="6"]) { --loading-motion: dot-shuffle; }
:host([data-loading-variant="7"]) { --loading-motion: dot-breathe; }
:host([data-loading-variant="8"]) { --loading-motion: dot-squeeze; }
:host([data-loading-variant="9"]) { --loading-motion: dot-float; }
:host([data-loading-variant="10"]) { --loading-motion: dot-pulse-chain; }
:host([data-loading-variant="11"]) { --loading-motion: dot-stream; }
:host([data-loading-variant="12"]) { --loading-motion: dot-double-wave; }
:host([data-loading-variant="13"]) { --loading-motion: dot-bouncy-arc; }
:host([data-loading-variant="14"]) { --loading-motion: dot-newton; }
:host([data-loading-variant="15"]) { --loading-motion: dot-leapfrog; }
:host([data-loading-variant="16"]) { --loading-motion: dot-treadmill; }
:host([data-loading-variant="17"]) { --loading-motion: dot-spinner; }
:host([data-loading-variant="18"]) { --loading-motion: dot-chaotic; }
:host([data-loading-variant="19"]) { --loading-motion: dot-helix; }
:host([data-loading-variant="20"]) { --loading-motion: dot-quantum; }
:host([data-loading-variant="21"]) { --loading-motion: dot-trio; }
:host([data-loading-variant="22"]) { --loading-motion: dot-momentum; }
:host([data-loading-variant="23"]) { --loading-motion: dot-superballs; }
:host([data-loading-variant="24"]) { --loading-motion: dot-infinity; }
:host([data-loading-variant="25"]) { --loading-motion: dot-trefoil; }
:host([data-loading-variant="26"]) { --loading-motion: dot-cardio; }
:host([data-loading-variant="27"]) { --loading-motion: dot-metronome; }
:host([data-loading-variant="28"]) { --loading-motion: dot-mirage; }
:host([data-loading-variant="29"]) { --loading-motion: dot-ping; }
:host([data-loading-variant="30"]) { --loading-motion: dot-pulsar; }
:host([data-loading-variant="31"]) { --loading-motion: dot-ripples; }
:host([data-loading-variant="32"]) { --loading-motion: dot-jelly; }
:host([data-loading-variant="33"]) { --loading-motion: dot-jelly-triangle; }
:host([data-loading-variant="34"]) { --loading-motion: dot-pinwheel; }
:host([data-loading-variant="35"]) { --loading-motion: dot-spiral; }
:host([data-loading-variant="36"]) { --loading-motion: dot-tail-chase; }
:host([data-loading-variant="37"]) { --loading-motion: dot-bouncy; }
:host([data-loading-variant="38"]) { --loading-motion: dot-waveform; }
:host([data-loading-variant="39"]) { --loading-motion: dot-hatch; }
:host([data-loading-variant="40"]) { --loading-motion: dot-jingle; }
:host([data-loading-variant="41"]) { --loading-motion: dot-rubber-h; }
:host([data-loading-variant="42"]) { --loading-motion: dot-rubber-v; }
:host([data-loading-variant="43"]) { --loading-motion: dot-rush-ltr; }
:host([data-loading-variant="44"]) { --loading-motion: dot-rush-up; }
:host([data-loading-variant="45"]) { --loading-motion: dot-slide-rtl; }
:host([data-loading-variant="46"]) { --loading-motion: dot-coin-h; }
:host([data-loading-variant="47"]) { --loading-motion: dot-coin-v; }
:host([data-loading-variant="48"]) { --loading-motion: dot-surprise; }
:host([data-loading-variant="49"]) { --loading-motion: dot-swim; }
:host([data-loading-paused]) .loading-dot { animation-play-state: paused !important; }
.message:not(.loading) .loading-animation { display: none; }
.thumb-missing .loading-animation { height: 34px; --loading-rise: 8px; --loading-travel: 6px; --loading-size: 8px; --loading-gap: 8px; }
@keyframes dot-wave {
    0%, 65%, 100% { transform: translateY(3px) scale(.8); opacity: .55; }
    28% { transform: translateY(calc(var(--loading-rise) * -1)) scale(1.25); opacity: 1; }
}
@keyframes dot-hop {
    0%, 65%, 100% { transform: translateY(0) scale(1); }
    15% { transform: translateY(4px) scale(1.4, .6); }
    32% { transform: translateY(calc(var(--loading-rise) * -1.25)) scale(.85, 1.2); }
    48% { transform: translateY(3px) scale(1.25, .75); }
}
@keyframes dot-swing {
    0%, 100% { transform: translate(calc(var(--loading-travel) * -1), 2px); }
    50% { transform: translate(var(--loading-travel), calc(var(--loading-rise) * -.6)); }
}
@keyframes dot-flip {
    0%, 100% { transform: scale(1); }
    30% { transform: translateY(calc(var(--loading-rise) * -.5)) scale(.15, 1.5); }
    65% { transform: translateY(3px) scale(1.45, .3); }
}
@keyframes dot-spin {
    0% { transform: rotate(0) translateX(var(--loading-travel)) scale(.8); }
    50% { transform: rotate(180deg) translateX(var(--loading-travel)) scale(1.25); }
    100% { transform: rotate(360deg) translateX(var(--loading-travel)) scale(.8); }
}
@keyframes dot-orbit {
    0%, 100% { transform: translate(0, calc(var(--loading-rise) * -1)) scale(.7); }
    25% { transform: translate(var(--loading-travel), 0) scale(1); }
    50% { transform: translate(0, var(--loading-rise)) scale(1.3); }
    75% { transform: translate(calc(var(--loading-travel) * -1), 0) scale(1); }
}
@keyframes dot-shuffle {
    0%, 100% { transform: translateX(calc(var(--loading-travel) * -1)) scale(.65); opacity: .5; }
    50% { transform: translateX(var(--loading-travel)) scale(1.35); opacity: 1; }
}
@keyframes dot-breathe {
    0%, 100% { transform: scale(.45); opacity: .4; }
    50% { transform: scale(1.5); opacity: 1; }
}
@keyframes dot-squeeze {
    0%, 70%, 100% { transform: scale(1); }
    25% { transform: scale(.5, 1.6); }
    48% { transform: scale(1.6, .5); }
}
@keyframes dot-float {
    0%, 100% { transform: translate(calc(var(--loading-travel) * -.65), 4px) scale(.7); opacity: .55; }
    50% { transform: translate(calc(var(--loading-travel) * .65), calc(var(--loading-rise) * -.8)) scale(1.3); opacity: 1; }
}
@keyframes dot-pulse-chain {
    0%, 100% {
        transform: scale(.5);
        opacity: 0.5;
    }
    25% {
        transform: scale(1.45);
        opacity: 1;
    }
    45% {
        transform: scale(.7);
        opacity: 0.7;
    }
    65% {
        transform: scale(1.15);
        opacity: 1;
    }
}
@keyframes dot-stream {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1), 0px) scale(0.65);
        opacity: 0.3;
    }
    35% {
        transform: translate(0px, 0px) scale(1.2);
        opacity: 1;
    }
    70% {
        transform: translate(var(--loading-travel), 0px) scale(0.65);
        opacity: 0.3;
    }
}
@keyframes dot-double-wave {
    0%, 100% {
        transform: translate(0px, 0px) scale(1);
    }
    25% {
        transform: translate(0px, calc(var(--loading-rise) * -1)) scale(1.2);
    }
    50% {
        transform: translate(0px, calc(var(--loading-rise) * 0.65)) scale(0.75);
    }
    75% {
        transform: translate(0px, calc(var(--loading-rise) * -0.65)) scale(1.1);
    }
}
@keyframes dot-bouncy-arc {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1), 0px) scale(0.8);
    }
    30% {
        transform: translate(0px, calc(var(--loading-rise) * -1)) scale(1.1);
    }
    60% {
        transform: translate(var(--loading-travel), 0px) scale(0.8);
    }
    80% {
        transform: translate(0px, calc(var(--loading-rise) * 0.35)) scale(1.1);
    }
}
@keyframes dot-newton {
    0%, 45%, 100% {
        transform: translateX(0);
    }
    20% {
        transform: translateX(calc(var(--loading-home) * .4));
    }
    70% {
        transform: translateX(calc(var(--loading-home) * -.4));
    }
}
@keyframes dot-leapfrog {
    0%, 100% {
        transform: translate(0px, 0px) scale(1);
    }
    25% {
        transform: translate(calc(var(--loading-home) * 1), calc(var(--loading-rise) * -1)) scale(.8);
    }
    50% {
        transform: translateX(calc(var(--loading-home) * 2));
    }
    75% {
        transform: translate(calc(var(--loading-home) * 1), calc(var(--loading-rise) * 0.5)) scale(1.2);
    }
}
@keyframes dot-treadmill {
    0%, 100% {
        transform: translateX(calc((var(--loading-size) + var(--loading-gap)) * -1)) scale(.7);
        opacity: 0.35;
    }
    50% {
        transform: translateX(calc(var(--loading-size) + var(--loading-gap))) scale(1.2);
        opacity: 1;
    }
}
@keyframes dot-spinner {
    0% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    25% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 90deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    50% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 180deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    75% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 270deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    100% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 360deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
}
@keyframes dot-chaotic {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1), calc(var(--loading-rise) * -0.5)) scale(0.65);
    }
    22% {
        transform: translate(calc(var(--loading-travel) * 0.3), calc(var(--loading-rise) * 0.8)) scale(1.25);
    }
    52% {
        transform: translate(var(--loading-travel), calc(var(--loading-rise) * -1)) scale(0.8);
    }
    78% {
        transform: translate(calc(var(--loading-travel) * -0.5), calc(var(--loading-rise) * 0.35)) scale(1.1);
    }
}
@keyframes dot-helix {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1), calc(var(--loading-rise) * -0.6)) scale(0.5);
        opacity: 0.5;
    }
    25% {
        transform: translate(0px, calc(var(--loading-rise) * 0.6)) scale(1.25);
        opacity: 1;
    }
    50% {
        transform: translate(var(--loading-travel), calc(var(--loading-rise) * -0.6)) scale(0.5);
        opacity: 0.5;
    }
    75% {
        transform: translate(0px, calc(var(--loading-rise) * -0.9)) scale(1.25);
        opacity: 1;
    }
}
@keyframes dot-quantum {
    0%, 100% {
        transform: translateX(var(--loading-home)) translate(calc(var(--loading-travel) * -1), 0px) scale(0.7);
    }
    25% {
        transform: translateX(var(--loading-home)) translate(0px, calc(var(--loading-rise) * -1)) scale(1.25);
    }
    50% {
        transform: translateX(var(--loading-home)) translate(var(--loading-travel), 0px) scale(0.7);
    }
    75% {
        transform: translateX(var(--loading-home)) translate(0px, var(--loading-rise)) scale(1.25);
    }
}
@keyframes dot-trio {
    0% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    33% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 120deg)) translateY(calc(var(--loading-rise) * -1)) scale(0.8);
    }
    66% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 240deg)) translateY(calc(var(--loading-rise) * -1)) scale(1.15);
    }
    100% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 360deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
}
@keyframes dot-momentum {
    0%, 100% {
        transform: translateX(calc(var(--loading-home) * .3)) scale(.8);
    }
    35% {
        transform: translateX(calc(var(--loading-home) * -.2)) scale(1.35, .8);
    }
    60% {
        transform: translateX(calc(var(--loading-home) * .15)) scale(.9, 1.2);
    }
}
@keyframes dot-superballs {
    0%, 100% {
        transform: translate(0px, 0px) scale(1);
    }
    18% {
        transform: translate(0px, calc(var(--loading-rise) * -1)) scale(1);
    }
    35% {
        transform: translateY(3px) scale(1.3,.7);
    }
    53% {
        transform: translate(0px, calc(var(--loading-rise) * -0.55)) scale(1);
    }
    70% {
        transform: translate(0px, 0px) scale(1);
    }
    84% {
        transform: translate(0px, calc(var(--loading-rise) * -0.2)) scale(1);
    }
}
@keyframes dot-infinity {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1), 0px) scale(1);
    }
    12.5% {
        transform: translate(calc(var(--loading-travel) * -0.5), calc(var(--loading-rise) * -0.6)) scale(1);
    }
    25% {
        transform: translate(0px, 0px) scale(1);
    }
    37.5% {
        transform: translate(calc(var(--loading-travel) * 0.5), calc(var(--loading-rise) * 0.6)) scale(1);
    }
    50% {
        transform: translate(var(--loading-travel), 0px) scale(1);
    }
    62.5% {
        transform: translate(calc(var(--loading-travel) * 0.5), calc(var(--loading-rise) * -0.6)) scale(1);
    }
    75% {
        transform: translate(0px, 0px) scale(1);
    }
    87.5% {
        transform: translate(calc(var(--loading-travel) * -0.5), calc(var(--loading-rise) * 0.6)) scale(1);
    }
}
@keyframes dot-trefoil {
    0% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    16.7% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 60deg)) translateY(calc(var(--loading-rise) * -0.25)) scale(0.7);
    }
    33.3% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 120deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    50% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 180deg)) translateY(calc(var(--loading-rise) * -0.25)) scale(0.7);
    }
    66.7% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 240deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    83.3% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 300deg)) translateY(calc(var(--loading-rise) * -0.25)) scale(0.7);
    }
    100% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 360deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
}
@keyframes dot-cardio {
    0%, 70%, 100% {
        transform: translate(0px, 0px) scale(1);
    }
    18% {
        transform: translate(calc(var(--loading-travel) * -0.4), 0px) scale(1);
    }
    28% {
        transform: translate(calc(var(--loading-travel) * -0.2), calc(var(--loading-rise) * -0.4)) scale(1);
    }
    38% {
        transform: translate(0px, calc(var(--loading-rise) * 0.6)) scale(1);
    }
    48% {
        transform: translate(calc(var(--loading-travel) * 0.2), calc(var(--loading-rise) * -1)) scale(1);
    }
    60% {
        transform: translate(calc(var(--loading-travel) * 0.4), 0px) scale(1);
    }
}
@keyframes dot-metronome {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1), calc(var(--loading-rise) * 0.3)) scale(0.75);
    }
    25% {
        transform: translate(calc(var(--loading-travel) * -0.5), calc(var(--loading-rise) * -0.4)) scale(1);
    }
    50% {
        transform: translate(var(--loading-travel), calc(var(--loading-rise) * 0.3)) scale(0.75);
    }
    75% {
        transform: translate(calc(var(--loading-travel) * 0.5), calc(var(--loading-rise) * -0.4)) scale(1);
    }
}
@keyframes dot-mirage {
    0%, 100% {
        transform: scale(.3);
        opacity: 0.2;
    }
    40% {
        transform: scale(1.65);
        opacity: 0.8;
    }
    70% {
        transform: scale(1.1);
        opacity: 0.35;
    }
}
@keyframes dot-ping {
    0%, 100% {
        transform: scale(.25);
        opacity: 0.8;
    }
    65% {
        transform: scale(1.9);
        opacity: 0.15;
    }
    85% {
        transform: scale(1.9);
        opacity: 0.15;
    }
}
@keyframes dot-pulsar {
    0%, 100% {
        transform: scale(.4);
        opacity: 0.5;
    }
    18% {
        transform: scale(1.5);
        opacity: 1;
    }
    40% {
        transform: scale(.55);
        opacity: 0.6;
    }
    58% {
        transform: scale(1.4);
        opacity: 1;
    }
    80% {
        transform: scale(.4);
        opacity: 0.5;
    }
}
@keyframes dot-ripples {
    0% {
        transform: translateX(var(--loading-home)) scale(.2);
        opacity: 0.9;
    }
    60% {
        transform: translateX(var(--loading-home)) scale(1.8);
        opacity: 0.2;
    }
    100% {
        transform: translateX(var(--loading-home)) scale(.2);
        opacity: 0.9;
    }
}
@keyframes dot-jelly {
    0%, 100% {
        transform: translate(0px, 0px) scale(1);
    }
    25% {
        transform: translateX(calc(var(--loading-travel) * -1)) scale(1.45,.65);
    }
    55% {
        transform: translateX(var(--loading-travel)) scale(.65,1.4);
    }
    80% {
        transform: scale(1.2,.8);
    }
}
@keyframes dot-jelly-triangle {
    0%, 100% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -1)) scale(1);
    }
    25% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 35deg)) translateY(calc(var(--loading-rise) * -0.7)) scale(0.65);
    }
    50% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -0.8)) scale(1.4);
    }
    75% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + -35deg)) translateY(calc(var(--loading-rise) * -0.6)) scale(0.8);
    }
}
@keyframes dot-pinwheel {
    0% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -1)) scale(0.8);
    }
    20% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 90deg)) translateY(calc(var(--loading-rise) * -1)) scale(1.35);
    }
    50% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 180deg)) translateY(calc(var(--loading-rise) * -1)) scale(0.65);
    }
    75% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 270deg)) translateY(calc(var(--loading-rise) * -1)) scale(1.2);
    }
    100% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 360deg)) translateY(calc(var(--loading-rise) * -1)) scale(0.8);
    }
}
@keyframes dot-spiral {
    0% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -0.2)) scale(0.45);
    }
    33% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 120deg)) translateY(calc(var(--loading-rise) * -0.6)) scale(0.8);
    }
    66% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 240deg)) translateY(calc(var(--loading-rise) * -1)) scale(1.15);
    }
    100% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 360deg)) translateY(calc(var(--loading-rise) * -0.2)) scale(0.45);
    }
}
@keyframes dot-tail-chase {
    0%, 15% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 0deg)) translateY(calc(var(--loading-rise) * -1)) scale(0.9);
    }
    65% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 300deg)) translateY(calc(var(--loading-rise) * -1)) scale(1.1);
    }
    100% {
        transform: translateX(var(--loading-home)) rotate(calc(var(--loading-angle) + 360deg)) translateY(calc(var(--loading-rise) * -1)) scale(0.9);
    }
}
@keyframes dot-bouncy {
    0%, 100% {
        transform: translate(0px, calc(var(--loading-rise) * -1)) scale(0.85);
    }
    35% {
        transform: translate(0px, calc(var(--loading-rise) * 0.7)) scale(1);
    }
    50% {
        transform: translateY(3px) scale(1.4,.6);
    }
    75% {
        transform: translate(0px, calc(var(--loading-rise) * -0.7)) scale(1.1);
    }
}
@keyframes dot-waveform {
    0%, 100% {
        transform: scale(.8,.4);
        opacity: 0.6;
    }
    30% {
        transform: scale(.9,2.4);
        opacity: 1;
    }
    60% {
        transform: scale(1.3,.75);
        opacity: 0.8;
    }
}
@keyframes dot-hatch {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1), calc(var(--loading-rise) * 0.3)) scale(0.5);
        opacity: 0.35;
    }
    25% {
        transform: translateY(calc(var(--loading-rise) * -0.4)) scale(.4,1.3);
        opacity: 0.8;
    }
    50% {
        transform: translate(var(--loading-travel), calc(var(--loading-rise) * 0.3)) scale(1.1);
        opacity: 1;
    }
    75% {
        transform: translateY(calc(var(--loading-rise) * 0.4)) scale(1.3,.4);
        opacity: 0.65;
    }
}
@keyframes dot-jingle {
    0%, 60%, 100% {
        transform: translate(0px, 0px) scale(1);
    }
    10% {
        transform: translate(calc(var(--loading-travel) * -1), calc(var(--loading-rise) * -0.2)) scale(1);
    }
    20% {
        transform: translate(var(--loading-travel), calc(var(--loading-rise) * 0.2)) scale(1);
    }
    30% {
        transform: translate(calc(var(--loading-travel) * -0.7), calc(var(--loading-rise) * -0.2)) scale(1);
    }
    40% {
        transform: translate(calc(var(--loading-travel) * 0.7), calc(var(--loading-rise) * 0.2)) scale(1);
    }
    50% {
        transform: translate(calc(var(--loading-travel) * -0.3), 0px) scale(1);
    }
}
@keyframes dot-rubber-h {
    0%, 70%, 100% {
        transform: scale(1);
    }
    20% {
        transform: scale(1.8,.65);
    }
    38% {
        transform: scale(.6,1.3);
    }
    55% {
        transform: scale(1.2,.85);
    }
}
@keyframes dot-rubber-v {
    0%, 70%, 100% {
        transform: scale(1);
    }
    20% {
        transform: scale(.65,1.8);
    }
    38% {
        transform: scale(1.3,.6);
    }
    55% {
        transform: scale(.85,1.2);
    }
}
@keyframes dot-rush-ltr {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1.3), 0px) scale(0.5);
        opacity: 0.2;
    }
    20% {
        transform: translate(calc(var(--loading-travel) * -1.3), 0px) scale(0.5);
        opacity: 0.2;
    }
    55% {
        transform: translate(calc(var(--loading-travel) * 1.3), 0px) scale(1.2);
        opacity: 1;
    }
    80% {
        transform: translate(calc(var(--loading-travel) * 1.3), 0px) scale(0.5);
        opacity: 0.2;
    }
}
@keyframes dot-rush-up {
    0%, 100% {
        transform: translate(0px, calc(var(--loading-rise) * 0.8)) scale(0.6);
        opacity: 0.25;
    }
    25% {
        transform: translate(0px, calc(var(--loading-rise) * 0.8)) scale(0.6);
        opacity: 0.25;
    }
    65% {
        transform: translate(0px, calc(var(--loading-rise) * -1.2)) scale(1.2);
        opacity: 1;
    }
    85% {
        transform: translate(0px, calc(var(--loading-rise) * -1.2)) scale(0.6);
        opacity: 0.25;
    }
}
@keyframes dot-slide-rtl {
    0%, 100% {
        transform: translate(var(--loading-travel), 0px) scale(0.8);
        opacity: 0.3;
    }
    30% {
        transform: translate(calc(var(--loading-travel) * 0.3), 0px) scale(1.15);
        opacity: 1;
    }
    65% {
        transform: translate(calc(var(--loading-travel) * -1), 0px) scale(0.8);
        opacity: 0.3;
    }
}
@keyframes dot-coin-h {
    0%, 100% {
        transform: translateX(calc(var(--loading-travel) * -1)) scale(1,1);
    }
    25% {
        transform: scale(.15,1.2);
    }
    50% {
        transform: translateX(var(--loading-travel)) scale(1,1);
    }
    75% {
        transform: scale(.15,1.2);
    }
}
@keyframes dot-coin-v {
    0%, 100% {
        transform: translateY(calc(var(--loading-rise) * 0.4)) scale(1);
    }
    25% {
        transform: scale(1.2,.15);
    }
    50% {
        transform: translateY(calc(var(--loading-rise) * -0.6)) scale(1);
    }
    75% {
        transform: scale(1.2,.15);
    }
}
@keyframes dot-surprise {
    0%, 65%, 100% {
        transform: scale(.65);
        opacity: 0.6;
    }
    20% {
        transform: translateY(3px) scale(1,.45);
        opacity: 0.8;
    }
    35% {
        transform: translateY(calc(var(--loading-rise) * -1.1)) scale(1.4);
        opacity: 1;
    }
    52% {
        transform: scale(.8,1.15);
        opacity: 0.8;
    }
}
@keyframes dot-swim {
    0%, 100% {
        transform: translate(calc(var(--loading-travel) * -1),calc(var(--loading-rise) * 0.4)) scale(1.15,.8);
    }
    25% {
        transform: translate(0px,calc(var(--loading-rise) * -0.5)) scale(.8,1.15);
    }
    50% {
        transform: translate(var(--loading-travel),calc(var(--loading-rise) * 0.4)) scale(1.15,.8);
    }
    75% {
        transform: translate(0px,calc(var(--loading-rise) * 0.7)) scale(.8,1.15);
    }
}
.message.over-photo {
    inset: auto 12px 88px;
    width: max-content;
    max-width: calc(100% - 24px);
    margin: 0 auto;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--surface);
    font-size: 12px;
    pointer-events: none;
}
.message.over-photo { flex-direction: row; gap: 10px; }
.message.over-photo .loading-animation { height: 28px; --loading-rise: 6px; --loading-travel: 5px; --loading-size: 6px; --loading-gap: 6px; }
.message.loading.switching-photo .message-text { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.filmstrip { display: flex; align-items: center; gap: 6px; padding: 10px 12px 4px; border-bottom: 1px solid var(--line); min-width: 0; }
.thumbs { display: flex; flex: 1 1 auto; min-width: 0; gap: 8px; overflow-x: auto; padding: 4px 3px 8px; scrollbar-width: thin; scrollbar-color: var(--control-line) transparent; overscroll-behavior-x: contain; }
.tile { flex: 0 0 var(--thumb-size); position: relative; min-width: 0; }
.select {
    display: block;
    width: 100%;
    height: calc(var(--thumb-size) * .68);
    padding: 3px;
    border: 2px solid transparent;
    border-radius: 8px;
    background: var(--stage);
    overflow: hidden;
}
.select[aria-pressed="true"] { border-color: var(--accent); background: var(--stage); }
.select img { display: block; width: 100%; height: 100%; object-fit: contain; border-radius: 3px; }
.number {
    position: absolute;
    top: 6px;
    left: 7px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
}
.thumb-download { position: absolute; bottom: 5px; right: 5px; width: 28px; min-height: 28px; padding: 5px; background: var(--surface); border-color: var(--control-line); }
.thumb-missing { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; color: var(--muted); font-size: 12px; }
.tile.failed .thumb-missing { padding: 8px 24px 8px 8px; font-size: 11px; }
.help { padding: 16px 20px; background: var(--surface); border-block: 1px solid var(--line); }
.shortcut-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 32px; }
.shortcut { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.shortcut-label { color: var(--text); }
.keys { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; flex: 0 0 auto; }
kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 30px;
    min-height: 29px;
    padding: 3px 8px;
    border: 1px solid var(--control-line);
    border-bottom-width: 3px;
    border-radius: 6px;
    background: var(--hover);
    color: var(--heading);
    font: 500 12px "Amazon Ember", "Helvetica Neue", Roboto, Arial, sans-serif;
    white-space: nowrap;
}
.help-note { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.status { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.empty { margin: 0; padding: 14px 20px 20px; color: var(--muted); }
.gallery:fullscreen, :host([data-expanded]) .gallery {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    border-radius: 0;
    padding: 0;
    background: var(--surface);
}
.gallery:fullscreen .stage, :host([data-expanded]) .stage { flex: 1 1 0; height: auto; min-height: 0; }
.gallery:fullscreen .content, :host([data-expanded]) .content { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
.gallery:fullscreen .nav svg, :host([data-expanded]) .nav svg { width: 56px; height: 56px; }
.gallery:fullscreen .nav, :host([data-expanded]) .nav { height: 80px; }
.gallery:fullscreen .message.over-photo, :host([data-expanded]) .message.over-photo { bottom: 104px; }
.gallery:fullscreen .header, :host([data-expanded]) .header { padding: 8px 20px; }
.gallery:fullscreen .toolbar, :host([data-expanded]) .toolbar { padding: 5px 20px; }
.gallery:fullscreen .filmstrip, :host([data-expanded]) .filmstrip { padding-top: 6px; padding-bottom: 0; }
:host([data-expanded]) { position: fixed; inset: 0; margin: 0; z-index: 2147483647; }
@media (max-width: 600px) {
    .header { padding: 14px 12px 10px; }
    .toolbar { padding: 8px 12px; gap: 6px; }
    .file { flex-basis: 100%; }
    .tools { width: 100%; }
    .download { margin-left: auto; padding: 4px 10px; }
    .divider { display: none; }
    .viewport { inset: 12px 42px; }
    .navigation { width: min(320px, calc(100% - 24px)); }
    .nav { height: 56px; }
    .dimensions { bottom: 84px; }
    .message.over-photo { bottom: 80px; }
    .nav svg { width: 36px; height: 36px; }
    .shortcut-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; }
    .filmstrip { padding-left: 6px; padding-right: 6px; gap: 2px; }
}
@media (pointer: coarse) {
    button { min-height: 44px; }
    .icon, .nav { min-width: 44px; min-height: 44px; }
    .nav:not(:disabled) svg { opacity: .8; }
    .viewport { inset-inline: 50px; }
    .thumb-download { width: 44px; min-height: 44px; }
    .select { min-height: 96px; }
}
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

    function chooseLoadingVariant() {
        let previous = -1;
        try { previous = GM_getValue('loading-animation-variant', -1); } catch {}
        const valid = Number.isInteger(previous) && previous >= 0 && previous < LOADING_VARIANT_COUNT;
        const next = valid ? (previous + 1 + Math.floor(Math.random() * (LOADING_VARIANT_COUNT - 1))) % LOADING_VARIANT_COUNT : Math.floor(Math.random() * LOADING_VARIANT_COUNT);
        try { GM_setValue('loading-animation-variant', next); } catch {}
        return next;
    }

    function loadingMarkup() {
        const dot = '<span class="loading-dot"></span>';
        return `<div class="loading-animation" aria-hidden="true" style="--loading-phase: -${performance.now() % 1800}ms">${dot.repeat(3)}</div>`;
    }

    function routeContext(pathname = location.pathname, informationOnly = true) {
        const pattern = informationOnly ? /^\/([^/]+)\/information\/?$/ : /^\/([^/]+)(?:\/|$)/;
        const match = pattern.exec(pathname);
        if (!match) return null;
        try {
            const ticket = decodeURIComponent(match[1]);
            return /^[A-Za-z0-9_-]+$/.test(ticket) ? ticket : null;
        } catch {
            return null;
        }
    }

    function attachmentURL(raw, ticket) {
        try {
            const url = new URL(raw, 'https://t.corp.amazon.com');
            const parts = url.pathname.split('/');
            if (url.protocol !== 'https:' || !FILE_HOSTS.has(url.hostname) || url.port || url.username || url.password) return null;
            if (parts.length !== 5 || parts[1] !== 'issues' || parts[3] !== 'attachments' || !parts[4]) return null;
            if (decodeURIComponent(parts[2]) !== ticket) return null;
            return raw.startsWith('https://') ? raw : url.href;
        } catch {
            return null;
        }
    }

    function readPhotos(block, ticket) {
        const seen = new Set();
        const photos = [];
        for (const anchor of block.querySelectorAll('a[href]')) {
            const name = anchor.getAttribute('download') || anchor.textContent || '';
            if (!IMAGE_PATTERN.test(name)) continue;
            const url = attachmentURL(anchor.getAttribute('href') || '', ticket);
            if (!url || seen.has(url)) continue;
            seen.add(url);
            photos.push({ name, url });
        }
        return photos;
    }

    function photoSignature(photos) {
        return JSON.stringify(photos.map(photo => [photo.url, photo.name]));
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function downloadName(photo) {
        return photo.name;
    }

    function icon(name) {
        if (name === 'disclosure') return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 11 4-6H4l4 6Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
        const paths = {
            grip: '<circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
            left: '<path d="m14 6-6 6 6 6"/>',
            right: '<path d="m10 6 6 6-6 6"/>',
            minus: '<path d="M5 12h14"/>',
            plus: '<path d="M5 12h14M12 5v14"/>',
            rotate: '<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
            fullscreen: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
            close: '<path d="m6 6 12 12M18 6 6 18"/>',
            download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
            keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/>'
        };
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
    }

    function button(action, label, symbol, className = 'icon') {
        return `<button type="button" class="${className}" data-action="${action}" aria-label="${label}" title="${label}">${symbol ? icon(symbol) : label}</button>`;
    }

    function aborted() {
        return new DOMException('Cancelled', 'AbortError');
    }

    function jpegMetadata(bytes) {
        const result = { width: 0, height: 0, orientation: 1, preview: null };
        if (bytes[0] !== 255 || bytes[1] !== 216) return result;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let p = 2; p + 4 < bytes.length;) {
            if (bytes[p] !== 255) break;
            const marker = bytes[p + 1];
            p += 2;
            if (marker === 218 || marker === 217) break;
            const length = view.getUint16(p);
            if (length < 2 || p + length > bytes.length) break;
            if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
                result.height = view.getUint16(p + 3);
                result.width = view.getUint16(p + 5);
            }
            if (marker === 225 && length > 16 && bytes[p + 2] === 69 && bytes[p + 3] === 120 && bytes[p + 4] === 105 && bytes[p + 5] === 102) {
                try {
                    const base = p + 8, end = p + length;
                    const little = view.getUint16(base) === 18761;
                    const u16 = offset => { if (offset < base || offset + 2 > end) throw new Error('EXIF bounds'); return view.getUint16(offset, little); };
                    const u32 = offset => { if (offset < base || offset + 4 > end) throw new Error('EXIF bounds'); return view.getUint32(offset, little); };
                    if (u16(base + 2) === 42) {
                        const first = base + u32(base + 4), count = u16(first);
                        for (let i = 0; i < count; i++) {
                            const entry = first + 2 + i * 12;
                            if (u16(entry) === 274 && u16(entry + 2) === 3 && u32(entry + 4) === 1) result.orientation = u16(entry + 8);
                        }
                        const next = u32(first + 2 + count * 12);
                        if (next) {
                            const second = base + next, entries = u16(second);
                            let offset = 0, size = 0;
                            for (let i = 0; i < entries; i++) {
                                const entry = second + 2 + i * 12, tag = u16(entry);
                                if (tag === 513) offset = u32(entry + 8);
                                if (tag === 514) size = u32(entry + 8);
                            }
                            if (offset && size && base + offset + size <= end) result.preview = bytes.slice(base + offset, base + offset + size);
                        }
                    }
                } catch {}
            }
            p += length;
        }
        if (result.orientation >= 5 && result.orientation <= 8) [result.width, result.height] = [result.height, result.width];
        return result;
    }

    class PhotoStore {
        constructor() {
            this.assets = new Map();
            this.jobs = new Map();
            this.queue = [];
            this.running = 0;
            this.dead = false;
            this.paused = false;
            this.keep = new Set();
            this.current = '';
            this.pins = new Map();
            this.downloadUrls = new Set();
            this.decodes = new Set();
            this.foregroundPending = false;
            this.warm = '';
            this.views = new Map();
            this.viewJobs = new Map();
        }

        setCurrent(photos, index) {
            this.current = photos[index]?.url || '';
            if (this.warm !== this.current) this.clearWarm();
            this.foregroundPending = true;
            this.keep = new Set(photos.slice(Math.max(0, index - 1), index + 2).map(photo => photo.url));
            for (const job of this.jobs.values()) {
                if (job.photo.url === this.current || job.priority < 0) continue;
                if (job.request || (job.priority === 0 && this.queue.includes(job))) {
                    job.cancelled = true;
                    this.queue = this.queue.filter(item => item !== job);
                    this.jobs.delete(job.key);
                    job.readyReject?.(aborted());
                    job.reject(aborted());
                    job.request?.abort();
                }
            }
            this.trim();
        }

        releaseForeground() {
            this.foregroundPending = false;
            this.pump();
        }

        pause(value) {
            this.paused = value;
            if (value) {
                this.clearWarm();
                for (const job of this.jobs.values()) {
                    if (job.priority > 0 && job.request) job.request.abort();
                }
            } else {
                this.pump();
            }
        }

        clearWarm() {
            const key = this.warm;
            const asset = this.assets.get(key);
            this.warm = '';
            if (!asset) return;
            asset.warmImage?.removeAttribute('src');
            asset.warmImage = null;
            if (key !== this.current && !this.pins.has(key) && asset.fullUrl) {
                URL.revokeObjectURL(asset.fullUrl);
                asset.fullUrl = null;
                asset.decoded = false;
            }
        }

        pin(url) {
            this.pins.set(url, (this.pins.get(url) || 0) + 1);
            let released = false;
            return () => {
                if (released) return;
                released = true;
                const remaining = (this.pins.get(url) || 1) - 1;
                if (remaining) this.pins.set(url, remaining);
                else this.pins.delete(url);
                this.trim();
            };
        }

        thumbnail(photo) {
            if (this.dead) return Promise.reject(aborted());
            const cached = this.assets.get(photo.url);
            if (cached?.thumbUrl) return Promise.resolve(cached);
            const key = `thumb:${photo.url}`;
            const pending = this.jobs.get(key);
            if (pending) return pending.promise;
            const full = this.jobs.get(photo.url);
            if (full && !cached?.fullUrl) return full.ready.then(() => this.thumbnail(photo));
            return this.enqueue(photo, photo.url === this.current ? 1 : 2, key, true).promise;
        }

        get(photo, priority = 0) {
            if (this.dead) return Promise.reject(aborted());
            const cached = this.assets.get(photo.url);
            if (cached?.blob) {
                if (!cached.fullUrl) { cached.fullUrl = URL.createObjectURL(cached.blob); cached.decoded = false; }
                cached.used = Date.now();
                return Promise.resolve(cached);
            }
            const pending = this.jobs.get(photo.url);
            if (pending) {
                pending.priority = Math.min(pending.priority, priority);
                this.pump();
                return pending.ready;
            }
            const thumbnail = this.jobs.get(`thumb:${photo.url}`);
            if (thumbnail) {
                thumbnail.priority = Math.min(thumbnail.priority, priority);
                this.pump();
                return thumbnail.ready;
            }
            return this.enqueue(photo, priority, photo.url, false).ready;
        }

        enqueue(photo, priority, key, thumbnail) {
            const job = { photo, priority, request: null, key, thumbnail };
            job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
            job.ready = new Promise((resolve, reject) => Object.assign(job, { readyResolve: resolve, readyReject: reject }));
            job.promise.catch(() => {});
            job.ready.catch(() => {});
            this.jobs.set(key, job);
            this.queue.push(job);
            this.pump();
            return job;
        }

        downloadURL(photo) {
            if (this.dead) return Promise.reject(aborted());
            const cached = this.assets.get(photo.url);
            if (cached?.blob) {
                if (!cached.fullUrl) { cached.fullUrl = URL.createObjectURL(cached.blob); cached.decoded = false; }
                return Promise.resolve({ url: cached.fullUrl, release: this.pin(photo.url) });
            }
            const key = `download:${photo.url}`;
            const pending = this.jobs.get(key);
            if (pending) return pending.promise;
            const job = { photo, key, priority: -1, download: true, request: null };
            job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
            this.jobs.set(key, job);
            this.queue.push(job);
            this.pump();
            return job.promise;
        }

        pump() {
            if (this.dead) return;
            this.queue.sort((a, b) => a.priority - b.priority);
            while (this.running < 1 && this.queue.length) {
                const job = this.queue[0];
                if (this.paused && job.priority >= 0) break;
                if (this.foregroundPending && job.priority > 0) break;
                this.queue.shift();
                this.running++;
                this.run(job).then(job.resolve, error => { job.readyReject?.(error); job.reject(error); }).finally(() => {
                    this.running--;
                    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
                    this.trim();
                    this.pump();
                });
            }
        }

        requestBlob(job) {
            return new Promise((resolve, reject) => {
                try {
                    job.request = GM_xmlhttpRequest({
                        method: 'GET',
                        url: job.photo.url,
                        responseType: 'blob',
                        nocache: true,
                        timeout: 30000,
                        headers: {
                            Accept: 'image/*',
                            'Cache-Control': 'no-store'
                        },
                        onload: response => {
                            const blob = response.response;
                            if (response.status < 200 || response.status >= 300) {
                                reject(new Error(`Photo request failed (${response.status}).`));
                            } else if (!blob || typeof blob.size !== 'number' || !blob.size) {
                                reject(new Error('The photo response is empty.'));
                            } else if (!job.download && blob.size > ORIGINAL_LIMIT) {
                                reject(new Error('This photo exceeds the 32 MB preview limit.'));
                            } else if (/text\/html/i.test(blob.type)) {
                                reject(new Error('Sign in to the attachment service, then retry.'));
                            } else {
                                resolve(blob);
                            }
                        },
                        onerror: () => reject(new Error('Could not read the photo. Check the attachment service access.')),
                        ontimeout: () => reject(new Error('The photo request timed out.')),
                        onabort: () => reject(aborted())
                    });
                } catch (error) {
                    reject(error);
                }
            });
        }

        async run(job) {
            const cached = this.assets.get(job.photo.url);
            if (job.thumbnail && cached?.blob) {
                if (!cached.fullUrl) { cached.fullUrl = URL.createObjectURL(cached.blob); cached.decoded = false; }
                job.readyResolve(cached);
                return this.prepareThumbnail(cached, job.photo);
            }
            const blob = await this.requestBlob(job);
            job.request = null;
            if (this.dead || job.cancelled) throw aborted();
            const fullUrl = URL.createObjectURL(blob);
            if (job.download) {
                this.downloadUrls.add(fullUrl);
                return {
                    url: fullUrl,
                    release: () => {
                        URL.revokeObjectURL(fullUrl);
                        this.downloadUrls.delete(fullUrl);
                    }
                };
            }
            try {
                const metadata = jpegMetadata(new Uint8Array(await blob.slice(0, 131072).arrayBuffer()));
                let width = metadata.width, height = metadata.height;
                const decoded = !width || !height;
                if (!width || !height) {
                    const image = await this.decodeImage(fullUrl);
                    width = image.naturalWidth; height = image.naturalHeight;
                    image.removeAttribute('src');
                }
                if (this.dead || job.cancelled) throw aborted();
                const previous = this.assets.get(job.photo.url);
                const asset = { width, height, fullUrl, blob, decoded, thumbUrl: previous?.thumbUrl || null, bytes: blob.size, used: Date.now(), animated: /\.gif$/i.test(job.photo.name) };
                if (!asset.thumbUrl && metadata.preview && metadata.orientation === 1) {
                    const previewUrl = URL.createObjectURL(new Blob([metadata.preview], { type: 'image/jpeg' }));
                    try {
                        const image = await this.decodeImage(previewUrl);
                        image.removeAttribute('src');
                        asset.thumbUrl = previewUrl;
                    } catch { URL.revokeObjectURL(previewUrl); }
                }
                if (this.dead || job.cancelled) { if (asset.thumbUrl && asset.thumbUrl !== previous?.thumbUrl) URL.revokeObjectURL(asset.thumbUrl); throw aborted(); }
                this.assets.set(job.photo.url, asset);
                job.readyResolve(asset);
                return job.thumbnail ? this.prepareThumbnail(asset, job.photo) : asset;
            } catch (error) {
                if (this.assets.get(job.photo.url)?.fullUrl !== fullUrl) URL.revokeObjectURL(fullUrl);
                throw error;
            }
        }

        decodeImage(url) {
            if (this.dead) return Promise.reject(aborted());
            const img = new Image();
            img.decoding = 'async';
            return new Promise((resolve, reject) => {
                let finished = false, timer;
                const finish = error => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    this.decodes.delete(cancel);
                    img.onload = img.onerror = null;
                    if (error) { img.removeAttribute('src'); reject(error); }
                    else resolve(img);
                };
                const cancel = () => finish(aborted());
                this.decodes.add(cancel);
                timer = setTimeout(() => finish(new Error('Image decoding timed out.')), 15000);
                img.onload = () => finish();
                img.onerror = () => finish(new Error('This image format could not be displayed.'));
                img.src = url;
            });
        }

        async prepareThumbnail(asset, photo) {
            if (asset.thumbUrl) return asset;
            if (this.dead || !asset.blob) throw aborted();
            const release = this.pin(photo.url);
            let bitmap = null, image = null;
            try {
                const scale = Math.min(1, 336 / asset.width, 224 / asset.height);
                const width = Math.max(1, Math.round(asset.width * scale)), height = Math.max(1, Math.round(asset.height * scale));
                try { bitmap = await createImageBitmap(asset.blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' }); } catch {}
                if (!bitmap) { image = await this.decodeImage(asset.fullUrl); asset.decoded = true; }
                if (this.dead) throw aborted();
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const context = canvas.getContext('2d');
                context.drawImage(bitmap || image, 0, 0, width, height);
                const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .78));
                canvas.width = 1;
                canvas.height = 1;
                if (this.dead) throw aborted();
                if (!thumbnail) throw new Error('Could not prepare the thumbnail.');
                asset.thumbUrl = URL.createObjectURL(thumbnail);
                return asset;
            } finally {
                bitmap?.close();
                image?.removeAttribute('src');
                release();
            }
        }

        viewKey(photo, spec) {
            return `${photo.url}\n${spec.width}x${spec.height}`;
        }

        view(photo, spec) {
            const entry = this.views.get(this.viewKey(photo, spec));
            if (entry) entry.used = Date.now();
            return entry;
        }

        disposeView(entry) {
            if (entry.bitmap.close) entry.bitmap.close();
            else entry.bitmap.width = entry.bitmap.height = 1;
        }

        fitted(photo, asset, spec, source = null) {
            if (this.dead) return Promise.reject(aborted());
            if (asset.animated || spec.width * spec.height * 4 > VIEW_SURFACE_LIMIT) return Promise.resolve(null);
            const key = this.viewKey(photo, spec);
            const cached = this.view(photo, spec);
            if (cached) return Promise.resolve(cached);
            if (this.viewJobs.has(key)) return this.viewJobs.get(key);
            const task = (async () => {
                const release = this.pin(photo.url);
                let bitmap = null, image = null;
                try {
                    try {
                        bitmap = await createImageBitmap(source || asset.blob, {
                            resizeWidth: spec.width,
                            resizeHeight: spec.height,
                            resizeQuality: 'high'
                        });
                    } catch {
                        image = source || await this.decodeImage(asset.fullUrl);
                        bitmap = document.createElement('canvas');
                        bitmap.width = spec.width;
                        bitmap.height = spec.height;
                        const context = bitmap.getContext('2d');
                        context.imageSmoothingEnabled = true;
                        context.imageSmoothingQuality = 'high';
                        context.drawImage(image, 0, 0, spec.width, spec.height);
                    }
                    if (this.dead) throw aborted();
                    const entry = { key, photo: photo.url, bitmap, width: spec.width, height: spec.height, bytes: spec.width * spec.height * 4, mode: spec.mode || 'inline', used: Date.now() };
                    for (const [oldKey, old] of this.views) {
                        if (old.photo === photo.url && old.mode === entry.mode) { this.disposeView(old); this.views.delete(oldKey); }
                    }
                    this.views.set(key, entry);
                    bitmap = null;
                    return entry;
                } finally {
                    if (bitmap) this.disposeView({ bitmap });
                    if (image && image !== source) image.removeAttribute('src');
                    release();
                }
            })();
            this.viewJobs.set(key, task);
            task.finally(() => this.viewJobs.delete(key)).catch(() => {});
            return task;
        }

        trim() {
            const originals = [...this.assets.entries()].filter(([, asset]) => asset.fullUrl || asset.blob);
            originals.sort(([a, aa], [b, bb]) => {
                const score = key => key === this.current || this.pins.has(key) ? 3 : key === this.warm ? 2 : this.keep.has(key) ? 1 : 0;
                return score(b) - score(a) || bb.used - aa.used;
            });
            let pixels = 0;
            for (const [key, asset] of originals) {
                const cost = asset.decoded ? asset.width * asset.height * 4 : 0;
                const required = key === this.current || this.pins.has(key);
                const pixelLimit = key === this.warm && asset.warmImage ? PIXEL_LIMIT * 2 : PIXEL_LIMIT;
                if (!required && (!this.keep.has(key) || pixels + cost > pixelLimit) && asset.fullUrl) {
                    asset.warmImage?.removeAttribute('src');
                    asset.warmImage = null;
                    URL.revokeObjectURL(asset.fullUrl);
                    asset.fullUrl = null;
                    asset.decoded = false;
                    if (this.warm === key) this.warm = '';
                } else pixels += cost;
            }
        }

        destroy() {
            this.dead = true;
            for (const cancel of this.decodes) cancel();
            for (const job of this.queue) { job.readyReject?.(aborted()); job.reject(aborted()); }
            this.queue.length = 0;
            for (const job of this.jobs.values()) job.request?.abort();
            this.jobs.clear();
            for (const entry of this.views.values()) this.disposeView(entry);
            this.views.clear();
            this.viewJobs.clear();
            for (const asset of this.assets.values()) {
                asset.warmImage?.removeAttribute('src');
                asset.warmImage = null;
                if (asset.fullUrl) URL.revokeObjectURL(asset.fullUrl);
                if (asset.thumbUrl) URL.revokeObjectURL(asset.thumbUrl);
                asset.fullUrl = null;
                asset.thumbUrl = null;
                asset.blob = null;
            }
            this.assets.clear();
            for (const url of this.downloadUrls) URL.revokeObjectURL(url);
            this.downloadUrls.clear();
        }
    }

    class Gallery {
        constructor(block, photos, ticket, store = new PhotoStore()) {
            this.block = block;
            this.photos = photos;
            this.ticket = ticket;
            this.signature = photoSignature(photos);
            this.store = store;
            this.dead = false;
            this.inView = false;
            this.awake = false;
            this.index = 0;
            this.angle = 0;
            this.scale = 1;
            this.fitted = true;
            this.x = 0;
            this.y = 0;
            this.asset = null;
            this.version = 0;
            this.collapsed = false;
            this.pointers = new Map();
            this.gesture = null;
            this.drawing = 0;
            this.thumbFrame = 0;
            this.thumbTarget = 0;
            this.idle = 0;
            this.warmToken = 0;
            this.lastDirection = 1;
            this.cacheToken = 0;
            this.cacheRunning = false;
            this.cacheRestart = false;
            this.cacheTimer = 0;
            this.warming = false;
            this.downloads = new Set();
            this.timers = new Set();
            this.visibleTiles = new Set();
            this.tileRequests = new WeakSet();
            this.abort = new AbortController();
            this.motion = matchMedia('(prefers-reduced-motion: reduce)');
            this.host = document.createElement('section');
            this.host.id = HOST_ID;
            this.host.dataset.version = '1.18';
            this.host.dataset.loadingVariant = String(loadingVariant);
            this.host.setAttribute('data-loading-paused', '');
            this.shadow = this.host.attachShadow({ mode: 'open' });
            this.shadow.innerHTML = `<style>${STYLE}</style>${this.markup()}`;
            this.gallery = this.shadow.querySelector('.gallery');
            this.viewport = this.shadow.querySelector('.viewport');
            this.image = this.shadow.querySelector('.photo');
            this.fitCanvas = this.shadow.querySelector('.fit-photo');
            this.strip = this.shadow.querySelector('.thumbs');
            this.status = this.shadow.querySelector('.status');
            this.applyTheme();
            this.list = block.closest('.widget-list');
            this.place();
            this.bind();
            this.buildTiles();
            this.select(Math.max(0, photos.findIndex(photo => photo.url === this.store.current)), false);
            this.observe();
        }

        widgets() {
            return this.list ? [...this.list.children].filter(node => node !== this.host && !node.hasAttribute('data-tpg-marker')) : [];
        }

        widgetKey(node) {
            const native = [node, ...node.querySelectorAll('[class]')].find(el => [...el.classList].some(name => name.startsWith('sim-')));
            return native ? [...native.classList].find(name => name.startsWith('sim-')) : node.querySelector('h2,h3')?.textContent.trim().replace(/\s*\(\d+\)\s*$/, '') || '';
        }

        place() {
            if (!this.list) { this.block.before(this.host); return; }
            this.host.setAttribute('data-widget', '');
            const widgets = this.widgets();
            let saved;
            try { saved = GM_getValue('gallery-position', null); } catch {}
            const anchor = saved && widgets.find(node => this.widgetKey(node) === saved.anchor);
            if (anchor) anchor[saved.after ? 'after' : 'before'](this.host);
            else (widgets.find(node => node.contains(this.block)) || this.block).before(this.host);
        }

        startDrag(event) {
            if (event.button !== 0 || !this.list || this.expanded()) return;
            event.preventDefault();
            this.cancelDrag?.();
            const origin = { x: event.clientX, y: event.clientY, id: event.pointerId };
            const signal = new AbortController();
            let active = false, target = null, after = false, frame = 0, latest = event;
            const marker = document.createElement('div');
            marker.setAttribute('data-tpg-marker', '');
            marker.style.cssText = `position:fixed;height:3px;border-radius:3px;background:${getComputedStyle(this.host).getPropertyValue('--accent') || '#42b4ff'};pointer-events:none;z-index:2147483647;`;
            const update = () => {
                frame = 0;
                if (!active) return;
                const nodes = this.widgets().filter(node => node.getBoundingClientRect().height > 0);
                if (!nodes.length) return;
                target = nodes.reduce((best, node) => {
                    const r = node.getBoundingClientRect(), b = best.getBoundingClientRect();
                    return Math.abs(latest.clientY - (r.top + r.height / 2)) < Math.abs(latest.clientY - (b.top + b.height / 2)) ? node : best;
                });
                const r = target.getBoundingClientRect();
                after = latest.clientY > r.top + r.height / 2;
                Object.assign(marker.style, { left: `${r.left}px`, top: `${after ? r.bottom : r.top}px`, width: `${r.width}px` });
                const edge = latest.clientY < 60 ? -14 : latest.clientY > innerHeight - 60 ? 14 : 0;
                if (edge) { target.scrollIntoView({ block: edge < 0 ? 'start' : 'end', behavior: 'instant' }); window.scrollBy(0, edge); frame = requestAnimationFrame(update); }
            };
            const finish = commit => {
                const wasActive = active;
                active = false;
                signal.abort();
                if (frame) cancelAnimationFrame(frame);
                marker.remove();
                this.host.removeAttribute('data-dragging');
                this.cancelDrag = null;
                if (commit && wasActive && target?.isConnected && this.list.contains(target)) {
                    const before = this.host.getBoundingClientRect();
                    target[after ? 'after' : 'before'](this.host);
                    const rect = this.host.getBoundingClientRect();
                    if (!this.motion.matches) this.host.animate([{ transform: `translateY(${before.top - rect.top}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
                    try { GM_setValue('gallery-position', { anchor: this.widgetKey(target), after }); } catch {}
                }
            };
            this.cancelDrag = () => finish(false);
            document.addEventListener('pointermove', e => {
                if (e.pointerId !== origin.id) return;
                latest = e;
                if (!active && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 6) return;
                if (!active) { active = true; this.host.setAttribute('data-dragging', ''); document.body.append(marker); }
                if (!frame) frame = requestAnimationFrame(update);
            }, { signal: signal.signal });
            document.addEventListener('pointerup', e => { if (e.pointerId !== origin.id) return; if (active) { latest = e; update(); } finish(e.button === 0); }, { signal: signal.signal });
            document.addEventListener('pointercancel', e => { if (e.pointerId === origin.id) finish(false); }, { signal: signal.signal });
            document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } }, { signal: signal.signal, capture: true });
            document.addEventListener('contextmenu', e => { e.preventDefault(); finish(false); }, { signal: signal.signal });
            window.addEventListener('blur', () => finish(false), { signal: signal.signal });
        }

        markup() {
            return `
<section class="gallery" role="region" aria-labelledby="gallery-title">
    <header class="header">
        <div class="heading"><h2 id="gallery-title"><button type="button" class="heading-toggle" data-action="collapse" aria-expanded="true" aria-controls="gallery-content" title="Collapse image viewer">${icon('disclosure')}<span>Image viewer</span><span class="total"></span></button></h2></div>
        <div class="actions">
            ${button('help', 'Keyboard shortcuts', 'keyboard')}
        </div>
        ${button('drag', 'Move image viewer', 'grip', 'icon drag-handle')}
    </header>
    <div class="content" id="gallery-content">
        <div class="help" hidden>
            <div class="shortcut-grid">
                <div class="shortcut"><span class="shortcut-label">Previous / Next</span><span class="keys"><kbd>←</kbd><kbd>→</kbd></span></div>
                <div class="shortcut"><span class="shortcut-label">First / Last</span><span class="keys"><kbd>Home</kbd><kbd>End</kbd></span></div>
                <div class="shortcut"><span class="shortcut-label">Zoom in / out</span><span class="keys"><kbd>+</kbd><kbd>−</kbd></span></div>
                <div class="shortcut"><span class="shortcut-label">Fit photo</span><span class="keys"><kbd>0</kbd></span></div>
                <div class="shortcut"><span class="shortcut-label">Rotate</span><span class="keys"><kbd>R</kbd></span></div>
                <div class="shortcut"><span class="shortcut-label">Fullscreen</span><span class="keys"><kbd>F</kbd></span></div>
                <div class="shortcut"><span class="shortcut-label">Return / Close</span><span class="keys"><kbd>Esc</kbd></span></div>
            </div>
            <p class="help-note">Scroll over the photo to zoom. Double-click for fullscreen; drag to pan. Use the header grip to move the gallery between sections.</p>
        </div>
        <div class="toolbar">
            <div class="file"><span class="filename"></span><span class="counter" aria-live="polite" aria-atomic="true"></span></div>
            <div class="tools">
                ${button('zoomout', 'Zoom out (−)', 'minus')}
                ${button('fit', 'Fit', null, 'zoom')}
                ${button('zoomin', 'Zoom in (+)', 'plus')}
                <span class="divider" aria-hidden="true"></span>
                ${button('rotate', 'Rotate (R)', 'rotate')}
                ${button('fullscreen', 'Fullscreen (F)', 'fullscreen')}
                <button type="button" class="download" data-action="download">${icon('download')}<span>Download</span></button>
            </div>
        </div>
        <div class="stage">
            <div class="viewport" tabindex="0" role="group" aria-label="Photo viewer">
                <img class="photo" alt="" draggable="false" hidden>
                <canvas class="fit-photo" role="img" aria-label="" hidden></canvas>
            </div>
            <div class="navigation" role="group" aria-label="Photo navigation">
                ${button('previous', 'Previous photo (←)', 'left', 'nav previous')}
                ${button('next', 'Next photo (→)', 'right', 'nav next')}
            </div>
            <span class="dimensions" hidden></span>
            <div class="message loading" role="status">${loadingMarkup()}<span class="message-text">Loading photo</span>${button('retry', 'Retry', null)}</div>
        </div>
        <div class="filmstrip">
            ${button('stripprevious', 'Scroll thumbnails left', 'left')}
            <div class="thumbs" aria-label="Photo thumbnails"></div>
            ${button('stripnext', 'Scroll thumbnails right', 'right')}
        </div>
        <span class="status" aria-live="polite"></span>
        <p class="empty" hidden>No photo attachments.</p>
    </div>
</section>`;
        }

        find(selector) {
            return this.shadow.querySelector(selector);
        }

        action(name) {
            return this.find(`[data-action="${name}"]`);
        }

        listen(target, event, handler, options = {}) {
            target.addEventListener(event, handler, { ...options, signal: this.abort.signal });
        }

        applyTheme() {
            const source = this.block.querySelector('.sim-fileAttachments--headerTitle') || this.block;
            const style = getComputedStyle(source);
            const dark = document.body.classList.contains('awsui-polaris-dark-mode');
            this.host.toggleAttribute('data-dark', dark);
            const mappings = {
                '--surface': 'color-background-container-content',
                '--stage': 'color-background-layout-main',
                '--text': 'color-text-body-default',
                '--heading': 'color-text-heading-default',
                '--muted': 'color-text-heading-secondary',
                '--accent': 'color-text-button-normal-default',
                '--hover': 'color-background-button-normal-hover',
                '--line': 'color-border-divider-secondary',
                '--control-line': 'color-border-divider-default',
                '--radius': 'border-radius-container',
                '--button-radius': 'border-radius-button'
            };
            const names = [...style].filter(name => name.startsWith('--'));
            for (const [local, prefix] of Object.entries(mappings)) {
                const key = names.find(name => name === `--${prefix}` || name.startsWith(`--${prefix}-`));
                if (key && style.getPropertyValue(key).trim()) this.host.style.setProperty(local, style.getPropertyValue(key).trim());
                else this.host.style.removeProperty(local);
            }
            this.host.style.fontFamily = style.fontFamily;
            this.copyNativeDisclosure();
        }

        copyNativeDisclosure() {
            const source = this.block.querySelector('[aria-expanded] svg');
            const current = this.shadow.querySelector('.heading-toggle svg');
            if (!source || !current) return;
            const clone = source.cloneNode(true);
            const originals = [source, ...source.querySelectorAll('*')];
            const copies = [clone, ...clone.querySelectorAll('*')];
            const properties = ['color', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'opacity'];
            copies.forEach((node, index) => {
                for (const attr of [...node.attributes]) {
                    if (attr.name === 'class' || attr.name === 'id' || attr.name === 'style' || attr.name.startsWith('on')) node.removeAttribute(attr.name);
                }
                const computed = getComputedStyle(originals[index]);
                for (const property of properties) node.style.setProperty(property, computed.getPropertyValue(property));
            });
            const computed = getComputedStyle(source);
            clone.style.width = computed.width;
            clone.style.height = computed.height;
            current.replaceWith(clone);
        }

        bind() {
            this.listen(this.action('drag'), 'pointerdown', event => this.startDrag(event));
            this.listen(this.shadow, 'click', event => this.click(event));
            this.listen(document, 'keydown', event => this.keydown(event));
            this.listen(document, 'fullscreenchange', () => {
                if (!this.dead) this.fullscreenChanged();
            });
            this.listen(document, 'visibilitychange', () => {
                this.store.pause(document.hidden || !this.inView || this.collapsed);
                this.updateLoadingMotion();
                if (document.hidden) {
                    this.stopThumbnailScroll();
                    this.cancelIdle();
                    this.cancelCache();
                    this.releaseRetained();
                    if (this.asset?.animated) this.image.removeAttribute('src');
                } else if (this.inView && !this.collapsed) {
                    this.loadSelected();
                    this.requestVisible();
                    this.scheduleCache();
                }
            });
            this.listen(this.viewport, 'error', event => {
                if (event.target === this.image && this.image.hasAttribute('src') && !this.dead) this.message('The browser could not display this photo.', true);
            }, { capture: true });
            this.listen(this.viewport, 'dblclick', event => {
                event.preventDefault();
                this.fullscreen();
            });
            this.listen(this.find('.stage'), 'wheel', event => this.wheel(event), { passive: false });
            this.listen(this.viewport, 'pointerdown', event => this.pointerDown(event));
            this.listen(this.viewport, 'pointermove', event => this.pointerMove(event), { passive: false });
            this.listen(this.viewport, 'pointerup', event => this.pointerEnd(event));
            this.listen(this.viewport, 'pointercancel', event => this.pointerEnd(event, true));
            this.listen(this.viewport, 'lostpointercapture', event => this.pointerEnd(event, true));
            this.listen(this.viewport, 'dragstart', event => event.preventDefault());
            this.listen(this.strip, 'dblclick', event => this.thumbnailDoubleClick(event));
            this.listen(this.strip, 'scroll', () => this.stripButtons(), { passive: true });
            this.listen(this.strip, 'wheel', event => this.thumbnailWheel(event), { passive: false });
            this.listen(this.strip, 'pointerdown', () => this.stopThumbnailScroll(), { passive: true });
        }

        observe() {
            this.tileObserver = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    const tile = entry.target;
                    tile.toggleAttribute('data-loading-visible', entry.isIntersecting);
                    if (entry.isIntersecting) {
                        tile.querySelector('.loading-animation')?.style.setProperty('--loading-phase', `-${performance.now() % 1800}ms`);
                        this.visibleTiles.add(tile);
                        this.loadThumbnail(tile);
                    } else {
                        this.visibleTiles.delete(tile);
                        tile.querySelector('img').removeAttribute('src');
                    }
                }
            }, { rootMargin: '120px', threshold: 0 });
            for (const tile of this.strip.children) this.tileObserver.observe(tile);
            this.wakeObserver = new IntersectionObserver(entries => {
                this.inView = entries[0].isIntersecting || this.expanded();
                this.store.pause(document.hidden || !this.inView || this.collapsed);
                this.updateLoadingMotion();
                if (this.inView && !document.hidden && !this.collapsed) {
                    this.awake = true;
                    this.loadSelected();
                    this.requestVisible();
                } else {
                    this.cancelIdle();
                    this.cancelCache();
                }
            }, { rootMargin: '400px' });
            this.wakeObserver.observe(this.host);
            this.resizeObserver = new ResizeObserver(() => {
                if (this.dead) return;
                this.paint();
                this.stripButtons();
                this.ensureThumbnail(false);
                this.scheduleCache();
            });
            this.resizeObserver.observe(this.gallery);
            this.resizeObserver.observe(this.viewport);
            this.themeObserver = new MutationObserver(() => this.applyTheme());
            this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
            this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        }

        makeTile(index) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.dataset.index = String(index);
            const select = document.createElement('button');
            select.type = 'button';
            select.className = 'select';
            select.dataset.select = String(index);
            select.setAttribute('aria-label', `View ${this.photos[index].name}`);
            select.setAttribute('aria-pressed', String(index === this.index));
            const image = document.createElement('img');
            image.alt = '';
            image.draggable = false;
            image.decoding = 'async';
            const placeholder = document.createElement('span');
            placeholder.className = 'thumb-missing';
            placeholder.innerHTML = loadingMarkup();
            placeholder.setAttribute('aria-hidden', 'true');
            select.append(image, placeholder);
            const number = document.createElement('span');
            number.className = 'number';
            number.textContent = String(index + 1);
            const download = document.createElement('button');
            download.type = 'button';
            download.className = 'thumb-download';
            download.dataset.download = String(index);
            download.setAttribute('aria-label', `Download ${this.photos[index].name}`);
            download.title = `Download ${this.photos[index].name}`;
            download.innerHTML = icon('download');
            tile.append(select, number, download);
            return tile;
        }

        buildTiles() {
            this.strip.replaceChildren(...this.photos.map((photo, index) => this.makeTile(index)));
            this.find('.total').textContent = String(this.photos.length);
            const empty = this.photos.length === 0;
            for (const selector of ['.toolbar', '.stage', '.filmstrip']) this.find(selector).hidden = empty;
            this.find('.empty').hidden = !empty;
            this.action('help').disabled = empty;
            this.action('help').setAttribute('aria-expanded', 'false');
            this.action('fullscreen').setAttribute('aria-pressed', 'false');
        }

        loadThumbnail(tile) {
            if (this.dead || this.collapsed || !this.awake || document.hidden || !this.inView || !this.visibleTiles.has(tile) || this.tileRequests.has(tile)) return;
            const photo = this.photos[Number(tile.dataset.index)];
            if (!photo) return;
            this.tileRequests.add(tile);
            this.store.thumbnail(photo).then(asset => {
                if (this.dead || !tile.isConnected || !this.visibleTiles.has(tile)) return;
                const img = tile.querySelector('img');
                img.src = asset.thumbUrl;
                tile.querySelector('.thumb-missing').hidden = true;
                tile.classList.remove('failed');
            }).catch(error => {
                if (this.dead || error.name === 'AbortError') return;
                tile.classList.add('failed');
                tile.querySelector('.thumb-missing').textContent = 'View to retry';
            }).finally(() => this.tileRequests.delete(tile));
        }

        requestVisible() {
            const tiles = [...this.visibleTiles].sort((a, b) => Math.abs(Number(a.dataset.index) - this.index) - Math.abs(Number(b.dataset.index) - this.index));
            for (const tile of tiles) this.loadThumbnail(tile);
        }

        releaseRetained() {
            const release = this.retainedRelease;
            this.retainedRelease = null;
            if (!release) return;
            if (!this.asset) {
                this.image.removeAttribute('src');
                this.image.hidden = true;
                this.fitCanvas.hidden = true;
            }
            release();
        }

        updateLoadingMotion() {
            const paused = document.hidden || !this.inView || this.collapsed;
            this.host.toggleAttribute('data-loading-paused', paused);
            if (!paused) {
                const phase = `-${performance.now() % 1800}ms`;
                for (const node of this.shadow.querySelectorAll('.message .loading-animation, .tile[data-loading-visible] .loading-animation')) node.style.setProperty('--loading-phase', phase);
            }
        }

        message(text, error = false, keepImage = false) {
            if (error) this.releaseRetained();
            const message = this.find('.message');
            message.hidden = false;
            message.classList.toggle('over-photo', keepImage);
            message.classList.toggle('loading', !error);
            message.classList.toggle('switching-photo', !error && Boolean(this.displayedPhoto));
            message.querySelector('.message-text').textContent = text;
            message.querySelector('.loading-animation').style.setProperty('--loading-phase', `-${performance.now() % 1800}ms`);
            this.action('retry').hidden = !error;
            this.image.hidden = !keepImage;
            if (!keepImage) this.fitCanvas.hidden = true;
            this.viewport.setAttribute('aria-busy', String(!error));
            this.find('.dimensions').hidden = true;
            this.updateTools();
        }

        select(index, animate = true) {
            if (!this.photos.length || this.dead) return;
            const previous = this.index;
            this.index = clamp(index, 0, this.photos.length - 1);
            if (this.index === previous && this.asset?.decoded && !this.image.hidden) return;
            if (this.index !== previous) this.lastDirection = Math.sign(this.index - previous);
            this.version++;
            this.fullCandidate?.removeAttribute('src');
            this.cancelIdle();
            this.cancelCache();
            const keepImage = !this.fitCanvas.hidden || (!this.image.hidden && this.image.complete && this.image.naturalWidth > 0);
            if (keepImage && !this.retainedRelease && this.displayedPhoto) this.retainedRelease = this.store.pin(this.displayedPhoto);
            this.store.setCurrent(this.photos, this.index);
            this.asset = null;
            if (!keepImage) this.image.removeAttribute('src');
            this.angle = 0;
            if (this.expanded() || !this.displayedPhoto) {
                this.fitted = true;
                this.scale = 1;
                this.x = 0;
                this.y = 0;
            }
            this.pointers.clear();
            this.gesture = null;
            this.viewport.classList.remove('dragging', 'gesturing', 'zoomed');
            this.find('.filename').textContent = this.photos[this.index].name;
            this.find('.filename').title = this.photos[this.index].name;
            this.find('.counter').textContent = `${this.index + 1} / ${this.photos.length}`;
            for (const tile of this.shadow.querySelectorAll('.tile')) {
                tile.querySelector('.select').setAttribute('aria-pressed', String(Number(tile.dataset.index) === this.index));
            }
            this.action('previous').disabled = this.index === 0;
            this.action('next').disabled = this.index === this.photos.length - 1;
            this.ensureThumbnail(animate);
            this.message('Loading photo', false, keepImage);
            if (this.awake && !document.hidden) this.loadSelected();
        }

        async loadSelected() {
            if (this.dead || this.collapsed || !this.photos.length || document.hidden || !this.inView) return;
            const token = this.version;
            if (this.activeLoad === token) return;
            this.activeLoad = token;
            const photo = this.photos[this.index];
            const allowPreview = !this.displayedPhoto;
            let candidate = null;
            try {
                const preview = this.store.assets.get(photo.url);
                if (allowPreview && this.image.hidden && preview?.thumbUrl) {
                    this.asset = preview;
                    this.displayedPhoto = photo.url;
                    this.image.src = preview.thumbUrl;
                    this.image.alt = photo.name;
                    this.image.hidden = false;
                    this.find('.message').hidden = true;
                    this.paint();
                }
                const asset = await this.store.get(photo, 0);
                if (this.dead || this.collapsed || token !== this.version || document.hidden) return;
                const readyView = this.fitted && !asset.animated && this.store.view(photo, this.fitSpec(asset));
                if (readyView) {
                    this.asset = asset;
                    this.displayedPhoto = photo.url;
                    this.image.alt = photo.name;
                    if (this.image.getAttribute('src') !== asset.fullUrl) this.image.src = asset.fullUrl;
                    this.image.hidden = false;
                    this.find('.message').hidden = true;
                    this.find('.dimensions').textContent = `${asset.width} × ${asset.height}`;
                    this.find('.dimensions').hidden = false;
                    this.viewport.setAttribute('aria-busy', 'false');
                    this.paint();
                    this.releaseRetained();
                }
                if (allowPreview && !readyView && asset.thumbUrl) {
                    this.asset = asset;
                    this.displayedPhoto = photo.url;
                    this.image.alt = photo.name;
                    this.image.src = asset.thumbUrl;
                    this.image.hidden = false;
                    this.find('.message').hidden = true;
                    this.paint();
                }
                const prepared = asset.warmImage?.complete && asset.warmImage.naturalWidth > 0 && asset.warmImage.src === asset.fullUrl;
                candidate = prepared ? asset.warmImage : new Image();
                if (!prepared) asset.warmImage?.removeAttribute('src');
                asset.warmImage = null;
                if (this.store.warm === photo.url) this.store.warm = '';
                this.fullCandidate = candidate;
                if (!prepared) {
                    candidate.decoding = 'async';
                    candidate.fetchPriority = 'high';
                    candidate.src = asset.fullUrl;
                    await candidate.decode();
                }
                asset.decoded = true;
                if (!asset.animated) await this.store.fitted(photo, asset, this.fitSpec(asset), candidate);
                if (this.dead || this.collapsed || token !== this.version || document.hidden) return;
                this.asset = asset;
                this.displayedPhoto = photo.url;
                const previousImage = this.image;
                candidate.className = 'photo';
                candidate.alt = photo.name;
                candidate.draggable = false;
                candidate.hidden = false;
                this.image = candidate;
                if (previousImage !== candidate) {
                    previousImage.replaceWith(candidate);
                    previousImage.removeAttribute('src');
                }
                this.fullCandidate = null;
                candidate = null;
                this.find('.message').hidden = true;
                this.find('.dimensions').textContent = `${asset.width} × ${asset.height}`;
                this.find('.dimensions').hidden = false;
                this.viewport.setAttribute('aria-busy', 'false');
                this.image.style.transition = 'none';
                this.paint();
                this.image.getBoundingClientRect();
                this.image.style.removeProperty('transition');
                this.releaseRetained();
                this.store.trim();
                this.requestVisible();
                this.store.releaseForeground();
                this.scheduleNeighbor();
                this.scheduleCache();
            } catch (error) {
                if (!this.dead && token === this.version && error.name !== 'AbortError') this.message(error.message, true);
            } finally {
                candidate?.removeAttribute('src');
                if (this.fullCandidate === candidate) this.fullCandidate = null;
                if (this.activeLoad === token) this.activeLoad = null;
                if (!this.dead && token === this.version) this.store.releaseForeground();
            }
        }

        fitSpec(asset) {
            if (!this.expanded() || !this.inlineSize) this.inlineSize = { width: this.viewport.clientWidth, height: this.viewport.clientHeight };
            const size = this.expanded() ? this.viewport : this.inlineSize;
            const width = this.expanded() ? size.clientWidth : size.width;
            const height = this.expanded() ? size.clientHeight : size.height;
            const scale = Math.min(width / asset.width, height / asset.height);
            const dpr = window.devicePixelRatio || 1;
            return { width: Math.max(1, Math.round(asset.width * scale * dpr)), height: Math.max(1, Math.round(asset.height * scale * dpr)), dpr, mode: this.expanded() ? 'fullscreen' : 'inline' };
        }

        paintFitted() {
            const eligible = this.fitted && this.angle === 0 && !this.asset.animated;
            if (!eligible) {
                this.fitCanvas.hidden = true;
                this.image.style.visibility = '';
                return;
            }
            const photo = this.photos[this.index], spec = this.fitSpec(this.asset);
            const entry = this.store.view(photo, spec);
            if (!entry) {
                const key = this.store.viewKey(photo, spec);
                if (this.fitPreparing !== key && this.asset.blob) {
                    this.fitPreparing = key;
                    const asset = this.asset;
                    const source = this.image.complete && this.image.getAttribute('src') === asset.fullUrl ? this.image : null;
                    this.store.fitted(photo, asset, spec, source).then(result => {
                        if (result && !this.dead && this.asset === asset && this.store.viewKey(photo, this.fitSpec(asset)) === key) this.paint();
                    }).catch(() => {}).finally(() => { if (this.fitPreparing === key) this.fitPreparing = null; });
                }
                if (this.fitDrawn?.photo !== photo.url) {
                    this.fitCanvas.hidden = true;
                    this.image.style.visibility = '';
                }
                return;
            }
            if (this.fitDrawn !== entry || this.fitCanvas.width !== entry.width || this.fitCanvas.height !== entry.height) {
                this.fitCanvas.width = entry.width;
                this.fitCanvas.height = entry.height;
                const context = this.fitCanvas.getContext('2d');
                context.imageSmoothingEnabled = false;
                context.drawImage(entry.bitmap, 0, 0);
                this.fitDrawn = entry;
            }
            const width = entry.width / spec.dpr, height = entry.height / spec.dpr;
            this.fitCanvas.style.width = `${width}px`;
            this.fitCanvas.style.height = `${height}px`;
            this.fitCanvas.style.left = `${Math.round((this.viewport.clientWidth - width) * spec.dpr / 2) / spec.dpr}px`;
            this.fitCanvas.style.top = `${Math.round((this.viewport.clientHeight - height) * spec.dpr / 2) / spec.dpr}px`;
            this.fitCanvas.hidden = false;
            this.fitCanvas.setAttribute('aria-label', photo.name);
            this.image.style.visibility = 'hidden';
        }

        fitScale() {
            if (!this.asset) return 1;
            const rotated = this.angle % 180 !== 0;
            const width = rotated ? this.asset.height : this.asset.width;
            const height = rotated ? this.asset.width : this.asset.height;
            return Math.min(this.viewport.clientWidth / width, this.viewport.clientHeight / height);
        }

        paint() {
            if (!this.asset || !this.viewport.clientWidth || !this.viewport.clientHeight) return;
            const fit = this.fitScale();
            if (this.fitted) this.scale = fit;
            const rotated = this.angle % 180 !== 0;
            const width = (rotated ? this.asset.height : this.asset.width) * this.scale;
            const height = (rotated ? this.asset.width : this.asset.height) * this.scale;
            const maxX = Math.max(0, (width - this.viewport.clientWidth) / 2);
            const maxY = Math.max(0, (height - this.viewport.clientHeight) / 2);
            this.x = clamp(this.x, -maxX, maxX);
            this.y = clamp(this.y, -maxY, maxY);
            this.image.style.width = `${this.asset.width}px`;
            this.image.style.height = `${this.asset.height}px`;
            this.image.style.transform = `translate(${this.x}px, ${this.y}px) rotate(${this.angle}deg) scale(${this.scale})`;
            this.viewport.classList.toggle('zoomed', this.scale > fit * 1.01);
            this.paintFitted();
            this.action('fit').textContent = this.fitted ? 'Fit' : `${Math.round(this.scale * 100)}%`;
            this.action('fit').title = 'Fit image (0)';
            this.status.textContent = this.fitted ? 'Fit to view' : `${Math.round(this.scale * 100)}% · Drag to pan`;
            this.updateTools();
        }

        queuePaint() {
            if (!this.drawing) this.drawing = requestAnimationFrame(() => {
                this.drawing = 0;
                if (!this.dead) this.paint();
            });
        }

        updateTools() {
            const available = !!this.asset && !this.image.hidden;
            for (const name of ['fit', 'rotate', 'zoomin', 'zoomout']) this.action(name).disabled = !available;
            if (available) {
                this.action('zoomout').disabled = this.scale <= this.fitScale() * 1.001;
                this.action('zoomin').disabled = this.scale >= Math.max(8, this.fitScale());
            }
            this.action('download').disabled = !this.photos.length || this.downloads.has(this.photos[this.index]?.url);
        }

        fit() {
            this.fitted = true;
            this.x = 0;
            this.y = 0;
            this.paint();
        }

        zoom(value, clientX, clientY) {
            if (!this.asset) return;
            const fit = this.fitScale();
            const next = clamp(value, Math.min(fit, 1), Math.max(8, fit));
            const rect = this.viewport.getBoundingClientRect();
            const px = Number.isFinite(clientX) ? clientX - rect.left - rect.width / 2 : 0;
            const py = Number.isFinite(clientY) ? clientY - rect.top - rect.height / 2 : 0;
            const ratio = next / this.scale;
            this.x = px - (px - this.x) * ratio;
            this.y = py - (py - this.y) * ratio;
            this.scale = next;
            this.fitted = Math.abs(next - fit) < .0001;
            this.paint();
        }

        wheel(event) {
            if (!this.asset || this.image.hidden || this.collapsed || !event.deltaY) return;
            const rect = this.image.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.clientHeight : 1;
            event.preventDefault();
            this.zoom(this.scale * Math.exp(-event.deltaY * unit * .0025), event.clientX, event.clientY);
        }

        rotate() {
            if (!this.asset) return;
            this.angle = (this.angle + 90) % 360;
            this.fit();
        }

        pointerDown(event) {
            if (!this.asset || event.button !== 0) return;
            this.viewport.focus({ preventScroll: true });
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (this.pointers.size === 2) {
                const points = [...this.pointers.values()];
                this.gesture = {
                    type: 'pinch',
                    distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
                    scale: this.scale
                };
                this.viewport.classList.add('gesturing');
                event.preventDefault();
            } else {
                this.gesture = { type: 'drag', startX: event.clientX, startY: event.clientY, x: this.x, y: this.y, time: performance.now(), fitted: this.fitted };
                if (!this.fitted) this.viewport.classList.add('dragging');
            }
            if (event.pointerType === 'mouse' || !this.fitted) this.viewport.setPointerCapture(event.pointerId);
        }

        pointerMove(event) {
            if (!this.pointers.has(event.pointerId) || !this.gesture) return;
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (this.gesture.type === 'pinch' && this.pointers.size >= 2) {
                event.preventDefault();
                const points = [...this.pointers.values()];
                const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                this.zoom(this.gesture.scale * distance / Math.max(1, this.gesture.distance), (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
            } else if (this.gesture.type === 'drag' && !this.gesture.fitted) {
                event.preventDefault();
                this.x = this.gesture.x + event.clientX - this.gesture.startX;
                this.y = this.gesture.y + event.clientY - this.gesture.startY;
                this.queuePaint();
            }
        }

        pointerEnd(event, cancelled = false) {
            if (!this.pointers.has(event.pointerId)) return;
            const gesture = this.gesture;
            this.pointers.delete(event.pointerId);
            if (!cancelled && event.pointerType !== 'mouse' && gesture?.type === 'drag' && gesture.fitted) {
                const dx = event.clientX - gesture.startX;
                const dy = event.clientY - gesture.startY;
                if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && performance.now() - gesture.time < 700) this.select(this.index + (dx < 0 ? 1 : -1));
            }
            this.gesture = null;
            this.pointers.clear();
            this.viewport.classList.remove('dragging', 'gesturing');
        }

        ensureThumbnail(animate = true) {
            const tile = this.strip.children[this.index];
            if (!tile) return;
            const parentRect = this.strip.getBoundingClientRect();
            const rect = tile.getBoundingClientRect();
            let left = this.strip.scrollLeft;
            if (rect.left < parentRect.left + 3) left += rect.left - parentRect.left - 3;
            else if (rect.right > parentRect.right - 3) left += rect.right - parentRect.right + 3;
            else return;
            this.stopThumbnailScroll();
            this.strip.scrollTo({ left, behavior: animate && !this.motion.matches ? 'smooth' : 'instant' });
        }

        thumbnailWheel(event) {
            if (event.ctrlKey || event.metaKey) return;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.strip.clientWidth : 1;
            if (!delta) return;
            event.preventDefault();
            const base = this.thumbFrame ? this.thumbTarget : this.strip.scrollLeft;
            const left = clamp(base + delta * unit, 0, Math.max(0, this.strip.scrollWidth - this.strip.clientWidth));
            if (Math.abs(left - base) < .01) return;
            this.thumbTarget = left;
            if (this.motion.matches) {
                this.stopThumbnailScroll();
                this.strip.scrollTo({ left, behavior: 'instant' });
                return;
            }
            if (this.thumbFrame) return;
            let previous = performance.now();
            const step = time => {
                if (this.dead || document.hidden || this.collapsed) { this.stopThumbnailScroll(); return; }
                this.thumbTarget = clamp(this.thumbTarget, 0, Math.max(0, this.strip.scrollWidth - this.strip.clientWidth));
                const distance = this.thumbTarget - this.strip.scrollLeft;
                const elapsed = clamp(time - previous, 1, 40);
                previous = time;
                if (Math.abs(distance) <= .5 || this.motion.matches) {
                    this.strip.scrollTo({ left: this.thumbTarget, behavior: 'instant' });
                    this.thumbFrame = 0;
                    return;
                }
                this.strip.scrollTo({ left: this.strip.scrollLeft + distance * (1 - Math.exp(-elapsed / 65)), behavior: 'instant' });
                this.thumbFrame = requestAnimationFrame(step);
            };
            this.thumbFrame = requestAnimationFrame(step);
        }

        stopThumbnailScroll() {
            if (this.thumbFrame) cancelAnimationFrame(this.thumbFrame);
            this.thumbFrame = 0;
            this.thumbTarget = this.strip.scrollLeft;
        }

        stripButtons() {
            const overflow = this.strip.scrollWidth > this.strip.clientWidth + 2;
            this.action('stripprevious').hidden = !overflow;
            this.action('stripnext').hidden = !overflow;
            this.action('stripprevious').disabled = this.strip.scrollLeft < 2;
            this.action('stripnext').disabled = this.strip.scrollLeft + this.strip.clientWidth >= this.strip.scrollWidth - 2;
        }

        expanded() {
            return document.fullscreenElement === this.host || this.shadow.fullscreenElement === this.gallery || this.host.hasAttribute('data-expanded');
        }

        setCollapsed(value) {
            this.collapsed = value;
            this.updateLoadingMotion();
            this.find('.content').hidden = value;
            this.find('.actions').hidden = value;
            this.action('collapse').setAttribute('aria-expanded', String(!value));
            this.action('collapse').title = value ? 'Expand image viewer' : 'Collapse image viewer';
            this.store.pause(value || document.hidden || !this.inView);
            if (value) {
                this.stopThumbnailScroll();
                this.version++;
                this.cancelIdle();
                this.cancelCache();
                this.releaseRetained();
                if (this.asset?.animated) this.image.removeAttribute('src');
            } else {
                this.loadSelected();
                this.requestVisible();
                this.paint();
                this.stripButtons();
            }
        }

        async fullscreen() {
            if (this.expanded()) {
                if (this.host.hasAttribute('data-expanded')) {
                    this.host.removeAttribute('data-expanded');
                    this.fullscreenChanged();
                } else {
                    try { await document.exitFullscreen(); } catch {}
                }
                return;
            }
            if (this.collapsed) this.setCollapsed(false);
            this.beforeFullscreen = this.shadow.activeElement;
            if (this.gallery.requestFullscreen && document.fullscreenEnabled) {
                try {
                    await this.gallery.requestFullscreen();
                    return;
                } catch {}
            }
            this.host.setAttribute('data-expanded', '');
            this.fullscreenChanged();
        }

        fullscreenChanged() {
            const active = this.expanded();
            this.action('fullscreen').setAttribute('aria-pressed', String(active));
            this.action('fullscreen').setAttribute('aria-label', active ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)');
            this.action('fullscreen').title = active ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)';
            this.action('fullscreen').innerHTML = icon(active ? 'close' : 'fullscreen');
            if (active) {
                this.inView = true;
                this.awake = true;
                this.store.pause(false);
                this.viewport.focus({ preventScroll: true });
                this.loadSelected();
            } else {
                this.beforeFullscreen?.focus({ preventScroll: true });
            }
            this.paint();
            this.cancelCache();
            this.scheduleCache();
        }

        async download(index) {
            const photo = this.photos[index];
            if (!photo || this.downloads.has(photo.url)) return;
            this.downloads.add(photo.url);
            let release = () => {};
            this.updateDownloadButtons(photo.url, true);
            this.status.textContent = `Preparing ${photo.name}…`;
            try {
                const original = await this.store.downloadURL(photo);
                release = original.release;
                if (this.dead) { release(); return; }
                const anchor = document.createElement('a');
                anchor.href = original.url;
                anchor.download = downloadName(photo);
                anchor.hidden = true;
                this.shadow.append(anchor);
                anchor.click();
                anchor.remove();
                this.status.textContent = `Download started: ${photo.name}`;
                const timer = setTimeout(() => {
                    this.timers.delete(timer);
                    release();
                }, 10000);
                this.timers.add(timer);
            } catch (error) {
                release();
                if (!this.dead && error.name !== 'AbortError') this.status.textContent = `Download failed: ${error.message}`;
            } finally {
                this.downloads.delete(photo.url);
                if (!this.dead) this.updateDownloadButtons(photo.url, false);
            }
        }

        updateDownloadButtons(url, disabled) {
            for (const tile of this.shadow.querySelectorAll('.tile')) {
                if (this.photos[Number(tile.dataset.index)]?.url === url) tile.querySelector('.thumb-download').disabled = disabled;
            }
            this.updateTools();
        }

        thumbnailDoubleClick(event) {
            const select = event.target.closest('[data-select]');
            if (!select) return;
            event.preventDefault();
            this.select(Number(select.dataset.select));
            if (!this.expanded()) this.fullscreen();
        }

        click(event) {
            const download = event.target.closest('[data-download]');
            if (download) {
                this.download(Number(download.dataset.download));
                return;
            }
            const select = event.target.closest('[data-select]');
            if (select) {
                const index = Number(select.dataset.select);
                this.select(index);
                this.viewport.focus({ preventScroll: true });
                return;
            }
            const control = event.target.closest('[data-action]');
            if (!control || control.disabled) return;
            const action = control.dataset.action;
            if (action === 'collapse') {
                if (!this.collapsed && this.expanded()) this.fullscreen().then(() => { if (!this.dead) this.setCollapsed(true); });
                else this.setCollapsed(!this.collapsed);
                return;
            }
            if (action === 'previous') this.select(this.index - 1);
            if (action === 'next') this.select(this.index + 1);
            if (action === 'fit') this.fit();
            if (action === 'zoomin') this.zoom(this.scale * 1.35);
            if (action === 'zoomout') this.zoom(this.scale / 1.35);
            if (action === 'rotate') this.rotate();
            if (action === 'fullscreen') this.fullscreen();
            if (action === 'download') this.download(this.index);
            if (action === 'retry') this.loadSelected();
            if (action === 'help') {
                const panel = this.find(`.${action}`);
                panel.hidden = !panel.hidden;
                control.setAttribute('aria-expanded', String(!panel.hidden));
            }
            if (action === 'stripprevious' || action === 'stripnext') {
                this.stopThumbnailScroll();
                this.strip.scrollBy({ left: this.strip.clientWidth * .8 * (action === 'stripnext' ? 1 : -1), behavior: this.motion.matches ? 'instant' : 'smooth' });
            }
        }

        keydown(event) {
            if (this.dead || !this.photos.length) return;
            const path = event.composedPath();
            if (!this.expanded() && !path.includes(this.host)) return;
            const target = path[0];
            if (target instanceof Element && (target.matches('input,textarea,select') || target.isContentEditable)) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'Tab' && this.host.hasAttribute('data-expanded')) {
                const controls = [...this.shadow.querySelectorAll('button,input,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
                const index = controls.indexOf(this.shadow.activeElement);
                if ((!event.shiftKey && index === controls.length - 1) || (event.shiftKey && index <= 0)) {
                    event.preventDefault();
                    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
                }
                return;
            }
            const key = event.key;
            if (this.collapsed && key !== 'f' && key !== 'F') return;
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', '+', '=', '-', '0', 'r', 'R', 'f', 'F', 'Escape'].includes(key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (key === 'ArrowLeft') this.select(this.index - 1);
            if (key === 'ArrowRight') this.select(this.index + 1);
            if (key === 'Home') this.select(0);
            if (key === 'End') this.select(this.photos.length - 1);
            if (key === '+' || key === '=') this.zoom(this.scale * 1.35);
            if (key === '-') this.zoom(this.scale / 1.35);
            if (key === '0') this.fit();
            if (key === 'r' || key === 'R') this.rotate();
            if (key === 'f' || key === 'F') this.fullscreen();
            if (key === 'Escape') {
                if (!this.find('.help').hidden) {
                    this.find('.help').hidden = true;
                    this.action('help').setAttribute('aria-expanded', 'false');
                } else if (this.expanded()) {
                    this.fullscreen();
                } else {
                    this.fit();
                }
            }
        }

        cancelCache() {
            this.cacheToken++;
            clearTimeout(this.cacheTimer);
            this.cacheTimer = 0;
            this.cacheRestart = false;
        }

        scheduleCache() {
            const eligible = () => !this.dead && !this.collapsed && this.inView && !document.hidden;
            if (!eligible()) return;
            if (this.cacheRunning) { this.cacheRestart = true; return; }
            if (this.cacheTimer) return;
            const token = this.cacheToken;
            this.cacheTimer = setTimeout(async () => {
                this.cacheTimer = 0;
                if (!eligible() || token !== this.cacheToken) return;
                this.cacheRunning = true;
                try {
                    const photos = [...this.photos].sort((a, b) => Math.abs(this.photos.indexOf(a) - this.index) - Math.abs(this.photos.indexOf(b) - this.index));
                    for (const photo of photos) {
                        while (eligible() && token === this.cacheToken && (this.warming || this.store.foregroundPending)) await new Promise(resolve => setTimeout(resolve, 40));
                        if (!eligible() || token !== this.cacheToken) break;
                        let asset = this.store.assets.get(photo.url);
                        if (asset && this.store.view(photo, this.fitSpec(asset))) continue;
                        try {
                            asset = await this.store.get(photo, 3);
                            if (!eligible() || token !== this.cacheToken) break;
                            const spec = this.fitSpec(asset);
                            await this.store.fitted(photo, asset, spec);
                        } catch (error) {
                            if (error.name === 'AbortError') break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 16));
                    }
                } finally {
                    this.cacheRunning = false;
                    if (this.cacheRestart) { this.cacheRestart = false; this.scheduleCache(); }
                }
            }, 32);
        }

        scheduleNeighbor() {
            this.cancelIdle();
            if (this.dead || this.collapsed || document.hidden || !this.inView || !this.asset || this.asset.animated || this.asset.width * this.asset.height * 4 > PIXEL_LIMIT) return;
            const next = this.photos[this.index + this.lastDirection] || this.photos[this.index - this.lastDirection];
            if (!next) return;
            if (this.store.warm === next.url && this.store.assets.get(next.url)?.warmImage) return;
            this.warming = true;
            const token = this.warmToken;
            const current = this.photos[this.index].url;
            const allowed = () => token === this.warmToken && !this.dead && !this.collapsed && this.inView && !document.hidden && this.photos[this.index]?.url === current;
            const callback = async () => {
                this.idle = 0;
                if (!allowed()) return;
                let image = null, release = null;
                try {
                    const asset = await this.store.get(next, 1);
                    if (!allowed() || asset.animated || asset.width * asset.height * 4 > PIXEL_LIMIT) return;
                    release = this.store.pin(next.url);
                    image = new Image();
                    image.decoding = 'async';
                    image.fetchPriority = 'low';
                    this.warmCandidate = image;
                    image.src = asset.fullUrl;
                    await image.decode();
                    await this.store.fitted(next, asset, this.fitSpec(asset), image);
                    if (!allowed()) return;
                    this.store.clearWarm();
                    this.store.warm = next.url;
                    asset.warmImage = image;
                    asset.decoded = true;
                    asset.used = Date.now();
                    image = null;
                } catch {} finally {
                    if (this.warmCandidate === image || token === this.warmToken) this.warmCandidate = null;
                    image?.removeAttribute('src');
                    release?.();
                    if (token === this.warmToken) this.warming = false;
                }
            };
            if (window.requestIdleCallback) this.idle = window.requestIdleCallback(callback, { timeout: 250 });
            else this.idle = setTimeout(callback, 40);
        }

        cancelIdle() {
            this.warmToken++;
            this.warming = false;
            this.warmCandidate?.removeAttribute('src');
            this.warmCandidate = null;
            if (!this.idle) return;
            if (window.cancelIdleCallback) window.cancelIdleCallback(this.idle);
            else clearTimeout(this.idle);
            this.idle = 0;
        }

        destroy(releaseStore = true) {
            if (this.dead) return;
            this.dead = true;
            this.cancelDrag?.();
            this.stopThumbnailScroll();
            this.version++;
            this.abort.abort();
            this.cancelIdle();
            this.cancelCache();
            if (this.drawing) cancelAnimationFrame(this.drawing);
            for (const timer of this.timers) clearTimeout(timer);
            this.releaseRetained();
            if (releaseStore) this.store.destroy();
            else this.store.pause(true);
            this.tileObserver?.disconnect();
            this.wakeObserver?.disconnect();
            this.resizeObserver?.disconnect();
            this.themeObserver?.disconnect();
            this.image.removeAttribute('src');
            this.fullCandidate?.removeAttribute('src');
            this.fitCanvas.width = this.fitCanvas.height = 1;
            this.fitDrawn = null;
            this.asset = null;
            this.host.remove();
        }
    }

    function boot() {
        let gallery = null;
        let queued = 0;
        let lastTicket = null;
        let loadingTicket = null;
        let store = null;
        let cacheTicket = null;

        const scan = () => {
            queued = 0;
            const ticket = routeContext();
            const pageTicket = routeContext(location.pathname, false);
            if (cacheTicket !== pageTicket) {
                gallery?.destroy(false);
                gallery = null;
                store?.destroy();
                store = null;
                cacheTicket = pageTicket;
            }
            if (ticket && ticket !== loadingTicket) {
                if (loadingTicket !== null) loadingVariant = chooseLoadingVariant();
                loadingTicket = ticket;
            }
            const block = ticket ? document.querySelector('.sim-fileAttachments--container') : null;
            const photos = block ? readPhotos(block, ticket) : [];
            const signature = photoSignature(photos);
            if (gallery && (gallery.ticket !== ticket || gallery.block !== block || !gallery.host.isConnected || gallery.signature !== signature)) {
                gallery.destroy(false);
                gallery = null;
            }
            lastTicket = ticket;
            if (block && !gallery && !document.getElementById(HOST_ID)) {
                if (!store) store = new PhotoStore();
                gallery = new Gallery(block, photos, ticket, store);
            }
        };

        const schedule = () => {
            if (!queued) queued = requestAnimationFrame(scan);
        };

        const observer = new MutationObserver(records => {
            if (routeContext() !== lastTicket || !gallery || !gallery.host.isConnected) {
                schedule();
                return;
            }
            for (const record of records) {
                if (gallery.block.contains(record.target)) {
                    schedule();
                    return;
                }
                for (const node of [...record.addedNodes, ...record.removedNodes]) {
                    if (node instanceof Element && (node.matches('.sim-fileAttachments--container') || node.contains(gallery.block))) {
                        schedule();
                        return;
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
        window.addEventListener('popstate', schedule);
        window.addEventListener('pageshow', schedule);
        window.addEventListener('pagehide', () => {
            if (queued) cancelAnimationFrame(queued);
            queued = 0;
            gallery?.destroy(false);
            gallery = null;
            store?.destroy();
            store = null;
        });
        scan();
    }

    boot();
})();
