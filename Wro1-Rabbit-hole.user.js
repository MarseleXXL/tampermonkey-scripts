// ==UserScript==
// @name         WRO1_Rabbit_hole
// @namespace    wro1-rabbit-hole
// @version      1.0.0
// @description  Zawsze pozostawia wybrany magazyn WRO1
// @author       aolenche
// @match        https://eu.rabbit-hole.fc.amazon.dev/*
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Wro1-Rabbit-hole.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Wro1-Rabbit-hole.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const REQUIRED_WAREHOUSE = 'WRO1';
    const WAREHOUSE_SELECTOR = '#user_warehouse';
    const SET_WAREHOUSE_PATH = `/set_warehouse/${REQUIRED_WAREHOUSE}`;

    let observerStarted = false;
    let redirectRequested = false;

    function lockWarehouseSelector(select) {
        const requiredOption = Array.from(select.options).find(
            (option) => option.value === REQUIRED_WAREHOUSE
        );

        if (!requiredOption) {
            return;
        }

        const previousWarehouse = select.value;

        for (const option of Array.from(select.options)) {
            if (option !== requiredOption) {
                option.remove();
            }
        }

        if (!requiredOption.selected) {
            requiredOption.selected = true;
        }

        if (select.value !== REQUIRED_WAREHOUSE) {
            select.value = REQUIRED_WAREHOUSE;
        }

        if (!select.disabled) {
            select.disabled = true;
        }

        if (select.dataset.wro1Locked !== 'true') {
            select.dataset.wro1Locked = 'true';
            select.title = 'Склад зафіксовано на WRO1';
            select.setAttribute('aria-label', 'Склад WRO1, вибір заблоковано');
        }

        if (
            previousWarehouse !== REQUIRED_WAREHOUSE
            && !redirectRequested
            && window.location.pathname !== SET_WAREHOUSE_PATH
        ) {
            redirectRequested = true;
            window.location.replace(SET_WAREHOUSE_PATH);
        }
    }

    function enforceWro1() {
        const select = document.querySelector(WAREHOUSE_SELECTOR);

        if (select instanceof HTMLSelectElement) {
            lockWarehouseSelector(select);
        }
    }

    const observer = new MutationObserver(enforceWro1);

    function start() {
        enforceWro1();

        if (!observerStarted && document.documentElement) {
            observerStarted = true;
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
            });
        }
    }

    start();
    document.addEventListener('DOMContentLoaded', start, { once: true });
    window.addEventListener('pageshow', enforceWro1);
})();
