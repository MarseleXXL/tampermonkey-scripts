// ==UserScript==
// @name         Badge photos
// @namespace    http://tampermonkey.net/
// @version      1.00
// @author       aolenche
// @description  Replaces the employee QR code with the employee badge photo in FCResearch.
// @match        *://fcresearch-eu.aka.amazon.com/*
// @match        *://qi-fcresearch-eu.corp.amazon.com/*
// @icon         https://drive-render.corp.amazon.com/view/aolenche@/Icons/Badge_photos.png
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Badge photos.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Badge photos.user.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const EMPLOYEE_SECTION_SELECTOR = '[data-section-type="employee"]';
    const EMPLOYEE_TABLE_SELECTOR = 'table.a-keyvalue[data-row-id]';
    const EMPLOYEE_PHOTO_SELECTOR = '.a-column.a-span4 img';
    const PHOTO_URL = 'https://badgephotos.corp.amazon.com/?uid=';
    const pendingSections = new Set();
    const photoCache = new Map();
    let flushScheduled = false;
    let preloadScheduled = false;
    let activeLink = null;
    let activeLogin = '';
    let previewHost = null;
    let previewImage = null;
    let previewStatus = null;

    function getHistoryLogin(node) {
        const link = node?.closest?.('a[href]');
        const cell = link?.closest('td');
        const table = cell?.closest('table');
        if (table?.id !== 'table-inventory-history') return null;

        const header = table.tHead?.querySelector('[id="inventory-history-person"]');
        if (!header || cell.cellIndex !== header.cellIndex) return null;

        const login = link.textContent.trim();
        if (!/^[a-z][a-z0-9._-]*$/i.test(login)) return null;

        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || url.searchParams.get('s') !== login) return null;

        return { link, login };
    }

    function hidePreview() {
        activeLink = null;
        activeLogin = '';
        if (previewHost) previewHost.style.display = 'none';
    }

    function renderCachedPhoto(entry) {
        if (previewImage !== entry.image || activeLogin !== entry.login) return;

        entry.image.hidden = entry.state !== 'ready';
        previewStatus.hidden = entry.state === 'ready';
        previewStatus.textContent = entry.state === 'error' ? 'Фото недоступне' : '…';
    }

    function getCachedPhoto(login) {
        if (photoCache.has(login)) return photoCache.get(login);

        const image = document.createElement('img');
        const entry = { login, image, state: 'loading' };
        photoCache.set(login, entry);
        image.alt = `Employee photo: ${login}`;
        image.loading = 'eager';
        image.decoding = 'async';

        image.addEventListener('load', async () => {
            try {
                await image.decode();
            } catch {}

            if (entry.state !== 'loading') return;
            entry.state = 'ready';
            renderCachedPhoto(entry);
        });

        image.addEventListener('error', () => {
            entry.state = 'error';
            renderCachedPhoto(entry);
        });

        image.src = PHOTO_URL + encodeURIComponent(login);
        return entry;
    }

    function preloadHistoryPhotos() {
        preloadScheduled = false;
        const table = document.querySelector('#table-inventory-history');
        const header = table?.tHead?.querySelector('[id="inventory-history-person"]');
        if (!header) return;

        for (const row of table.tBodies[0]?.rows || []) {
            const cell = row.cells[header.cellIndex];
            for (const link of cell?.querySelectorAll('a[href]') || []) {
                const employee = getHistoryLogin(link);
                if (employee) getCachedPhoto(employee.login);
            }
        }
    }

    function scheduleHistoryPreload(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        const inHistory = element?.closest('#table-inventory-history');
        const hasHistory = node?.querySelector?.('#table-inventory-history');
        if ((!inHistory && !hasHistory) || preloadScheduled) return;

        preloadScheduled = true;
        queueMicrotask(preloadHistoryPhotos);
    }

    function createPreview() {
        if (previewHost) return;

        previewHost = document.createElement('div');
        previewHost.id = 'badge-photos-preview';
        previewHost.setAttribute('aria-hidden', 'true');
        previewHost.style.cssText = `
            all: initial;
            position: fixed;
            display: none;
            width: 96px;
            height: 112px;
            z-index: 2147483647;
            pointer-events: none;
        `;

        const root = previewHost.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            .card {
                box-sizing: border-box;
                width: 96px;
                height: 112px;
                padding: 4px;
                overflow: hidden;
                border: 1px solid #4b5563;
                border-radius: 6px;
                background: #1f2329;
                box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
            }

            img {
                width: 100%;
                height: 100%;
                object-fit: contain;
                border-radius: 3px;
            }

            .status {
                color: #e5e7eb;
                font: 12px/1.3 Arial, sans-serif;
                text-align: center;
            }

            [hidden] {
                display: none;
            }
        `;

        const card = document.createElement('div');
        card.className = 'card';
        previewStatus = document.createElement('span');
        previewStatus.className = 'status';
        card.append(previewStatus);
        root.append(style, card);
        document.body.append(previewHost);
    }

    function positionPreview() {
        const rect = activeLink.getBoundingClientRect();
        const width = 96;
        const height = 112;
        const gap = 8;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        let left = rect.right + gap;

        if (left + width > viewportWidth - gap) {
            left = rect.left - width - gap;
        }

        left = Math.max(gap, Math.min(left, viewportWidth - width - gap));
        const top = Math.max(gap, Math.min(rect.top, viewportHeight - height - gap));
        previewHost.style.left = `${left}px`;
        previewHost.style.top = `${top}px`;
    }

    function showPreview() {
        const employee = getHistoryLogin(activeLink);
        if (!activeLink?.isConnected || employee?.login !== activeLogin || !document.body) {
            hidePreview();
            return;
        }

        createPreview();
        previewImage?.remove();
        const entry = getCachedPhoto(activeLogin);
        previewImage = entry.image;
        previewStatus.parentElement.append(entry.image);
        renderCachedPhoto(entry);
        positionPreview();
        previewHost.style.display = 'block';
    }

    function startPreview(event) {
        const employee = getHistoryLogin(event.target);
        if (!employee) return;
        if (activeLink === employee.link && activeLogin === employee.login) return;

        hidePreview();
        activeLink = employee.link;
        activeLogin = employee.login;
        showPreview();
    }

    function leavePreview(event) {
        if (!activeLink || !activeLink.contains(event.target)) return;
        if (event.relatedTarget && activeLink.contains(event.relatedTarget)) return;
        hidePreview();
    }

    document.addEventListener('mouseover', startPreview);
    document.addEventListener('mouseout', leavePreview);
    document.addEventListener('focusin', startPreview);
    document.addEventListener('focusout', leavePreview);
    document.addEventListener('scroll', hidePreview, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') hidePreview();
    });
    window.addEventListener('resize', hidePreview);
    window.addEventListener('blur', hidePreview);

    function findSection(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
        if (node.matches(EMPLOYEE_SECTION_SELECTOR)) return node;
        return node.closest(EMPLOYEE_SECTION_SELECTOR);
    }

    function setAttribute(element, name, value) {
        if (element.getAttribute(name) !== value) {
            element.setAttribute(name, value);
        }
    }

    function updateEmployeePhoto(section) {
        const table = section.querySelector(EMPLOYEE_TABLE_SELECTOR);
        const login = (table?.getAttribute('data-row-id') || '').trim();
        if (!login) return;

        const image = section.querySelector(EMPLOYEE_PHOTO_SELECTOR);
        if (!image) return;

        const target = PHOTO_URL + encodeURIComponent(login);

        image.loading = 'eager';
        image.decoding = 'async';

        if (!image.getAttribute('alt')) {
            image.setAttribute('alt', `Employee photo: ${login}`);
        }

        if (image.hasAttribute('data-src')) {
            setAttribute(image, 'data-src', target);
        }

        if (image.hasAttribute('srcset')) {
            setAttribute(image, 'srcset', target);
        }

        setAttribute(image, 'src', target);
    }

    function flushSections() {
        flushScheduled = false;

        for (const section of pendingSections) {
            updateEmployeePhoto(section);
        }

        pendingSections.clear();
    }

    function scheduleSection(section) {
        if (!section) return;

        pendingSections.add(section);

        if (!flushScheduled) {
            flushScheduled = true;
            queueMicrotask(flushSections);
        }
    }

    function scanNode(node) {
        scheduleSection(findSection(node));
        scheduleHistoryPreload(node);

        if (node?.querySelectorAll) {
            node.querySelectorAll(EMPLOYEE_SECTION_SELECTOR).forEach(scheduleSection);
        }
    }

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            scheduleHistoryPreload(mutation.target);
            if (mutation.type === 'attributes') {
                scheduleSection(findSection(mutation.target));
                continue;
            }

            scheduleSection(findSection(mutation.target));
            mutation.addedNodes.forEach(scanNode);
        }

        if (activeLink && (!activeLink.isConnected || getHistoryLogin(activeLink)?.login !== activeLogin)) {
            hidePreview();
        }
    });

    observer.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'data-src', 'data-row-id', 'href']
    });

    scanNode(document);
})();
