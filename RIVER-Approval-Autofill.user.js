// ==UserScript==
// @name         RIVER Approval Autofill
// @namespace    https://river-dub.amazon.com/
// @version      1.13
// @description  Automatically fills selected RIVER workflow fields.
// @author       aolenche
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/RIVER-Approval-Autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/RIVER-Approval-Autofill.user.js
// @match        https://river-dub.amazon.com/*/workflows*
// @match        https://t.corp.amazon.com/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==
(function () {
    'use strict';

    const PAGE_WINDOW =
        typeof unsafeWindow === 'object' && unsafeWindow
            ? unsafeWindow
            : window;
    const VALUES = {
        tool: 'Delete items',
        asin: 'MIX',
        adjustmentComment: 'IOL Reduction Process, IOL older than 15 days.',
        rootCause: 'IOL',
        rootCauseDetails: 'The product could not be found. List of missing units in attached excel file.'
    };

    const FIELDS = [
        {
            key: 'tool',
            type: 'select',
            value: VALUES.tool,
            selector: 'select[ng-model^="data.toolDropdown"]'
        },
        {
            key: 'asin',
            type: 'input',
            value: VALUES.asin,
            selector: 'input[ng-model^="data.asinInput"]'
        },
        {
            key: 'adjustmentComment',
            type: 'textarea',
            value: VALUES.adjustmentComment,
            selector: 'textarea[ng-model^="data.commentArea"]'
        },
        {
            key: 'rootCause',
            type: 'select',
            value: VALUES.rootCause,
            selector: 'select[ng-model^="data.rootcauseDropdown"]'
        },
        {
            key: 'rootCauseDetails',
            type: 'textarea',
            value: VALUES.rootCauseDetails,
            selector: 'textarea[ng-model^="data.rootcauseComment"]'
        }
    ];

    const RUN_TIMEOUT_MS = 60000;
    const RETRY_INTERVAL_MS = 400;
    const BACKOFF_INTERVAL_MS = 2000;
    const REQUIRED_STABLE_PASSES = 3;
    const CONTAINER_HINT_PATTERN = /container|pojemnik/i;
    const ISSUE_LINK_SELECTOR = 'a#viewIssue[href]';
    const CANONICAL_ISSUE_PATH_PATTERN = /^\/(D\d+)(?:\/|$)/i;
    const ISSUE_SHORT_PATH_PATTERN =
        /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
    const ISSUE_RESOLUTION_STORAGE_PREFIX =
        'river-issue-resolution:';
    const ISSUE_RESOLVER_TIMEOUT_MS = 15000;
    const PATTERN_ATTRIBUTES = [
        'pattern',
        'ng-pattern',
        'data-ng-pattern',
        'x-ng-pattern'
    ];

    let currentUrl = location.href;
    let filledElements = new Map();
    let fieldConfirmations = new Map();
    let startedAt = Date.now();
    let retryTimer = null;
    let retryIntervalMs = null;
    let observer = null;
    let scheduledFillTimer = null;
    const issueResolutionCache = new Map();
    const issueLinkButtons = new WeakMap();
    const automaticIssueCopies = new Map();
    const pendingTabResolutions = new Map();
    function isUsableElement(element) {
        if (!element || element.disabled) {
            return false;
        }

        if (element.closest('.ng-hide, [hidden]')) {
            return false;
        }

        if (element instanceof HTMLSelectElement) {
            const wrapper = element.closest('.cs-select-wrapper');
            const trigger = wrapper &&
                wrapper.querySelector('.cs-select-trigger');

            if (trigger) {
                return isUsableElement(trigger);
            }
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }

        return true;
    }

    function findField(field) {
        return Array.from(document.querySelectorAll(field.selector)).find(isUsableElement) || null;
    }

    function getTargetValue(field, element) {
        if (field.type !== 'select') {
            return field.value;
        }

        const option = findMatchingOption(element, field.value);
        return option ? option.value : null;
    }

    function findMatchingOption(select, wantedValue) {
        const normalizedWanted = normalizeText(wantedValue);

        return Array.from(select.options).find(option => {
            return normalizeText(option.value) === normalizedWanted ||
                normalizeText(option.textContent) === normalizedWanted;
        }) || null;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function valuesMatch(actualValue, expectedValue) {
        return normalizeText(actualValue) === normalizeText(expectedValue);
    }

    function setNativeValue(element, value) {
        const prototype =
            element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : element instanceof HTMLSelectElement
                    ? HTMLSelectElement.prototype
                    : HTMLInputElement.prototype;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        if (descriptor && descriptor.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }
    }

    function syncCustomSelect(element) {
        if (!(element instanceof HTMLSelectElement)) return;
        const wrapper = element.closest('.cs-select-wrapper');
        const trigger = wrapper && wrapper.querySelector('.cs-select-trigger');
        if (!trigger) return;

        const controller = getAngularModelController(element);
        const invalid = !element.validity.valid || !!(controller && controller.$invalid);
        const color = invalid ? 'rgb(217, 21, 21)' : 'rgb(125, 137, 152)';
        if (trigger.style.borderColor !== color) trigger.style.borderColor = color;

        const option = element.options[element.selectedIndex];
        const text = wrapper.querySelector('.cs-select-trigger-text');
        if (text && option && text.textContent !== option.textContent) {
            text.textContent = option.textContent;
        }

        for (const item of wrapper.querySelectorAll('.cs-select-option')) {
            const index = item.getAttribute('data-index');
            const selected = index !== null
                ? Number(index) === element.selectedIndex
                : item.getAttribute('data-value') === element.value;
            if (item.classList.contains('cs-select-option-selected') !== selected) {
                item.classList.toggle('cs-select-option-selected', selected);
            }
            const check = item.querySelector('.cs-select-check');
            if (!selected && check) check.remove();
            if (selected && !check) {
                const mark = document.createElement('span');
                mark.className = 'cs-select-check';
                mark.textContent = '\u2713';
                item.appendChild(mark);
            }
        }
    }
    function getContainerFieldHint(element) {
        const attributes = [
            'ng-model',
            'data-ng-model',
            'x-ng-model',
            'name',
            'id',
            'placeholder',
            'aria-label'
        ];
        const hints = attributes.map(name => element.getAttribute(name) || '');

        if (element.labels) {
            hints.push(
                ...Array.from(element.labels).map(label => label.textContent || '')
            );
        }

        const fieldContainer = element.closest(
            '.form-group, .a-form-group, awsui-form-field'
        );
        if (fieldContainer) {
            hints.push(fieldContainer.textContent || '');
        }

        return hints.join(' ');
    }

    function isContainerField(element) {
        return (
            (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement) &&
            CONTAINER_HINT_PATTERN.test(getContainerFieldHint(element))
        );
    }

    function getAngularModelController(element) {
        if (!PAGE_WINDOW.angular) {
            return null;
        }

        const ngElement = PAGE_WINDOW.angular.element(element);
        if (!ngElement || typeof ngElement.controller !== 'function') {
            return null;
        }

        return ngElement.controller('ngModel') || null;
    }

    function relaxContainerField(element) {
        for (const attribute of PATTERN_ATTRIBUTES) {
            element.removeAttribute(attribute);
        }

        if (typeof element.setCustomValidity === 'function') {
            element.setCustomValidity('');
        }

        try {
            const controller = getAngularModelController(element);
            if (controller && controller.$validators && controller.$validators.pattern) {
                delete controller.$validators.pattern;
                if (typeof controller.$validate === 'function') {
                    controller.$validate();
                }
            }
        } catch (error) {
            console.warn('[RIVER Auto Fill] Container validation update skipped:', error);
        }
    }

    function relaxContainerFields() {
        const fields = document.querySelectorAll('input, textarea');

        for (const element of fields) {
            if (isContainerField(element)) {
                relaxContainerField(element);
            }
        }
    }

    function insertAtSelection(element, text) {
        const value = String(element.value || '');
        const start = Number.isInteger(element.selectionStart)
            ? element.selectionStart
            : value.length;
        const end = Number.isInteger(element.selectionEnd)
            ? element.selectionEnd
            : start;
        const nextValue = value.slice(0, start) + text + value.slice(end);

        setNativeValue(element, nextValue);
        updateAngularModel(element, nextValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));

        if (typeof element.setSelectionRange === 'function') {
            const nextPosition = start + text.length;
            element.setSelectionRange(nextPosition, nextPosition);
        }
    }
    function updateAngularModel(element, value) {
        try {
            if (!PAGE_WINDOW.angular) {
                return;
            }

            const controller = getAngularModelController(element);
            if (controller && typeof controller.$setViewValue === 'function') {
                controller.$setViewValue(value);
                if (typeof controller.$render === 'function') {
                    controller.$render();
                }
            }

            const model = element.getAttribute('ng-model') || '';
            const match = model.match(/^data\.([A-Za-z0-9_]+)$/);

            if (!match) {
                return;
            }

            const propName = match[1];
            const ngElement = PAGE_WINDOW.angular.element(element);
            const scope = ngElement.scope() || ngElement.isolateScope();

            if (!scope) {
                return;
            }

            if (!scope.data) {
                scope.data = {};
            }

            scope.data[propName] = value;

            if (typeof scope.$applyAsync === 'function') {
                scope.$applyAsync();
            } else if (typeof scope.$apply === 'function' && !scope.$$phase) {
                scope.$apply();
            }
        } catch (error) {
            console.warn('[RIVER Auto Fill] Angular model update skipped:', error);
        }
    }

    function allowContainerUnderscore(event) {
        if (
            event.key !== '_' ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            !isContainerField(event.target)
        ) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        relaxContainerField(event.target);
        insertAtSelection(event.target, '_');
    }

    function fireEvents(element) {
        const events = ['focus', 'input', 'change', 'keyup', 'blur'];

        for (const eventName of events) {
            element.dispatchEvent(new Event(eventName, { bubbles: true }));
        }

        try {
            if (PAGE_WINDOW.jQuery) {
                PAGE_WINDOW.jQuery(element)
                    .trigger('input')
                    .trigger('change')
                    .trigger('blur');
            }
        } catch (error) {
            console.warn('[RIVER Auto Fill] jQuery events skipped:', error);
        }
    }
    function fillField(field) {
        const element = findField(field);
        if (!element) {
            fieldConfirmations.delete(field.key);
            return false;
        }

        const completedElement = filledElements.get(field.key);
        syncCustomSelect(element);
        if (completedElement === element) {
            return false;
        }

        if (completedElement && completedElement !== element) {
            filledElements.delete(field.key);
            fieldConfirmations.delete(field.key);
            startedAt = Date.now();
            ensureRetryTimer(RETRY_INTERVAL_MS);
        }

        const valueToSet = getTargetValue(field, element);
        if (valueToSet === null) {
            fieldConfirmations.delete(field.key);
            return false;
        }

        if (valuesMatch(element.value, valueToSet)) {
            const previous = fieldConfirmations.get(field.key);
            const stablePasses =
                previous &&
                previous.element === element &&
                valuesMatch(previous.value, valueToSet)
                    ? previous.stablePasses + 1
                    : 1;

            if (stablePasses >= REQUIRED_STABLE_PASSES) {
                filledElements.set(field.key, element);
                fieldConfirmations.delete(field.key);
                console.info(`[RIVER Auto Fill] Confirmed ${field.key}: ${field.value}`);
            } else {
                fieldConfirmations.set(field.key, {
                    element,
                    value: valueToSet,
                    stablePasses
                });
            }

            return false;
        }

        fieldConfirmations.set(field.key, {
            element,
            value: valueToSet,
            stablePasses: 0
        });
        setNativeValue(element, valueToSet);
        updateAngularModel(element, valueToSet);
        fireEvents(element);
        syncCustomSelect(element);

        console.info(`[RIVER Auto Fill] Fill attempt ${field.key}: ${field.value}`);

        return true;
    }

    function resetFillCycle(reason) {
        currentUrl = location.href;
        filledElements = new Map();
        fieldConfirmations = new Map();
        startedAt = Date.now();
        ensureRetryTimer(RETRY_INTERVAL_MS);
        console.info(`[RIVER Auto Fill] ${reason}, new fill cycle started.`);
    }

    function tryFillVisibleFields() {
        if (location.href !== currentUrl) {
            resetFillCycle('URL changed');
        }

        relaxContainerFields();
        enhanceIssueLinks();

        for (const field of FIELDS) {
            fillField(field);
        }

        if (filledElements.size === FIELDS.length) {
            pauseRetryTimer('all fields are stable');
        } else if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
            ensureRetryTimer(BACKOFF_INTERVAL_MS);
        } else {
            ensureRetryTimer(RETRY_INTERVAL_MS);
        }
    }
    function normalizeCanonicalIssueUrl(value) {
        try {
            const url = new URL(String(value || ''), location.href);
            if (
                url.protocol !== 'https:' ||
                url.hostname.toLowerCase() !== 't.corp.amazon.com'
            ) {
                return null;
            }

            const match = url.pathname.match(CANONICAL_ISSUE_PATH_PATTERN);
            return match
                ? `https://t.corp.amazon.com/${match[1].toUpperCase()}`
                : null;
        } catch {
            return null;
        }
    }

    function normalizeIssueSourceUrl(value) {
        try {
            const url = new URL(String(value || ''), location.href);
            if (
                url.protocol !== 'https:' ||
                url.hostname.toLowerCase() !== 't.corp.amazon.com'
            ) {
                return null;
            }

            const match = url.pathname.match(ISSUE_SHORT_PATH_PATTERN);
            return match
                ? `https://t.corp.amazon.com/${match[1].toLowerCase()}`
                : null;
        } catch {
            return null;
        }
    }

    function createIssueResolutionStorageKey(sourceUrl) {
        const normalized = normalizeIssueSourceUrl(sourceUrl);
        return normalized
            ? ISSUE_RESOLUTION_STORAGE_PREFIX +
                normalized.slice(normalized.lastIndexOf('/') + 1)
            : null;
    }
    function finishTabResolution(storageKey, error, canonicalUrl) {
        const pending = pendingTabResolutions.get(storageKey);
        if (!pending) {
            return;
        }

        pendingTabResolutions.delete(storageKey);
        clearTimeout(pending.timeout);
        GM_removeValueChangeListener(pending.listenerId);
        GM_deleteValue(storageKey);

        if (pending.tab && !pending.tab.closed) {
            pending.tab.close();
        }

        if (canonicalUrl) {
            pending.resolve(canonicalUrl);
        } else {
            pending.reject(error);
        }
    }

    function readSharedIssueResolution(value, sourceUrl) {
        if (!value || value.sourceUrl !== sourceUrl) {
            return null;
        }
        return normalizeCanonicalIssueUrl(value.canonicalUrl);
    }

    function resolveCanonicalIssueUrlInBackgroundTab(sourceUrl) {
        const normalizedSource = normalizeIssueSourceUrl(sourceUrl);
        const storageKey = createIssueResolutionStorageKey(sourceUrl);

        if (
            !normalizedSource ||
            !storageKey ||
            typeof GM_openInTab !== 'function' ||
            typeof GM_setValue !== 'function' ||
            typeof GM_deleteValue !== 'function' ||
            typeof GM_addValueChangeListener !== 'function' ||
            typeof GM_removeValueChangeListener !== 'function'
        ) {
            return Promise.reject(
                new Error('Background ticket resolution is unavailable.')
            );
        }

        return new Promise((resolve, reject) => {
            GM_deleteValue(storageKey);

            const listenerId = GM_addValueChangeListener(
                storageKey,
                (_key, _oldValue, newValue) => {
                    const canonicalUrl = readSharedIssueResolution(
                        newValue,
                        normalizedSource
                    );
                    if (canonicalUrl) {
                        finishTabResolution(
                            storageKey,
                            null,
                            canonicalUrl
                        );
                    }
                }
            );
            const timeout = setTimeout(() => {
                finishTabResolution(
                    storageKey,
                    new Error(
                        'Canonical issue link was not detected in time.'
                    )
                );
            }, ISSUE_RESOLVER_TIMEOUT_MS);

            const pending = {
                listenerId,
                reject,
                resolve,
                tab: null,
                timeout
            };
            pendingTabResolutions.set(storageKey, pending);

            try {
                pending.tab = GM_openInTab(normalizedSource, {
                    active: false,
                    insert: false,
                    setParent: true
                });
                if (pending.tab) {
                    pending.tab.onclose = () => {
                        finishTabResolution(
                            storageKey,
                            new Error(
                                'Background ticket tab was closed early.'
                            )
                        );
                    };
                }
            } catch (error) {
                finishTabResolution(storageKey, error);
            }
        });
    }
    function isTicketResolverHost() {
        try {
            return (
                new URL(location.href).hostname.toLowerCase() ===
                't.corp.amazon.com'
            );
        } catch {
            return false;
        }
    }

    function startTicketResolverTab() {
        const sourceUrl = normalizeIssueSourceUrl(location.href);
        const storageKey = createIssueResolutionStorageKey(sourceUrl);
        if (!sourceUrl || !storageKey || typeof GM_setValue !== 'function') {
            return;
        }

        let pollTimer = null;
        let stopTimer = null;

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            if (stopTimer) {
                clearTimeout(stopTimer);
                stopTimer = null;
            }
        }

        function reportCanonicalUrl() {
            const canonicalUrl = normalizeCanonicalIssueUrl(location.href);
            if (!canonicalUrl) {
                return false;
            }

            stopPolling();
            GM_setValue(storageKey, {
                canonicalUrl,
                sourceUrl,
                timestamp: Date.now()
            });
            if (typeof PAGE_WINDOW.stop === 'function') {
                PAGE_WINDOW.stop();
            }
            return true;
        }

        if (reportCanonicalUrl()) {
            return;
        }

        pollTimer = setInterval(reportCanonicalUrl, 50);
        stopTimer = setTimeout(stopPolling, ISSUE_RESOLVER_TIMEOUT_MS);
        window.addEventListener('popstate', reportCanonicalUrl);
        window.addEventListener('hashchange', reportCanonicalUrl);
    }
    function resolveCanonicalIssueUrl(sourceUrl) {
        const direct = normalizeCanonicalIssueUrl(sourceUrl);
        if (direct) {
            return Promise.resolve(direct);
        }

        return resolveCanonicalIssueUrlInBackgroundTab(sourceUrl);
    }

    function getCanonicalIssueUrl(sourceUrl) {
        const direct = normalizeCanonicalIssueUrl(sourceUrl);
        if (direct) {
            return Promise.resolve(direct);
        }

        if (issueResolutionCache.has(sourceUrl)) {
            return issueResolutionCache.get(sourceUrl);
        }

        const resolution = resolveCanonicalIssueUrl(sourceUrl).catch(error => {
            issueResolutionCache.delete(sourceUrl);
            throw error;
        });
        issueResolutionCache.set(sourceUrl, resolution);
        return resolution;
    }
    function copyCanonicalIssueUrl(value) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(value, 'text');
            return Promise.resolve();
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(value);
        }

        return Promise.reject(new Error('Clipboard API is unavailable.'));
    }

    function autoCopyCanonicalIssueUrl(value) {
        let copyPromise = automaticIssueCopies.get(value);
        if (!copyPromise) {
            copyPromise = Promise.resolve()
                .then(() => copyCanonicalIssueUrl(value))
                .catch(error => {
                    automaticIssueCopies.delete(value);
                    throw error;
                });
            automaticIssueCopies.set(value, copyPromise);
        }
        return copyPromise;
    }

    function showIssueCopiedState(button, canonicalUrl) {
        button.textContent = 'Copied!';
        setTimeout(() => {
            if (button.dataset.canonicalUrl === canonicalUrl) {
                button.textContent = 'Copy link';
            }
        }, 1200);
    }
    function createIssueCopyButton(link) {
        const button = document.createElement('a');
        button.href = '#';
        button.setAttribute('role', 'button');
        button.className = 'river-copy-issue-link';
        button.textContent = 'Copying…';
        button.setAttribute('aria-disabled', 'true');
        button.style.background = '#f2f3f3';
        button.style.border = '1px solid #aab7b8';
        button.style.borderRadius = '3px';
        button.style.color = '#111820';
        button.style.display = 'inline-block';
        button.style.lineHeight = '20px';
        button.style.marginInlineStart = '8px';
        button.style.padding = '2px 8px';
        button.style.cursor = 'pointer';
        button.style.textDecoration = 'none';
        button.style.verticalAlign = 'middle';
        button.setAttribute('aria-label', 'Copy canonical issue link');

        link.after(button);
        issueLinkButtons.set(link, button);
        return button;
    }

    async function handleIssueCopyButtonClick(event) {
        const button = event.target && event.target.closest
            ? event.target.closest('a.river-copy-issue-link')
            : null;
        if (!button) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (button.getAttribute('aria-disabled') === 'true') {
            return;
        }

        const canonicalUrl = button.dataset.canonicalUrl;
        if (!canonicalUrl) {
            const link = button.previousElementSibling;
            if (link && link.matches(ISSUE_LINK_SELECTOR)) {
                startIssueLinkResolution(link, button, true);
            }
            return;
        }

        try {
            await copyCanonicalIssueUrl(canonicalUrl);
            showIssueCopiedState(button, canonicalUrl);
        } catch {
            button.textContent = 'Copy failed';
        }
    }

    async function startIssueLinkResolution(link, button, isRetry = false) {
        const sourceUrl = link.href;
        button.dataset.sourceUrl = sourceUrl;
        delete button.dataset.canonicalUrl;
        button.href = '#';
        button.textContent = isRetry ? 'Retrying…' : 'Copying…';
        button.setAttribute('aria-disabled', 'true');
        button.title = isRetry
            ? 'Retrying background ticket resolution'
            : 'Loading ticket in the background';

        try {
            const canonicalUrl = await getCanonicalIssueUrl(sourceUrl);
            if (button.dataset.sourceUrl !== sourceUrl) {
                return;
            }

            button.dataset.canonicalUrl = canonicalUrl;
            button.href = canonicalUrl;
            button.textContent = 'Copy link';
            button.setAttribute('aria-disabled', 'false');
            button.title = canonicalUrl;

            try {
                await autoCopyCanonicalIssueUrl(canonicalUrl);
                showIssueCopiedState(button, canonicalUrl);
            } catch {
                button.textContent = 'Copy failed';
                button.title = 'Automatic copy failed; click to retry';
            }
        } catch (error) {
            if (button.dataset.sourceUrl !== sourceUrl) {
                return;
            }

            button.textContent = 'Retry link';
            button.href = sourceUrl;
            button.setAttribute('aria-disabled', 'false');
            button.title = error.message;
            console.warn(
                '[RIVER Auto Fill] Canonical issue URL resolution failed:',
                error
            );
        }
    }

    function enhanceIssueLinks() {
        const links = document.querySelectorAll(ISSUE_LINK_SELECTOR);

        for (const link of links) {
            let button = issueLinkButtons.get(link);
            if (!button || !button.isConnected) {
                button = createIssueCopyButton(link);
            }

            button.hidden = !isUsableElement(link);
            if (button.dataset.sourceUrl !== link.href) {
                startIssueLinkResolution(link, button);
            }
        }
    }
    function pauseRetryTimer(reason) {
        if (retryTimer) {
            clearInterval(retryTimer);
            retryTimer = null;
            retryIntervalMs = null;
            console.info(
                `[RIVER Auto Fill] Fast retries paused: ${reason}. ` +
                'Navigation and DOM changes are still monitored.'
            );
        }
    }

    function ensureRetryTimer(intervalMs) {
        if (retryTimer && retryIntervalMs === intervalMs) {
            return;
        }

        if (retryTimer) {
            clearInterval(retryTimer);
        }

        retryIntervalMs = intervalMs;
        retryTimer = setInterval(tryFillVisibleFields, intervalMs);
    }

    function scheduleTryFill() {
        if (scheduledFillTimer) {
            return;
        }

        scheduledFillTimer = setTimeout(() => {
            scheduledFillTimer = null;
            tryFillVisibleFields();
        }, 50);
    }

    function handleNavigation() {
        if (location.href !== currentUrl) {
            resetFillCycle('Navigation detected');
        }
        scheduleTryFill();
    }

    function patchHistoryMethod(methodName) {
        try {
            const pageHistory = PAGE_WINDOW.history || history;
            const original = pageHistory[methodName];
            if (typeof original !== 'function') {
                return;
            }

            pageHistory[methodName] = function (...args) {
                const result = original.apply(this, args);
                handleNavigation();
                return result;
            };
        } catch (error) {
            console.warn(
                `[RIVER Auto Fill] ${methodName} patch skipped:`,
                error
            );
        }
    }

    if (isTicketResolverHost()) {
        startTicketResolverTab();
        return;
    }

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');

    function startPageObserver() {
        if (observer || !document.documentElement) {
            return;
        }

        observer = new MutationObserver(scheduleTryFill);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    startPageObserver();

    window.addEventListener('click', handleIssueCopyButtonClick, true);
    window.addEventListener('keydown', allowContainerUnderscore, true);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);
    window.addEventListener('DOMContentLoaded', () => {
        startPageObserver();
        scheduleTryFill();
    }, { once: true });
    window.addEventListener('load', scheduleTryFill, { once: true });

    ensureRetryTimer(RETRY_INTERVAL_MS);
    tryFillVisibleFields();
})();
