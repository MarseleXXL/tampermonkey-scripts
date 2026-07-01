// ==UserScript==
// @name         GRAVIS dark mode
// @namespace    gravis-dark-mode
// @version      1.00
// @author       aolenche
// @description  Dark mode for GRAVIS pages
// @match        https://eu-cretfc-tools-dub.dub.proxy.amazon.com/gravis*
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/GRAVIS-dark-mode.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/GRAVIS-dark-mode.user.js
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const css = `
:root {
    color-scheme: dark !important;
    --gravis-bg: #0f1117;
    --gravis-bg-soft: #141821;
    --gravis-surface: #181d27;
    --gravis-surface-2: #202634;
    --gravis-surface-3: #293141;
    --gravis-border: #344052;
    --gravis-border-soft: #283140;
    --gravis-text: #e8edf5;
    --gravis-text-soft: #b8c2d0;
    --gravis-text-muted: #8f9aaa;
    --gravis-accent: #7aa7ff;
    --gravis-accent-2: #4fb67b;
    --gravis-accent-2-dark: #174832;
    --gravis-warning: #ffb454;
    --gravis-danger: #ff6b6b;
    --gravis-success: #4ade80;
}

html,
body,
my-app,
.package-container,
.return-unit-data,
.container,
.content-container,
.mat-drawer-container,
.mat-sidenav-container,
.mat-drawer-content,
.mat-sidenav-content,
.my-content {
    background: var(--gravis-bg) !important;
    color: var(--gravis-text) !important;
}

body,
.mat-drawer-container,
.mat-card,
.mat-toolbar,
.mat-button,
.mat-raised-button,
.mat-form-field,
.mat-select,
.mat-option,
input,
textarea,
button,
table,
td,
th,
h1,
h2,
h3,
h4,
p,
div,
span,
li {
    color: var(--gravis-text) !important;
}

.gravis-toolbar,
.mat-toolbar.mat-primary.gravis-toolbar {
    background: linear-gradient(90deg, #111827, #172033) !important;
    color: #ffffff !important;
    border-bottom: 1px solid var(--gravis-border) !important;
    box-shadow: 0 8px 18px rgba(0, 0, 0, .45) !important;
}

.gravis-toolbar a,
.gravis-toolbar span,
.gravis-toolbar label,
.gravis-toolbar .mat-select-value,
.gravis-toolbar .mat-select-placeholder,
.gravis-toolbar .mat-select-arrow,
.gravis-toolbar .mat-input-element {
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
}

.gravis-toolbar .mat-form-field-underline,
.gravis-toolbar .mat-select-underline {
    background-color: rgba(255, 255, 255, .7) !important;
    border-color: rgba(255, 255, 255, .7) !important;
}

.gravis-toolbar .mat-form-field-flex {
    background: rgba(255, 255, 255, .075) !important;
    border: 1px solid rgba(122, 167, 255, .35) !important;
    border-radius: 4px !important;
    padding: 0 8px 2px 8px !important;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .18) !important;
}

.gravis-toolbar .mat-form-field.mat-focused .mat-form-field-flex,
.gravis-toolbar .mat-form-field:hover .mat-form-field-flex {
    background: rgba(122, 167, 255, .11) !important;
    border-color: rgba(122, 167, 255, .62) !important;
}

.gravis-toolbar .mat-form-field-infix {
    border-top: 0 !important;
}

.gravis-toolbar .mat-form-field-wrapper {
    padding-bottom: 8px !important;
}

.gravis-toolbar .mat-form-field-underline,
.gravis-toolbar .mat-select-underline {
    display: none !important;
}

.id-list,
.container-packageId,
.return-unit-id-list-container,
.retrun-unit-id-list,
.package-data {
    background: var(--gravis-surface) !important;
    color: var(--gravis-text) !important;
    border-color: var(--gravis-border) !important;
}

.id-list {
    border-bottom: 1px solid var(--gravis-border) !important;
    box-shadow: 0 6px 16px rgba(0, 0, 0, .42) !important;
}

.container-packageId,
.return-unit-id,
.packageId,
td {
    color: var(--gravis-text-soft) !important;
    border-color: var(--gravis-border-soft) !important;
}

.return-unit-id:hover,
.container-packageId:hover,
td:hover {
    background: transparent !important;
    color: inherit !important;
}

.selected,
.return-unit-id.selected {
    color: #7fd8a3 !important;
    font-weight: 700 !important;
}

.selected-packageId,
.container-packageId.selected-packageId,
.id-list .selected-packageId {
    background: var(--gravis-accent-2-dark) !important;
    color: #ffffff !important;
}

.selected-packageId *,
.container-packageId.selected-packageId *,
.id-list .selected-packageId * {
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff !important;
}

.return-unit-navbar,
.mat-sidenav,
.mat-drawer,
.mat-drawer-inner-container {
    background: #121722 !important;
    color: var(--gravis-text) !important;
    border-right: 1px solid var(--gravis-border) !important;
}

.nav-data-list-header {
    background: #0b0f17 !important;
    color: #ffffff !important;
    border-bottom: 1px solid var(--gravis-border) !important;
    text-shadow: none !important;
}

.nav-data-list-contents,
.nav-data-list-contents li,
.return-unit-navbar li,
li {
    background: var(--gravis-surface) !important;
    color: var(--gravis-text-soft) !important;
    border-color: var(--gravis-border-soft) !important;
}

.nav-data-list-contents li:hover,
.return-unit-navbar li:hover,
li:hover {
    background: var(--gravis-surface) !important;
    color: var(--gravis-text-soft) !important;
}

.nav-data-list-contents li.selected,
.return-unit-navbar li.selected,
li.selected {
    background: #1e293b !important;
    color: #ffffff !important;
    border-left: 4px solid var(--gravis-accent-2-dark) !important;
}

.header,
.mat-toolbar.mat-primary.header {
    background: linear-gradient(90deg, #263247, #1d2738) !important;
    color: #ffffff !important;
    border: 1px solid var(--gravis-border) !important;
    box-shadow: 0 7px 18px rgba(0, 0, 0, .45) !important;
}

.title-card {
    color: #ffffff !important;
    text-shadow: none !important;
}

.number {
    background: var(--gravis-accent-2-dark) !important;
    color: #ffffff !important;
    box-shadow: none !important;
    text-shadow: none !important;
}

.mat-card,
.product-attributes,
.activity-card,
mat-card,
mat-card-content,
.mat-card-content,
.product-attributes-card-content,
.activity-card-content {
    background: var(--gravis-surface) !important;
    color: var(--gravis-text) !important;
    border-color: var(--gravis-border) !important;
}

.mat-card,
.product-attributes,
.activity-card {
    border: 1px solid var(--gravis-border) !important;
    box-shadow: 0 10px 24px rgba(0, 0, 0, .38) !important;
}

.content {
    background: transparent !important;
    color: var(--gravis-text) !important;
    border-color: var(--gravis-border-soft) !important;
}

.card-container {
    background: var(--gravis-bg) !important;
}

table,
tbody,
tr,
td,
th,
.table-content {
    background: transparent !important;
    color: var(--gravis-text) !important;
    border-color: var(--gravis-border-soft) !important;
}

tr:hover,
tr:hover td,
tr:hover .table-content {
    background: transparent !important;
}

td:first-child,
td:first-child .table-content,
h3 {
    color: #dce6f5 !important;
    font-weight: 650 !important;
}

td:not(:first-child),
td:not(:first-child) .table-content,
attribute div {
    color: var(--gravis-text-soft) !important;
}

.empty-package {
    color: var(--gravis-text-muted) !important;
}

.question {
    color: var(--gravis-text) !important;
}

.answer {
    color: var(--gravis-success) !important;
}

a:not(.product-link-button),
a:not(.product-link-button):visited {
    color: var(--gravis-accent) !important;
}

a:not(.product-link-button):hover,
a:not(.product-link-button):focus {
    color: #a8c7ff !important;
    text-decoration: underline !important;
}

a:not(.product-link-button) attribute div,
a:not(.product-link-button) .table-content,
td a:not(.product-link-button),
td a:not(.product-link-button) attribute div,
td a:not(.product-link-button) .table-content,
.mat-card a:not(.product-link-button),
.mat-card a:not(.product-link-button) attribute div,
.mat-card a:not(.product-link-button) .table-content,
.mat-card a:not(.product-link-button) div {
    color: var(--gravis-accent) !important;
    -webkit-text-fill-color: var(--gravis-accent) !important;
}

.mat-raised-button,
.mat-button,
.mat-flat-button,
.mat-stroked-button,
button {
    background: var(--gravis-surface-2) !important;
    color: var(--gravis-text) !important;
    border: 1px solid var(--gravis-border) !important;
    box-shadow: 0 3px 10px rgba(0, 0, 0, .35) !important;
}

.mat-raised-button.mat-primary,
.mat-button.mat-primary,
button.mat-primary {
    background: #263b66 !important;
    color: #ffffff !important;
    border-color: #385487 !important;
}

.mat-raised-button.mat-accent,
.mat-button.mat-accent,
button.mat-accent {
    background: #244b39 !important;
    color: #ffffff !important;
    border-color: #3a6b54 !important;
}

.mat-raised-button:hover,
.mat-button:hover,
.mat-flat-button:hover,
.mat-stroked-button:hover,
button:hover {
    filter: none !important;
}

.mat-button-focus-overlay {
    background: rgba(255, 255, 255, .10) !important;
}

.mat-form-field,
.mat-form-field-wrapper,
.mat-form-field-flex,
.mat-form-field-infix,
.mat-select,
.mat-select-trigger,
.mat-select-value,
.mat-select-placeholder,
.mat-form-field-label,
.mat-input-element,
input,
textarea,
select {
    color: var(--gravis-text) !important;
    -webkit-text-fill-color: var(--gravis-text) !important;
}

input,
textarea,
select {
    background: transparent !important;
    caret-color: var(--gravis-accent) !important;
}

input::placeholder,
textarea::placeholder {
    color: var(--gravis-text-muted) !important;
    -webkit-text-fill-color: var(--gravis-text-muted) !important;
}

.mat-form-field-underline,
.mat-form-field-ripple,
.mat-select-underline {
    background-color: var(--gravis-border) !important;
    border-color: var(--gravis-border) !important;
}

.mat-focused .mat-form-field-ripple,
.mat-form-field-ripple.mat-accent {
    background-color: var(--gravis-accent) !important;
}

.mat-select-arrow {
    color: var(--gravis-text-soft) !important;
}

.cdk-overlay-container,
.cdk-overlay-pane {
    color: var(--gravis-text) !important;
}

.mat-select-panel,
.mat-menu-panel,
.mat-autocomplete-panel,
.mat-dialog-container {
    background: var(--gravis-surface) !important;
    color: var(--gravis-text) !important;
    border: 1px solid var(--gravis-border) !important;
    box-shadow: 0 12px 28px rgba(0, 0, 0, .55) !important;
}

.mat-option,
.mat-menu-item {
    background: var(--gravis-surface) !important;
    color: var(--gravis-text-soft) !important;
}

.mat-option:hover,
.mat-option.mat-active,
.mat-menu-item:hover {
    background: var(--gravis-surface) !important;
    color: var(--gravis-text-soft) !important;
}

.mat-snack-bar-container,
.mat-tooltip {
    background: #111827 !important;
    color: #ffffff !important;
    border: 1px solid var(--gravis-border) !important;
}

.NA {
    color: #ff8a80 !important;
}

.damaged {
    background-color: #b91c1c !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

.not-damaged {
    background-color: #15803d !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

.product-attributes-image,
img.return-unit-tile-image,
img {
    background: #ffffff !important;
    border-radius: 6px !important;
}

.return-unit-tile,
.return-unit-tile-header,
.return-unit-tile-header1 {
    border-color: var(--gravis-border) !important;
}

.return-unit-tile {
    background: var(--gravis-surface) !important;
}

.return-unit-tile-header {
    background: #263b66 !important;
    color: #ffffff !important;
}

.return-unit-tile-header1 {
    background: #244b39 !important;
    color: #ffffff !important;
}

.spinner {
    background-color: var(--gravis-accent) !important;
}

::selection {
    background: rgba(122, 167, 255, .35) !important;
    color: #ffffff !important;
}

::-webkit-scrollbar {
    width: 10px !important;
    height: 10px !important;
}

::-webkit-scrollbar-track {
    background: #0b0f17 !important;
}

::-webkit-scrollbar-thumb {
    background: #3b465a !important;
    border-radius: 999px !important;
    border: 2px solid #0b0f17 !important;
}

::-webkit-scrollbar-thumb:hover {
    background: #536179 !important;
}

img,
svg,
canvas,
video {
    filter: none !important;
}

html body my-app mat-card mat-card-actions a.product-link-button,
html body my-app mat-card mat-card-actions a.product-link-button:link,
html body my-app mat-card mat-card-actions a.product-link-button:visited,
html body my-app mat-card mat-card-actions a.product-link-button:hover,
html body my-app mat-card mat-card-actions a.product-link-button:focus,
html body my-app mat-card mat-card-actions a.product-link-button:active {
    color: var(--gravis-text) !important;
    -webkit-text-fill-color: var(--gravis-text) !important;
    text-decoration: none !important;
}

html body my-app mat-card mat-card-actions a.product-link-button button,
html body my-app mat-card mat-card-actions a.product-link-button button.mat-raised-button,
html body my-app mat-card mat-card-actions a.product-link-button button.mat-primary,
html body my-app mat-card mat-card-actions a.product-link-button button.mat-raised-button.mat-primary,
html body my-app mat-card mat-card-actions a.product-link-button button span,
html body my-app mat-card mat-card-actions a.product-link-button button .mat-button-wrapper,
html body my-app mat-card mat-card-actions a.product-link-button button .mat-button-wrapper *,
html body my-app mat-card mat-card-actions a.product-link-button .mat-raised-button,
html body my-app mat-card mat-card-actions a.product-link-button .mat-raised-button *,
html body my-app mat-card mat-card-actions a.product-link-button .mat-primary,
html body my-app mat-card mat-card-actions a.product-link-button .mat-primary * {
    color: var(--gravis-text) !important;
    -webkit-text-fill-color: var(--gravis-text) !important;
    text-decoration: none !important;
}
`;

    function addStyle() {
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
            return;
        }

        const style = document.createElement('style');
        style.id = 'gravis-dark-mode-style';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    addStyle();
})();
