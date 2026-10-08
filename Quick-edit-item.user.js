// ==UserScript==
// @name         Quick edit item
// @namespace    quick-edit-item
// @version      1.04
// @description  Changes FCResearch inventory items to Sellable, Defective or Pending Research.
// @description:pl Zmienia pozycje Inwentarza FCResearch na Sellable, Defective lub Pending Research.
// @author       aolenche
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Quick-edit-item.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Quick-edit-item.user.js
// @include      *://qi-fcresearch-eu.corp.amazon.com/WRO1/results?s=*
// @include      *://fcresearch-eu.aka.amazon.com/WRO1/results?s=*
// @include      *://aft-qt-eu.aka.amazon.com/app/edititems*
// @connect      aft-qt-eu.aka.amazon.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_getTabs
// @noframes
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const AFT_ORIGIN = 'https://aft-qt-eu.aka.amazon.com';
    const AFT_APP_PATH = '/app/edititems?experience=Desktop';
    const REQUEST_TIMEOUT_MS = 20000;
    const WORKFLOW_TIMEOUT_MS = 45000;
    const INVENTORY_LOAD_TIMEOUT_MS = 10000;
    const STATUS_POLL_INITIAL_MS = 150;
    const STATUS_POLL_MAX_MS = 1000;
    const CONFIRMATION_TIMEOUT_MS = 3000;
    const MODE_CHANGE_POLL_MS = 100;
    const MODE_CHANGE_POLL_MAX_MS = 500;
    const MODE_CHANGE_TIMEOUT_MS = 10000;
    const MODE_CHANGE_ATTEMPTS = 2;
    const IDS = {
        defectiveCounter: 'qei-defective-counter',
        status: 'qei-status',
        style: 'qei-style',
        sourceCapsule: 'qei-source-capsule',
        sourceSell: 'qei-source-sell',
        sourceAll: 'qei-source-all',
        modeCapsule: 'qei-mode-capsule',
        modeKazdy: 'qei-mode-kazdy',
        modeSku: 'qei-mode-sku',
        startButtonLabel: 'qei-start-button-label',
        startButtonWrapper: 'qei-start-button-wrapper',
        actionCapsule: 'qei-action-capsule',
        actionPending: 'qei-action-pending',
        actionDefective: 'qei-action-defective',
        actionSellable: 'qei-action-sellable',
        menuToggle: 'qei-menu-toggle',
        menuToggleIcon: 'qei-menu-toggle-icon',
        menuPanel: 'qei-menu-panel',
    };
    const DEFECTIVE_OPTIONS = [
        {
            value: 'UNSELLABLE',
            visibleLabel: 'Nie nadaje się do sprzedaży',
            englishLabel: 'Unsellable',
        },
        {
            value: 'DEFECTIVE',
            visibleLabel: 'Wadliwe',
            englishLabel: 'Defective',
        },
    ];
    const ACTIONS = {
        sellable: {
            workflowMode: 'Każdy',
            targetField: 'disposition',
            targetValue: 'SELLABLE',
            resultConsumer: 'UNOWNED',
            options: [
                {
                    value: 'INVENTORY',
                    visibleLabel: 'zapas',
                    englishLabel: 'Inventory',
                },
            ],
        },
        pendingResearch: {
            workflowMode: 'Każdy',
            targetField: 'consumer',
            targetValue: 'PENDING_RESEARCH',
            options: [
                {
                    value: 'PENDING_RESEARCH',
                    visibleLabel: 'Analiza w toku',
                    englishLabel: 'Pending Research',
                },
            ],
        },
        defective: {
            workflowMode: 'Każdy',
            targetField: 'disposition',
            targetValue: 'DEFECTIVE',
            resultConsumer: 'UNOWNED',
            options: DEFECTIVE_OPTIONS,
        },
        defectiveSku: {
            workflowMode: 'Sku',
            targetField: 'disposition',
            targetValue: 'DEFECTIVE',
            resultConsumer: 'UNOWNED',
            options: DEFECTIVE_OPTIONS,
        },
    };
    const UI_LANGUAGE = /^pl(?:[-_]|$)/i.test(
        readCookieValue('fcmenu-locale')
    ) ? 'pl' : 'en';
    const UI = UI_LANGUAGE === 'pl'
        ? {
            to: 'Na',
            mode: 'Tryb',
            skuPending: 'Tryb Sku nie jest dostępny dla Pending.',
            skuSellable: 'Sellable jest dostępne tylko w trybie Każdy.',
            checkingAsins: 'Sprawdzanie ASIN-ów w Inwentarzu.',
            skuSameAsin: 'Tryb Sku wymaga tego samego ASIN-u dla wszystkich pozycji Inwentarza.',
            chooseOptions: 'Wybierz wszystkie opcje przed uruchomieniem.',
            confirm: 'Potwierdź',
            changingMode: 'Zmiana trybu',
            stopping: 'Zatrzymywanie…',
            stopped: 'Zatrzymano.',
            done: 'Gotowe',
            connectingApp: 'Łączenie z aplikacją',
            stock: 'zapas',
            empty: '(PUSTY)',
            noHeading: 'brak nagłówka',
        }
        : {
            to: 'To',
            mode: 'Mode',
            skuPending: 'Sku is not available for Pending.',
            skuSellable: 'Sellable is available only in Każdy mode.',
            checkingAsins: 'Checking inventory ASINs.',
            skuSameAsin: 'Sku requires the same ASIN for all inventory items.',
            chooseOptions: 'Select all options before starting.',
            confirm: 'Confirm',
            changingMode: 'Changing mode',
            stopping: 'Stopping…',
            stopped: 'Stopped.',
            done: 'Done',
            connectingApp: 'Connecting to app',
            stock: 'inventory',
            empty: '(EMPTY)',
            noHeading: 'no heading',
        };

    let running = false;
    let stopRequested = false;
    let installTimer = null;
    let inventoryDataTablePromise = null;
    let activeWorkflowState = null;
    let stopResetPromise = null;
    let confirmationSelectionKey = '';
    let confirmationTimer = null;
    let workflowPageRequestId = 0;
    const activeRequests = new Set();
    let sourceMode = '';
    let workMode = '';
    let actionMode = '';
    let skuAvailability = 'checking';
    let skuAvailabilityRequestId = 0;
    let completionAudioContext = null;
    let preserveSkuBatchStatus = false;
    let workflowQueueTabPromise = null;
    let workflowQueueTab = null;
    let workflowQueueAcquired = false;
    let workflowQueueWake = null;

    class WorkflowError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'WorkflowError';
            this.code = options.code || 'QEI-E999';
            this.fatal = Boolean(options.fatal);
        }
    }

    class StopRequestedError extends Error {
        constructor() {
            super(uiMessage(
                'Zatrzymano przez użytkownika.',
                'Stopped by the user.'
            ));
            this.name = 'StopRequestedError';
        }
    }

    function callQueueApi(invoke) {
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new WorkflowError(
                uiMessage(
                    'Nie można odczytać kolejki kart. Spróbuj ponownie.',
                    'Could not access the tab queue. Please try again.'
                ),
                { code: 'QEI-E401', fatal: true }
            )), 10000);
            invoke((value) => {
                window.clearTimeout(timer);
                resolve(value);
            });
        });
    }

    function initializeWorkflowQueue() {
        if (!workflowQueueTabPromise) {
            workflowQueueTabPromise = callQueueApi(GM_getTab).then(async (tab) => {
                workflowQueueTab = tab;
                delete tab.qeiRun;
                await callQueueApi((done) => GM_saveTab(tab, done));
                return tab;
            });
        }
        return workflowQueueTabPromise;
    }

    async function readWorkflowQueue() {
        const tabs = await callQueueApi(GM_getTabs);
        return Object.values(tabs).map((tab) => tab.qeiRun).filter(Boolean);
    }

    async function releaseWorkflowQueue() {
        workflowQueueAcquired = false;
        if (workflowQueueTab?.qeiRun) {
            delete workflowQueueTab.qeiRun;
            await callQueueApi((done) => GM_saveTab(workflowQueueTab, done));
        }
    }

    async function acquireWorkflowQueue() {
        const tab = await initializeWorkflowQueue();
        throwIfStopRequested();
        const entry = { id: crypto.randomUUID(), ticket: 0, choosing: true };
        tab.qeiRun = entry;
        await callQueueApi((done) => GM_saveTab(tab, done));
        const queue = await readWorkflowQueue();
        entry.ticket = 1 + Math.max(0, ...queue.map((run) => run.ticket));
        entry.choosing = false;
        await callQueueApi((done) => GM_saveTab(tab, done));

        while (true) {
            throwIfStopRequested();
            const others = (await readWorkflowQueue()).filter(
                (run) => run.id !== entry.id
            );
            const ahead = others.filter((run) => run.choosing ||
                run.ticket < entry.ticket ||
                (run.ticket === entry.ticket && run.id < entry.id)
            );
            if (ahead.length === 0) {
                throwIfStopRequested();
                workflowQueueAcquired = true;
                return;
            }
            setStatus(uiMessage(
                `W kolejce (${ahead.length + 1}) — oczekiwanie na inną kartę.`,
                `Queued (${ahead.length + 1}) — waiting for another tab.`
            ));
            await new Promise((resolve) => {
                const timer = window.setTimeout(() => {
                    workflowQueueWake = null;
                    resolve();
                }, 500);
                workflowQueueWake = () => {
                    window.clearTimeout(timer);
                    workflowQueueWake = null;
                    resolve();
                };
                if (stopRequested) {
                    workflowQueueWake();
                }
            });
        }
    }

    function readCookieValue(name) {
        const prefix = `${name}=`;
        for (const part of String(document.cookie || '').split(';')) {
            const cookie = part.trim();
            if (!cookie.startsWith(prefix)) {
                continue;
            }
            const value = cookie.slice(prefix.length).replace(/^"|"$/g, '');
            try {
                return decodeURIComponent(value);
            } catch {
                return value;
            }
        }
        return '';
    }

    function uiMessage(polish, english) {
        return UI_LANGUAGE === 'pl' ? polish : english;
    }

    function isStopRequestedError(error) {
        return error instanceof StopRequestedError;
    }

    function throwIfStopRequested() {
        if (stopRequested) {
            throw new StopRequestedError();
        }
    }

    function describeError(error) {
        return {
            code: error instanceof WorkflowError
                ? error.code
                : 'QEI-E999',
            message: error instanceof Error
                ? error.message
                : String(error),
        };
    }

    function normalizeValue(value) {
        return String(value || '')
            .trim()
            .replace(/[\s-]+/g, '_')
            .toUpperCase();
    }

    function compactText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getCompletionAudioContext() {
        const AudioContextClass = window.AudioContext ||
            window.webkitAudioContext;
        if (!AudioContextClass) {
            return null;
        }
        if (
            !completionAudioContext ||
            completionAudioContext.state === 'closed'
        ) {
            completionAudioContext = new AudioContextClass();
        }
        return completionAudioContext;
    }

    function prepareCompletionSound() {
        try {
            const context = getCompletionAudioContext();
            if (context?.state === 'suspended') {
                context.resume().catch(() => {});
            }
        } catch {
            completionAudioContext = null;
        }
    }

    function playCompletionNote(
        context,
        frequency,
        offset,
        duration,
        volume,
        shimmer
    ) {
        const start = context.currentTime + 0.02 + offset;
        const end = start + duration;
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.linearRampToValueAtTime(volume, start + 0.01);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
        envelope.connect(context.destination);

        const fundamental = context.createOscillator();
        fundamental.type = 'sine';
        fundamental.frequency.setValueAtTime(frequency, start);
        fundamental.connect(envelope);
        fundamental.start(start);
        fundamental.stop(end + 0.02);

        const overtone = context.createOscillator();
        const overtoneGain = context.createGain();
        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(frequency * 2.01, start);
        overtoneGain.gain.setValueAtTime(shimmer, start);
        overtone.connect(overtoneGain);
        overtoneGain.connect(envelope);
        overtone.start(start);
        overtone.stop(end + 0.02);
    }

    function playCompletionSound() {
        try {
            const context = getCompletionAudioContext();
            if (!context) {
                return;
            }
            const play = () => {
                playCompletionNote(
                    context,
                    659.25,
                    0,
                    0.38,
                    0.12,
                    0.18
                );
                playCompletionNote(
                    context,
                    987.77,
                    0.16,
                    0.44,
                    0.1,
                    0.13
                );
            };
            if (context.state === 'suspended') {
                context.resume().then(play).catch(() => {});
            } else {
                play();
            }
        } catch {
            completionAudioContext = null;
        }
    }

    function ensureStyles() {
        if (document.getElementById(IDS.style)) {
            return;
        }

        const style = document.createElement('style');
        style.id = IDS.style;
        style.textContent = `
            .qei-toolbar {
                position: relative;
                display: inline-flex;
                align-items: center;
                box-sizing: border-box;
                height: 32px;
                max-height: 32px;
                margin-left: 14px;
                padding-left: 10px;
                overflow: hidden;
                vertical-align: top;
                white-space: nowrap;
                user-select: none;
            }
            .qei-toolbar.qei-toolbar,
            .qei-toolbar.qei-toolbar * {
                background: transparent !important;
                background-color: transparent !important;
            }
            .qei-toolbar::before {
                content: '';
                position: absolute;
                top: 4px;
                bottom: 4px;
                left: 0;
                width: 2px;
                background: currentColor;
            }
            #${IDS.menuToggle} {
                position: relative;
                z-index: 1;
                display: inline-flex;
                align-items: center;
                gap: 7px;
                flex: 0 0 auto;
                box-sizing: border-box;
                height: 30px;
                margin: 0;
                padding: 4px 12px;
                font: inherit;
                font-size: 14px;
                font-weight: 700;
                line-height: 1.3;
                color: inherit;
                border: 1px solid currentColor;
                border-radius: 4px;
                cursor: pointer;
                user-select: none;
            }
            #${IDS.menuToggle}:hover {
                opacity: 0.85;
            }
            #${IDS.menuToggle}:focus {
                outline: none;
            }
            #${IDS.menuToggle}:focus-visible {
                outline: 1px solid currentColor;
                outline-offset: -3px;
            }
            #${IDS.menuToggleIcon} {
                display: inline-block;
                width: 8px;
                text-align: center;
            }
            #${IDS.menuPanel} {
                display: inline-block;
                align-self: stretch;
                max-width: calc(100vw - 275px);
                overflow: hidden;
                opacity: 1;
                transition: max-width 220ms ease, opacity 160ms ease;
            }
            .qei-menu-content {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                height: 100%;
                min-width: max-content;
                padding-left: 10px;
                transform: translateX(0);
                transition: transform 220ms ease;
            }
            .qei-toolbar.qei-collapsed #${IDS.menuPanel} {
                max-width: 0;
                opacity: 0;
                pointer-events: none;
            }
            .qei-toolbar.qei-collapsed .qei-menu-content {
                transform: translateX(-24px);
            }
            @media (prefers-reduced-motion: reduce) {
                #${IDS.menuPanel},
                .qei-menu-content {
                    transition: none;
                }
            }
            .qei-capsule {
                display: inline-flex;
                align-items: stretch;
                border: 1px solid currentColor;
                border-radius: 4px;
                overflow: hidden;
            }
            .qei-capsule .qei-cap-btn {
                padding: 4px 12px;
                font-size: 12px;
                line-height: 1.3;
                cursor: pointer;
                user-select: none;
                color: inherit;
                border: none;
                border-right: 1px solid currentColor;
                border-radius: 0;
                opacity: 0.75;
            }
            .qei-capsule .qei-cap-btn:last-child {
                border-right: none;
            }
            .qei-capsule .qei-cap-btn.qei-active {
                font-weight: 700;
                opacity: 1;
                box-shadow: inset 0 0 0 1px currentColor;
            }
            .qei-capsule .qei-cap-btn:hover:not(.qei-active):not(.qei-disabled) {
                opacity: 1;
            }
            .qei-capsule .qei-cap-btn.qei-disabled {
                cursor: not-allowed;
                opacity: 0.3;
            }
            .qei-label {
                font-size: 12px;
                color: inherit;
                font-weight: 700;
                white-space: nowrap;
            }
            .qei-sep {
                display: inline-block;
                width: 1px;
                height: 18px;
                background: currentColor !important;
                background-color: currentColor !important;
                opacity: 0.35;
                vertical-align: middle;
            }
            #${IDS.defectiveCounter} {
                font-size: 12px;
                color: inherit;
                margin: 0;
                min-width: 40px;
                text-align: center;
                display: inline-block;
            }
            #${IDS.startButtonWrapper} {
                display: inline-flex;
                align-items: center;
                padding: 4px 14px;
                font-size: 12px;
                font-weight: 700;
                line-height: 1.3;
                border-radius: 4px;
                border: 1px solid currentColor;
                color: inherit;
                cursor: pointer;
                user-select: none;
            }
            #${IDS.startButtonWrapper}:hover {
                opacity: 0.85;
            }
            #${IDS.startButtonWrapper}.qei-stop {
                opacity: 0.85;
            }
            #${IDS.startButtonWrapper}.qei-confirm {
                box-shadow: inset 0 0 0 1px currentColor;
            }
            #${IDS.status} {
                display: inline-block;
                max-width: 400px;
                font-size: 11px;
                color: inherit;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                vertical-align: middle;
            }
        `;
        document.head.appendChild(style);
    }

    function findInventorySection() {
        return document.querySelector('[data-section-type="inventory"]');
    }

    function findInventoryTitle(section) {
        if (!section) {
            return null;
        }

        return Array.from(section.querySelectorAll('.section-title')).find(
            (element) => ['INWENTARZ', 'INVENTORY'].includes(
                normalizeValue(element.textContent)
            )
        ) || null;
    }

    function readStoredMode(key, allowedValues) {
        const value = GM_getValue(key, '');
        return allowedValues.includes(value) ? value : '';
    }

    function applyWorkMode(mode, persist = true) {
        workMode = mode;
        const kazdy = document.getElementById(IDS.modeKazdy);
        const sku = document.getElementById(IDS.modeSku);
        if (kazdy && sku) {
            kazdy.classList.toggle('qei-active', mode === 'kazdy');
            sku.classList.toggle('qei-active', mode === 'sku');
        }
        if (persist) {
            GM_setValue('qei_workMode', mode);
        }
    }

    function isSkuBlocked() {
        return actionMode === 'pending' || actionMode === 'sellable' ||
            skuAvailability !== 'available';
    }

    function updateSkuControlState() {
        const sku = document.getElementById(IDS.modeSku);
        if (!sku) {
            return;
        }
        const blocked = isSkuBlocked();
        sku.classList.toggle('qei-disabled', blocked);
        sku.setAttribute('aria-disabled', String(blocked));
        sku.title = actionMode === 'pending'
            ? UI.skuPending
            : actionMode === 'sellable'
                ? UI.skuSellable
            : skuAvailability === 'checking'
                ? UI.checkingAsins
                : blocked
                    ? UI.skuSameAsin
                    : '';
    }

    function inventoryHasSingleAsin(entries) {
        if (entries.length === 0) {
            return false;
        }
        const asins = entries.map((entry) =>
            normalizeValue(entry.asin)
        );
        return Boolean(asins[0]) && asins.every((asin) => asin === asins[0]);
    }

    function isConsumerAvailableForWorkMode(consumer, selectedWorkMode) {
        return selectedWorkMode !== 'sku' ||
            normalizeValue(consumer) !== 'REVERSE_LOGISTICS';
    }

    async function refreshSkuAvailability(restoreSavedSku = false) {
        const requestId = ++skuAvailabilityRequestId;
        const previousWorkMode = workMode;
        skuAvailability = 'checking';
        updateSkuControlState();

        let available = false;
        let singleItem = false;
        try {
            const entries = await readInventoryEntries();
            const expectedTotal = readInventoryTotal();
            singleItem = expectedTotal === 1 && entries.length === 1;
            available = expectedTotal > 0 &&
                entries.length === expectedTotal &&
                inventoryHasSingleAsin(entries);
        } catch {
            available = false;
        }

        if (requestId !== skuAvailabilityRequestId) {
            return false;
        }

        if (singleItem && !running && sourceMode !== 'all') {
            setSourceMode('all');
        }
        skuAvailability = available ? 'available' : 'unavailable';
        if (!available || actionMode === 'pending' || actionMode === 'sellable') {
            applyWorkMode('kazdy');
        } else if (restoreSavedSku && !workMode) {
            applyWorkMode('sku');
        }
        updateSkuControlState();
        if (workMode !== previousWorkMode) {
            refreshInitialCounters();
        }
        return available && actionMode !== 'pending' && actionMode !== 'sellable';
    }

    function setEditMenuExpanded(expanded) {
        const toolbar = document.querySelector('.qei-toolbar');
        const toggle = document.getElementById(IDS.menuToggle);
        const icon = document.getElementById(IDS.menuToggleIcon);
        const panel = document.getElementById(IDS.menuPanel);
        if (!toolbar || !toggle || !icon || !panel) {
            return;
        }
        toolbar.classList.toggle('qei-collapsed', !expanded);
        toggle.setAttribute('aria-expanded', String(expanded));
        panel.setAttribute('aria-hidden', String(!expanded));
        icon.textContent = expanded ? '‹' : '›';
    }

    function toggleEditMenu() {
        const toolbar = document.querySelector('.qei-toolbar');
        if (!toolbar) {
            return;
        }
        const expanded = !toolbar.classList.contains('qei-collapsed');
        const next = running || !expanded;
        setEditMenuExpanded(next);
        GM_setValue('qei_menuExpanded', next);
    }

    function ensureControls() {
        ensureStyles();

        const section = findInventorySection();
        const title = findInventoryTitle(section);
        if (!title || document.getElementById(IDS.startButtonWrapper)) {
            return;
        }

        const helpIcon = title.nextElementSibling;
        const insertAfter = (helpIcon && helpIcon.classList.contains('help'))
            ? helpIcon
            : title;

        const toolbar = document.createElement('span');
        toolbar.className = 'qei-toolbar';

        const menuToggle = document.createElement('button');
        menuToggle.id = IDS.menuToggle;
        menuToggle.type = 'button';
        menuToggle.setAttribute('aria-controls', IDS.menuPanel);
        menuToggle.setAttribute('aria-expanded', 'true');
        menuToggle.addEventListener('click', toggleEditMenu);
        const menuToggleLabel = document.createElement('span');
        menuToggleLabel.textContent = 'Quick edit item';
        const menuToggleIcon = document.createElement('span');
        menuToggleIcon.id = IDS.menuToggleIcon;
        menuToggleIcon.setAttribute('aria-hidden', 'true');
        menuToggleIcon.textContent = '‹';
        menuToggle.append(menuToggleLabel, menuToggleIcon);

        const menuPanel = document.createElement('span');
        menuPanel.id = IDS.menuPanel;
        const menuContent = document.createElement('span');
        menuContent.className = 'qei-menu-content';

        const actionCapsule = document.createElement('span');
        actionCapsule.id = IDS.actionCapsule;
        actionCapsule.className = 'qei-capsule';
        const actPending = document.createElement('span');
        actPending.id = IDS.actionPending;
        actPending.className = 'qei-cap-btn';
        actPending.textContent = 'Pending';
        actPending.addEventListener('click', () => setActionMode('pending'));
        const actDefective = document.createElement('span');
        actDefective.id = IDS.actionDefective;
        actDefective.className = 'qei-cap-btn';
        actDefective.textContent = 'Defective';
        actDefective.addEventListener('click', () => setActionMode('defective'));
        const actSellable = document.createElement('span');
        actSellable.id = IDS.actionSellable;
        actSellable.className = 'qei-cap-btn';
        actSellable.textContent = 'Sellable';
        actSellable.addEventListener('click', () => setActionMode('sellable'));
        actionCapsule.append(actSellable, actDefective, actPending);

        const sourceCapsule = document.createElement('span');
        sourceCapsule.id = IDS.sourceCapsule;
        sourceCapsule.className = 'qei-capsule';
        const srcSell = document.createElement('span');
        srcSell.id = IDS.sourceSell;
        srcSell.className = 'qei-cap-btn';
        srcSell.textContent = 'Sell';
        srcSell.addEventListener('click', () => setSourceMode('sell'));
        const srcAll = document.createElement('span');
        srcAll.id = IDS.sourceAll;
        srcAll.className = 'qei-cap-btn';
        srcAll.textContent = 'All';
        srcAll.addEventListener('click', () => setSourceMode('all'));
        sourceCapsule.append(srcAll, srcSell);

        const counter = document.createElement('span');
        counter.id = IDS.defectiveCounter;
        counter.className = 'a-size-small';
        counter.textContent = '…';

        const sep1 = document.createElement('span');
        sep1.className = 'qei-sep';

        const sep2 = document.createElement('span');
        sep2.className = 'qei-sep';

        const modeLabel = document.createElement('span');
        modeLabel.className = 'qei-label';
        modeLabel.textContent = UI.mode;

        const modeCapsule = document.createElement('span');
        modeCapsule.id = IDS.modeCapsule;
        modeCapsule.className = 'qei-capsule';
        const modeKazdy = document.createElement('span');
        modeKazdy.id = IDS.modeKazdy;
        modeKazdy.className = 'qei-cap-btn';
        modeKazdy.textContent = 'Każdy';
        modeKazdy.addEventListener('click', () => setWorkMode('kazdy'));
        const modeSku = document.createElement('span');
        modeSku.id = IDS.modeSku;
        modeSku.className = 'qei-cap-btn';
        modeSku.textContent = 'Sku';
        modeSku.addEventListener('click', () => setWorkMode('sku'));
        modeCapsule.append(modeKazdy, modeSku);

        const startBtn = document.createElement('span');
        startBtn.id = IDS.startButtonWrapper;
        startBtn.addEventListener('click', handleStartButtonClick);
        const startLabel = document.createElement('span');
        startLabel.id = IDS.startButtonLabel;
        startLabel.textContent = '▶ Start';
        startBtn.appendChild(startLabel);

        const status = document.createElement('span');
        status.id = IDS.status;
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        const toLabel = document.createElement('span');
        toLabel.className = 'qei-label';
        toLabel.textContent = UI.to;

        menuContent.append(
            sourceCapsule,
            sep1,
            toLabel, actionCapsule,
            sep2,
            modeLabel, modeCapsule,
            counter, startBtn, status
        );
        menuPanel.appendChild(menuContent);
        toolbar.append(menuToggle, menuPanel);

        insertAfter.insertAdjacentElement('afterend', toolbar);
        setEditMenuExpanded(GM_getValue('qei_menuExpanded', false));

        const savedSource = readStoredMode(
            'qei_sourceMode',
            ['sell', 'all']
        );
        const savedAction = readStoredMode(
            'qei_actionMode',
            ['pending', 'defective', 'sellable']
        );
        const savedWork = readStoredMode(
            'qei_workMode',
            ['kazdy', 'sku']
        );
        if (savedSource) {
            setSourceMode(savedSource);
        }
        if (savedAction) {
            setActionMode(savedAction);
        }
        if (savedWork === 'kazdy') {
            setWorkMode(savedWork);
        }
        if (!sourceMode || !actionMode) {
            refreshInitialCounters();
        }
        refreshSkuAvailability(
            savedWork === 'sku' && savedAction === 'defective'
        );
    }

    function scheduleControlsInstall() {
        window.clearTimeout(installTimer);
        installTimer = window.setTimeout(ensureControls, 50);
    }

    function setSourceMode(mode) {
        if (running) {
            return;
        }
        clearActionConfirmation();
        setStatus('');
        sourceMode = mode;
        const sellBtn = document.getElementById(IDS.sourceSell);
        const allBtn = document.getElementById(IDS.sourceAll);
        if (sellBtn && allBtn) {
            sellBtn.classList.toggle('qei-active', mode === 'sell');
            allBtn.classList.toggle('qei-active', mode === 'all');
        }
        GM_setValue('qei_sourceMode', mode);
        refreshInitialCounters();
    }

    function setWorkMode(mode) {
        if (running) {
            return;
        }
        if (mode === 'sku' && isSkuBlocked()) {
            setStatus(
                actionMode === 'pending'
                    ? UI.skuPending
                    : actionMode === 'sellable'
                        ? UI.skuSellable
                    : skuAvailability === 'checking'
                        ? UI.checkingAsins
                        : UI.skuSameAsin
            );
            return;
        }
        clearActionConfirmation();
        setStatus('');
        applyWorkMode(mode);
        refreshInitialCounters();
    }

    function setActionMode(mode) {
        if (running) {
            return;
        }
        clearActionConfirmation();
        setStatus('');
        actionMode = mode;
        const pending = document.getElementById(IDS.actionPending);
        const defective = document.getElementById(IDS.actionDefective);
        const sellable = document.getElementById(IDS.actionSellable);
        if (sellable) {
            sellable.classList.toggle('qei-active', mode === 'sellable');
        }
        if (pending && defective) {
            pending.classList.toggle('qei-active', mode === 'pending');
            defective.classList.toggle('qei-active', mode === 'defective');
        }
        GM_setValue('qei_actionMode', mode);
        if (mode === 'pending' || mode === 'sellable') {
            applyWorkMode('kazdy');
        }
        updateSkuControlState();
        refreshInitialCounters();
    }

    function handleStartButtonClick() {
        if (running) {
            requestStop();
            return;
        }

        if (!actionMode || !sourceMode || !workMode) {
            setStatus(UI.chooseOptions);
            return;
        }

        let actionKey;
        if (actionMode === 'pending') {
            actionKey = 'pendingResearch';
        } else if (actionMode === 'sellable') {
            actionKey = 'sellable';
        } else {
            actionKey = workMode === 'sku' ? 'defectiveSku' : 'defective';
        }

        const selectionKey = `${sourceMode}\u0000${actionKey}\u0000${workMode}`;
        if (confirmationSelectionKey !== selectionKey) {
            requestActionConfirmation(selectionKey);
            updateStartButtonLabel();
            return;
        }

        window.clearTimeout(confirmationTimer);
        confirmationSelectionKey = '';
        confirmationTimer = null;
        prepareCompletionSound();
        runAll(actionKey, sourceMode);
    }

    function updateStartButtonLabel() {
        const label = document.getElementById(IDS.startButtonLabel);
        const wrapper = document.getElementById(IDS.startButtonWrapper);
        if (!label || !wrapper) {
            return;
        }
        wrapper.classList.remove('qei-stop', 'qei-confirm');
        if (running) {
            if (stopRequested) {
                label.textContent = UI.stopping;
            } else {
                label.innerHTML = '<span style="vertical-align:1px">■</span> Stop';
            }
            wrapper.classList.add('qei-stop');
        } else if (confirmationSelectionKey) {
            label.textContent = UI.confirm;
            wrapper.classList.add('qei-confirm');
        } else {
            label.textContent = '▶ Start';
        }
    }

    function readInventoryTotal() {
        const info = document.getElementById('table-inventory_info');
        const match = compactText(info?.textContent).match(
            /\bof\s+([\d\s.,]+)\s+entries\b/i
        );
        return match
            ? Number(match[1].replace(/\D/g, '')) || 0
            : 0;
    }

    async function getInventoryDataTable() {
        if (inventoryDataTablePromise) {
            return inventoryDataTablePromise;
        }

        inventoryDataTablePromise = new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) {
                    return;
                }
                settled = true;
                window.clearTimeout(timeout);
                resolve(value);
            };
            const timeout = window.setTimeout(
                () => finish(null),
                INVENTORY_LOAD_TIMEOUT_MS / 2
            );

            try {
                const page = typeof unsafeWindow === 'undefined'
                    ? null
                    : unsafeWindow;
                const modules = page?.P || page?.AmazonUIPageJS;
                if (!modules?.when) {
                    finish(null);
                    return;
                }

                modules.when('A', 'ready', 'dataTables').execute(
                    'qei-inventory-data-table',
                    (A) => {
                        try {
                            const dataTable = A.$(
                                '#table-inventory'
                            ).dataTable();
                            finish(
                                typeof dataTable?.fnSettings === 'function'
                                    ? dataTable
                                    : null
                            );
                        } catch {
                            finish(null);
                        }
                    }
                );
            } catch {
                finish(null);
            }
        });

        const currentPromise = inventoryDataTablePromise;
        const dataTable = await currentPromise;
        if (!dataTable && inventoryDataTablePromise === currentPromise) {
            inventoryDataTablePromise = null;
        }
        return dataTable;
    }

    function readDataTableRows(dataTable) {
        if (!dataTable) {
            return [];
        }

        try {
            const settings = dataTable.fnSettings();
            const indexes = Array.from(
                settings.aiDisplay || settings.aiDisplayMaster || []
            );
            return indexes.map((index) =>
                settings.aoData?.[index]?.nTr ||
                (typeof dataTable.fnGetNodes === 'function'
                    ? dataTable.fnGetNodes(index)
                    : null)
            ).filter((row) =>
                row?.nodeType === 1 && row.tagName === 'TR'
            );
        } catch {
            return [];
        }
    }

    async function getAllInventoryRows() {
        const deadline = Date.now() + INVENTORY_LOAD_TIMEOUT_MS;
        let dataTable = await getInventoryDataTable();

        while (Date.now() < deadline) {
            throwIfStopRequested();
            if (!dataTable) {
                dataTable = await getInventoryDataTable();
            }
            const expectedTotal = readInventoryTotal();
            const rows = readDataTableRows(dataTable);
            if (expectedTotal > 0 && rows.length === expectedTotal) {
                return rows;
            }

            const table = findInventorySection()?.querySelector(
                '#table-inventory'
            );
            const visibleRows = table
                ? Array.from(table.querySelectorAll('tbody > tr'))
                : [];
            if (
                expectedTotal > 0 &&
                visibleRows.length === expectedTotal
            ) {
                return visibleRows;
            }

            if (
                expectedTotal === 0 &&
                document.getElementById('table-inventory_info')?.textContent
                    .includes('Showing 0 to 0 of 0 entries')
            ) {
                return [];
            }

            await new Promise((resolve) =>
                window.setTimeout(resolve, 100)
            );
        }

        const expectedTotal = readInventoryTotal();
        const loadedTotal = readDataTableRows(dataTable).length;
        throw new WorkflowError(
            uiMessage(
                `Nie udało się wczytać całego Inwentarza (${loadedTotal}/${expectedTotal || '?'}).`,
                `Could not load the full Inventory (${loadedTotal}/${expectedTotal || '?'}).`
            ),
            { code: 'QEI-E003', fatal: true }
        );
    }

    async function refreshInitialCounters() {
        const selectedActionMode = actionMode;
        const selectedSourceMode = sourceMode;
        const selectedWorkMode = workMode;
        const counter = document.getElementById(IDS.defectiveCounter);
        if (!counter) {
            return;
        }
        if (!selectedActionMode || !selectedSourceMode) {
            counter.textContent = '';
            return;
        }

        try {
            const selectedActionKey = selectedActionMode === 'pending'
                ? 'pendingResearch'
                : selectedActionMode === 'sellable'
                    ? 'sellable'
                    : 'defective';
            const items = await collectItemsToChange(
                selectedActionKey,
                selectedSourceMode,
                selectedWorkMode
            );

            if (
                running ||
                selectedActionMode !== actionMode ||
                selectedSourceMode !== sourceMode ||
                selectedWorkMode !== workMode
            ) {
                return;
            }

            counter.textContent = String(items.length);
        } catch (error) {
            if (running) {
                return;
            }
            counter.textContent = '?';
        }
    }

    function setStatus(message, state = '') {
        if (preserveSkuBatchStatus && message === UI.changingMode) {
            return;
        }

        const status = document.getElementById(IDS.status);
        if (!status) {
            return;
        }

        status.textContent = message;
        status.dataset.state = state;
        status.title = '';
        if (state === 'success' && message === UI.done) {
            playCompletionSound();
        }
    }

    function setButtonsState() {
        if (running) {
            setEditMenuExpanded(true);
        }
        updateStartButtonLabel();
    }

    function clearActionConfirmation() {
        window.clearTimeout(confirmationTimer);
        confirmationSelectionKey = '';
        confirmationTimer = null;
        updateStartButtonLabel();
    }

    function requestActionConfirmation(selectionKey) {
        window.clearTimeout(confirmationTimer);
        confirmationSelectionKey = selectionKey;
        updateStartButtonLabel();
        confirmationTimer = window.setTimeout(() => {
            confirmationSelectionKey = '';
            confirmationTimer = null;
            updateStartButtonLabel();
        }, CONFIRMATION_TIMEOUT_MS);
    }

    function requestStop() {
        if (!running || stopRequested) {
            return;
        }

        stopRequested = true;
        setButtonsState();
        if (!workflowQueueAcquired) {
            workflowQueueWake?.();
            setStatus(UI.stopped);
            return;
        }
        setStatus(UI.stopping);
        for (const request of Array.from(activeRequests)) {
            try {
                request.abort();
            } catch {
                continue;
            }
        }
        stopResetPromise = resetActiveWorkflowImmediately().then(
            () => null,
            (error) => error
        );
    }

    function setPendingProgress(done, total) {
        const counter = document.getElementById(IDS.defectiveCounter);
        if (counter) {
            counter.textContent = total > 0 ? `${done}/${total}` : '';
        }
    }

    function readLinkedCellValue(cell) {
        if (!cell) {
            return '';
        }

        const link = cell.querySelector('a[href*="/results?s="]');
        return compactText(link ? link.textContent : cell.textContent);
    }

    function readLpnCellValue(cell) {
        const match = compactText(cell?.textContent).match(
            /\bLPN[A-Z0-9]+\b/i
        );
        return match ? match[0] : '';
    }

    function getColumnIndexes(table) {
        const headers = Array.from(table.querySelectorAll('thead th'));
        const indexes = {};

        for (const [name, id] of Object.entries({
            container: 'inventory-container',
            asin: 'inventory-asin',
            fnSku: 'inventory-fnSku',
            lpn: 'inventory-lpn',
            disposition: 'inventory-disposition',
            consumer: 'inventory-consumer',
        })) {
            indexes[name] = headers.findIndex((header) => header.id === id);
        }

        if (Object.values(indexes).some((index) => index < 0)) {
            throw new WorkflowError(
                uiMessage(
                    'Nie znaleziono wymaganych kolumn Inwentarza. Odśwież FCResearch.',
                    'Required Inventory columns were not found. Refresh FCResearch.'
                ),
                { code: 'QEI-E002', fatal: true }
            );
        }

        return indexes;
    }

    async function readInventoryEntries() {
        const section = findInventorySection();
        const table = section && section.querySelector('#table-inventory');
        if (!table) {
            throw new WorkflowError(
                uiMessage(
                    'Tabela Inwentarza nie została jeszcze załadowana.',
                    'The Inventory table has not loaded yet.'
                ),
                { code: 'QEI-E001', fatal: true }
            );
        }

        const indexes = getColumnIndexes(table);
        const rows = await getAllInventoryRows();
        const entries = [];
        let rowNumber = 0;

        for (const row of rows) {
            throwIfStopRequested();
            rowNumber += 1;
            const cells = Array.from(row.children).filter(
                (element) => element.tagName === 'TD'
            );
            if (cells.length <= Math.max(...Object.values(indexes))) {
                continue;
            }

            const container = readLinkedCellValue(cells[indexes.container]);
            const asin = readLinkedCellValue(cells[indexes.asin]);
            const lpn = readLpnCellValue(cells[indexes.lpn]);
            const fnSku = readLinkedCellValue(cells[indexes.fnSku]);
            const consumerText = readLinkedCellValue(
                cells[indexes.consumer]
            );
            const dispositionText = readLinkedCellValue(
                cells[indexes.disposition]
            );
            const consumer = normalizeValue(consumerText);
            const disposition = normalizeValue(dispositionText);

            entries.push({
                rowNumber,
                container,
                asin,
                lpn,
                fnSku,
                consumer,
                disposition,
                consumerText,
                dispositionText,
                consumerCell: cells[indexes.consumer],
                dispositionCell: cells[indexes.disposition],
            });
        }

        return entries;
    }

    async function collectItemsToChange(
        actionKey,
        selectedSourceMode,
        selectedWorkMode = 'kazdy'
    ) {
        const action = ACTIONS[actionKey];
        const uniqueItems = new Map();
        const entries = await readInventoryEntries();

        for (const entry of entries) {
            const {
                rowNumber,
                container,
                lpn,
                fnSku,
                consumer,
                disposition,
                consumerText,
                dispositionText,
                consumerCell,
                dispositionCell,
            } = entry;
            const identifier = lpn || fnSku;
            const matchesSource = selectedSourceMode === 'all' ||
                disposition === 'SELLABLE';
            const matchesConsumer = isConsumerAvailableForWorkMode(
                consumer,
                selectedWorkMode
            );
            const currentTargetValue = action.targetField === 'consumer'
                ? consumer
                : disposition;
            const needsChange = matchesSource && matchesConsumer &&
                currentTargetValue !== action.targetValue;

            if (!container || !identifier || !needsChange) {
                continue;
            }

            const key = lpn
                ? `${container}\u0000LPN\u0000${lpn}`
                : `${container}\u0000FNSKU\u0000${fnSku}\u0000${rowNumber}`;
            if (!uniqueItems.has(key)) {
                uniqueItems.set(key, {
                    container,
                    identifier,
                    identifierType: lpn ? 'LPN' : 'FNSku',
                    lpn,
                    fnSku,
                    previousTargetText: action.targetField === 'consumer'
                        ? consumerText || UI.empty
                        : dispositionText || UI.empty,
                    previousConsumerText: consumerText,
                    previousDispositionText: dispositionText,
                    consumerCell,
                    dispositionCell,
                });
            }
        }

        return Array.from(uniqueItems.values());
    }

    async function collectFnSkusToChange(selectedSourceMode) {
        const groups = new Map();
        const entries = await readInventoryEntries();

        for (const entry of entries) {
            if (!entry.fnSku) {
                continue;
            }
            if (entry.disposition === ACTIONS.defectiveSku.targetValue) {
                continue;
            }
            if (!isConsumerAvailableForWorkMode(entry.consumer, 'sku')) {
                continue;
            }
            if (
                selectedSourceMode !== 'all' &&
                entry.disposition !== 'SELLABLE'
            ) {
                continue;
            }

            const key = normalizeValue(entry.fnSku);
            if (!groups.has(key)) {
                groups.set(key, {
                    identifier: entry.fnSku,
                    identifierType: 'FNSku',
                    rows: [],
                });
            }
            groups.get(key).rows.push(entry);
        }

        return Array.from(groups.values());
    }

    function gmRequest({ method, path, body, allowDuringStop = false }) {
        return new Promise((resolve, reject) => {
            if (stopRequested && !allowDuringStop) {
                reject(new StopRequestedError());
                return;
            }

            let settled = false;
            let request = null;
            const finish = (callback, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (request) {
                    activeRequests.delete(request);
                }
                callback(value);
            };

            request = GM_xmlhttpRequest({
                method,
                url: `${AFT_ORIGIN}${path}`,
                data: body === undefined ? undefined : JSON.stringify(body),
                headers: body === undefined
                    ? {
                        Accept: 'text/html,application/json',
                        'Cache-Control': 'no-cache',
                        Pragma: 'no-cache',
                    }
                    : {
                        Accept: 'application/json',
                        'Content-Type': 'application/json; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                timeout: REQUEST_TIMEOUT_MS,
                anonymous: false,
                onload(response) {
                    if (response.status === 401 || response.status === 403) {
                        finish(reject, new WorkflowError(
                            uiMessage(
                                'Sesja EditItemsApp wygasła lub nie ma dostępu.',
                                'The EditItemsApp session has expired or access is unavailable.'
                            ),
                            { code: 'QEI-E101', fatal: true }
                        ));
                        return;
                    }

                    if (response.status < 200 || response.status >= 300) {
                        finish(reject, new WorkflowError(
                            uiMessage(
                                `EditItemsApp zwrócił HTTP ${response.status}.`,
                                `EditItemsApp returned HTTP ${response.status}.`
                            ),
                            { code: 'QEI-E102' }
                        ));
                        return;
                    }

                    finish(resolve, response.responseText || '');
                },
                ontimeout() {
                    finish(reject, new WorkflowError(
                        uiMessage(
                            'EditItemsApp nie odpowiedział na czas.',
                            'EditItemsApp did not respond in time.'
                        ),
                        { code: 'QEI-E103' }
                    ));
                },
                onerror() {
                    finish(reject, new WorkflowError(
                        uiMessage(
                            'Nie udało się połączyć z EditItemsApp.',
                            'Could not connect to EditItemsApp.'
                        ),
                        { code: 'QEI-E104', fatal: true }
                    ));
                },
                onabort() {
                    finish(
                        reject,
                        stopRequested
                            ? new StopRequestedError()
                            : new WorkflowError(
                                uiMessage(
                                    'Przerwano połączenie z EditItemsApp.',
                                    'The connection to EditItemsApp was interrupted.'
                                ),
                                { code: 'QEI-E104' }
                            )
                    );
                },
            });
            if (request && !settled) {
                activeRequests.add(request);
            }
        });
    }

    function parseJsonResponse(text, operation, options = {}) {
        if (options.allowEmpty && !String(text).trim()) {
            return {};
        }

        let response;
        try {
            response = JSON.parse(text);
        } catch {
            throw new WorkflowError(
                uiMessage(
                    `Nieprawidłowa odpowiedź EditItemsApp (${operation}).`,
                    `Invalid EditItemsApp response (${operation}).`
                ),
                { code: 'QEI-E105', fatal: true }
            );
        }

        if (response && response.error) {
            const error = typeof response.error === 'string'
                ? response.error
                : JSON.stringify(response.error);
            throw new WorkflowError(
                `EditItemsApp: ${error} (${operation}).`,
                { code: 'QEI-E106' }
            );
        }

        return response || {};
    }

    function parseWorkflowPage(html) {
        const documentFromAft = new DOMParser().parseFromString(
            html,
            'text/html'
        );
        let state = null;

        for (const element of documentFromAft.querySelectorAll(
            'script[type="a-state"][data-a-state]'
        )) {
            try {
                const descriptor = JSON.parse(
                    element.getAttribute('data-a-state')
                );
                if (descriptor && descriptor.key === 'id') {
                    state = JSON.parse(element.textContent);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!state || !state.instructionId || !state.objectId) {
            throw new WorkflowError(
                uiMessage(
                    'Nie znaleziono aktywnej sesji EditItemsApp. Otwórz EditItemsApp i zaloguj się.',
                    'No active EditItemsApp session was found. Open EditItemsApp and sign in.'
                ),
                { code: 'QEI-E107', fatal: true }
            );
        }

        return {
            document: documentFromAft,
            state,
            heading: compactText(
                documentFromAft.querySelector('#workflow h1')?.textContent
            ),
        };
    }

    async function loadWorkflowPage(options = {}) {
        workflowPageRequestId += 1;
        const html = await gmRequest({
            method: 'GET',
            path: `${AFT_APP_PATH}&_qei=${Date.now()}-${workflowPageRequestId}`,
            allowDuringStop: Boolean(options.allowDuringStop),
        });
        const page = parseWorkflowPage(html);
        activeWorkflowState = page.state;
        return page;
    }

    async function postJson(path, body, operation, options = {}) {
        const text = await gmRequest({
            method: 'POST',
            path,
            body,
            allowDuringStop: Boolean(options.allowDuringStop),
        });
        return parseJsonResponse(text, operation, options);
    }

    async function waitForReady(state) {
        const deadline = Date.now() + WORKFLOW_TIMEOUT_MS;
        let delay = STATUS_POLL_INITIAL_MS;

        while (Date.now() < deadline) {
            const response = await postJson(
                '/status',
                {
                    id: {
                        instructionId: state.instructionId,
                        objectId: state.objectId,
                    },
                },
                'status'
            );
            const status = normalizeValue(response.status);

            if (status && status !== 'PROCESSING') {
                if (status === 'READY' || status === 'COMPLETE') {
                    return;
                }
                throw new WorkflowError(
                    uiMessage(
                        `Nieoczekiwany status EditItemsApp: ${status}.`,
                        `Unexpected EditItemsApp status: ${status}.`
                    ),
                    { code: 'QEI-E108' }
                );
            }

            await new Promise((resolve) =>
                window.setTimeout(resolve, delay)
            );
            delay = Math.min(
                Math.round(delay * 1.3),
                STATUS_POLL_MAX_MS
            );
        }

        throw new WorkflowError(
            uiMessage(
                'EditItemsApp zbyt długo przetwarza żądanie.',
                'EditItemsApp took too long to process the request.'
            ),
            { code: 'QEI-E109' }
        );
    }

    async function sendAction(state, action, input) {
        activeWorkflowState = state;
        await postJson(
            '/action',
            {
                id: {
                    instructionId: state.instructionId,
                    objectId: state.objectId,
                },
                action,
                input,
            },
            action,
            { allowEmpty: true }
        );
        await waitForReady(state);
    }

    async function endWorkflow(state, options = {}) {
        if (!state) {
            return;
        }

        await postJson(
            '/end',
            {
                id: {
                    instructionId: state.instructionId,
                    objectId: state.objectId,
                },
                tool: state.tool || 'edititems',
            },
            'end',
            {
                allowEmpty: true,
                allowDuringStop: Boolean(options.allowDuringStop),
            }
        );
        if (activeWorkflowState?.objectId === state.objectId) {
            activeWorkflowState = null;
        }
    }

    function isContainerStep(page) {
        const heading = normalizeValue(page.heading);
        return heading.includes('ZESKANUJ_POJEMNIK') ||
            heading.includes('SCAN_CONTAINER');
    }

    function isProductStep(page) {
        const heading = normalizeValue(page.heading);
        return heading.includes('ZESKANUJ_PRODUKT') ||
            heading.includes('SCAN_PRODUCT');
    }

    function isSkuInputStep(page) {
        const heading = normalizeValue(page.heading);
        return heading.includes('WPROWADŹ_FNSKU_LUB_FCSKU') ||
            heading.includes('ENTER_FNSKU_OR_FCSKU');
    }

    function isSkuSourceStep(page) {
        return Boolean(page.document.querySelector(
            'input[type="radio"][name="options"][value="INVENTORY"]'
        ));
    }

    function isModeSelectionStep(page) {
        const options = page.document.querySelectorAll(
            'input[type="radio"][name="options"]'
        );
        const values = new Set(Array.from(options).map((option) =>
            normalizeValue(option.value)
        ));
        return values.has('EACH') && values.has('SKU');
    }

    function readCurrentMode(page) {
        const context = page.document.querySelector('#context');
        if (!context) {
            return '';
        }

        for (const label of context.querySelectorAll('dt')) {
            const name = normalizeValue(label.textContent).replace(/:$/, '');
            if (name === 'TRYB' || name === 'MODE') {
                return compactText(label.nextElementSibling?.textContent);
            }
        }

        return '';
    }

    function hasWorkflowMode(page, mode) {
        const current = normalizeValue(readCurrentMode(page));
        return normalizeValue(mode) === 'SKU'
            ? current === 'SKU'
            : current === 'KAŻDY' || current === 'EACH';
    }

    function isExpectedModeStart(page, mode) {
        return normalizeValue(mode) === 'SKU'
            ? isSkuInputStep(page)
            : isContainerStep(page);
    }

    function isLoadingStep(page) {
        return normalizeValue(page.heading) === 'LOADING';
    }

    function isSameWorkflowState(first, second) {
        return Boolean(
            first &&
            second &&
            first.instructionId === second.instructionId &&
            first.objectId === second.objectId
        );
    }

    async function waitForFreshWorkflowPage(previousState) {
        const deadline = Date.now() + MODE_CHANGE_TIMEOUT_MS;
        let delay = MODE_CHANGE_POLL_MS;

        while (Date.now() < deadline) {
            throwIfStopRequested();
            const page = await loadWorkflowPage();
            if (normalizeValue(page.state.status) === 'PROCESSING') {
                setStatus(UI.changingMode);
                await waitForReady(page.state);
                continue;
            }
            if (
                !isLoadingStep(page) &&
                (
                    !isSameWorkflowState(page.state, previousState) ||
                    isModeSelectionStep(page) ||
                    isContainerStep(page) ||
                    isSkuInputStep(page)
                )
            ) {
                return page;
            }

            setStatus(UI.changingMode);
            await new Promise((resolve) =>
                window.setTimeout(resolve, delay)
            );
            delay = Math.min(
                Math.round(delay * 1.3),
                MODE_CHANGE_POLL_MAX_MS
            );
        }

        throw new WorkflowError(
            uiMessage(
                'EditItemsApp nie otworzył nowej sesji po resecie.',
                'EditItemsApp did not open a new session after reset.'
            ),
            { code: 'QEI-E205' }
        );
    }

    async function resetWorkflowSession(state) {
        try {
            await endWorkflow(state);
        } catch (error) {
            if (
                isStopRequestedError(error) ||
                (error instanceof WorkflowError && error.fatal)
            ) {
                throw error;
            }
        }
        return waitForFreshWorkflowPage(state);
    }

    async function waitForModeStart(mode, initialPage = null) {
        const deadline = Date.now() + MODE_CHANGE_TIMEOUT_MS;
        let page = initialPage;
        let delay = MODE_CHANGE_POLL_MS;

        while (true) {
            throwIfStopRequested();
            if (!page) {
                page = await loadWorkflowPage();
            }
            if (normalizeValue(page.state.status) === 'PROCESSING') {
                setStatus(UI.changingMode);
                await waitForReady(page.state);
                page = null;
                continue;
            }
            if (
                hasWorkflowMode(page, mode) &&
                isExpectedModeStart(page, mode)
            ) {
                return page;
            }

            setStatus(UI.changingMode);
            if (Date.now() >= deadline) {
                return page;
            }
            await new Promise((resolve) =>
                window.setTimeout(resolve, delay)
            );
            delay = Math.min(
                Math.round(delay * 1.3),
                MODE_CHANGE_POLL_MAX_MS
            );
            page = await loadWorkflowPage();
        }
    }

    async function waitForModeSelection(initialPage = null) {
        const deadline = Date.now() + MODE_CHANGE_TIMEOUT_MS;
        let page = initialPage;
        let delay = MODE_CHANGE_POLL_MS;

        while (Date.now() < deadline) {
            throwIfStopRequested();
            if (!page) {
                page = await loadWorkflowPage();
            }
            if (normalizeValue(page.state.status) === 'PROCESSING') {
                setStatus(UI.changingMode);
                await waitForReady(page.state);
                page = null;
                continue;
            }
            if (isModeSelectionStep(page)) {
                return page;
            }

            setStatus(UI.changingMode);
            await new Promise((resolve) =>
                window.setTimeout(resolve, delay)
            );
            delay = Math.min(
                Math.round(delay * 1.3),
                MODE_CHANGE_POLL_MAX_MS
            );
            page = await loadWorkflowPage();
        }

        return page;
    }

    function findModeOption(page, mode) {
        const target = normalizeValue(mode) === 'SKU' ? 'SKU' : 'EACH';
        const options = page.document.querySelectorAll(
            'input[type="radio"][name="options"]'
        );

        for (const option of options) {
            if (normalizeValue(option.value) === target) {
                return compactText(option.value);
            }
        }

        return '';
    }

    function readWorkflowOptionQuantity(element) {
        const label = element?.closest('label');
        const text = compactText(
            (
                label?.querySelector('h1') ||
                label?.querySelector('.a-radio-label')
            )?.textContent || label?.textContent
        );
        const match = text.match(
            /(?:Ilość|Quantity):\s*([\d\s.,]+)/i
        );
        return match
            ? Number(match[1].replace(/\D/g, ''))
            : null;
    }

    function readSkuSource(
        page,
        selectedSourceMode,
        excludedOptions = new Set()
    ) {
        const targetValue = selectedSourceMode === 'all'
            ? 'ALL'
            : 'INVENTORY';
        const options = Array.from(page.document.querySelectorAll(
            'input[type="radio"][name="options"]'
        ));
        let option = options.find(
            (element) =>
                normalizeValue(element.value) === targetValue &&
                !excludedOptions.has(normalizeValue(element.value))
        );

        if (!option && selectedSourceMode === 'all') {
            option = options.find((element) => {
                const text = normalizeValue(
                    element.closest('label')?.textContent
                );
                return !excludedOptions.has(normalizeValue(element.value)) &&
                    (
                        text.includes('WYBIERZ_WSZYSTKIE') ||
                        text.includes('SELECT_ALL')
                    );
            });
        }

        let quantity = readWorkflowOptionQuantity(option);

        if (!option && selectedSourceMode === 'all') {
            const sources = options.map((element) => ({
                element,
                quantity: readWorkflowOptionQuantity(element),
            }));
            const nextSource = sources.find(
                (source) =>
                    source.quantity > 0 &&
                    !excludedOptions.has(
                        normalizeValue(source.element.value)
                    )
            );
            if (nextSource) {
                option = nextSource.element;
                quantity = nextSource.quantity;
            } else if (
                sources.length > 0 &&
                sources.every((source) => source.quantity !== null)
            ) {
                return {
                    option: '',
                    quantity: 0,
                    disabled: false,
                };
            }
        }

        if (quantity === null) {
            const context = page.document.querySelector('#context');
            for (const name of context?.querySelectorAll('dt') || []) {
                const normalizedName = normalizeValue(name.textContent)
                    .replace(/:$/, '');
                if (normalizedName !== 'ILOŚĆ' && normalizedName !== 'QUANTITY') {
                    continue;
                }
                const value = compactText(name.nextElementSibling?.textContent);
                const contextMatch = value.match(/\d(?:[\d\s.,]*\d)?/);
                if (contextMatch) {
                    quantity = Number(contextMatch[0].replace(/\D/g, ''));
                }
                break;
            }
        }

        if (
            !option ||
            quantity === null
        ) {
            throw new WorkflowError(
                selectedSourceMode === 'all'
                    ? uiMessage(
                        'Nie znaleziono źródła „Wybierz wszystkie” ani jego ilości.',
                        'The “Select all” source or its quantity was not found.'
                    )
                    : uiMessage(
                        'Nie znaleziono stanu źródłowego „zapas” ani jego ilości.',
                        'The “inventory” source state or its quantity was not found.'
                    ),
                { code: 'QEI-E304' }
            );
        }

        return {
            option: compactText(option.value),
            quantity,
            disabled: option.disabled,
        };
    }

    function readSkuSourceDisposition(page, targetValue) {
        const options = Array.from(page.document.querySelectorAll(
            'input[type="radio"][name="options"]'
        ));
        const sources = options.map((element) => ({
            element,
            quantity: readWorkflowOptionQuantity(element),
        }));
        const source = sources.find(({ element, quantity }) => {
            const value = normalizeValue(element.value);
            return quantity > 0 &&
                value !== normalizeValue(targetValue) &&
                value !== 'ALL';
        });

        if (source) {
            return {
                option: compactText(source.element.value),
                quantity: source.quantity,
                disabled: source.element.disabled,
            };
        }
        if (
            sources.length > 0 &&
            sources.every(({ quantity }) => quantity !== null)
        ) {
            return null;
        }

        throw new WorkflowError(
            uiMessage(
                'Nie znaleziono dyspozycji źródłowej SKU ani jej ilości.',
                'The Sku source disposition or its quantity was not found.'
            ),
            { code: 'QEI-E307' }
        );
    }

    function findWorkflowOption(page, targetOption) {
        const options = page.document.querySelectorAll(
            'input[type="radio"][name="options"]'
        );

        for (const option of options) {
            if (normalizeValue(option.value) === targetOption.value) {
                return compactText(option.value);
            }
        }

        return '';
    }

    function isConfirmationStep(page) {
        return Array.from(
            page.document.querySelectorAll('[data-click-action]')
        ).some((element) =>
            String(element.getAttribute('data-click-action')).includes(
                '"action":"Confirm"'
            )
        );
    }

    function readCurrentContainer(page) {
        const context = page.document.querySelector('#context');
        if (!context) {
            return '';
        }

        for (const label of context.querySelectorAll('dt')) {
            const name = normalizeValue(label.textContent);
            if (
                name.includes('ID_POJEMNIKA') ||
                name.includes('CONTAINER_ID')
            ) {
                return compactText(label.nextElementSibling?.textContent);
            }
        }

        return '';
    }

    function sameContainer(first, second) {
        return compactText(first).toUpperCase() ===
            compactText(second).toUpperCase();
    }

    async function loadSettledWorkflowPage() {
        let page = await loadWorkflowPage();

        if (normalizeValue(page.state.status) === 'PROCESSING') {
            await waitForReady(page.state);
            page = await loadWorkflowPage();
        }

        return page;
    }

    async function selectWorkflowMode(page, mode) {
        if (!hasWorkflowMode(page, mode)) {
            setStatus(UI.changingMode);
            let modePage = page;

            if (!isModeSelectionStep(modePage)) {
                await sendAction(
                    modePage.state,
                    'SelectMode',
                    'SelectMode'
                );
                modePage = await waitForModeSelection();
            }

            if (!isModeSelectionStep(modePage)) {
                throw new WorkflowError(
                    uiMessage(
                        'Nie udało się otworzyć wyboru trybu EditItemsApp.',
                        'Could not open the EditItemsApp mode selection.'
                    ),
                    { code: 'QEI-E205' }
                );
            }

            const modeOption = findModeOption(modePage, mode);
            if (!modeOption) {
                throw new WorkflowError(
                    uiMessage(
                        `Nie znaleziono trybu EditItemsApp „${mode}”.`,
                        `EditItemsApp mode “${mode}” was not found.`
                    ),
                    { code: 'QEI-E205', fatal: true }
                );
            }

            await sendAction(modePage.state, 'Input', modeOption);
            page = await waitForModeStart(mode);
        } else if (!isExpectedModeStart(page, mode)) {
            page = await waitForModeStart(mode, page);
        }

        if (
            !hasWorkflowMode(page, mode) ||
            !isExpectedModeStart(page, mode)
        ) {
            throw new WorkflowError(
                uiMessage(
                    `EditItemsApp nie rozpoczął trybu „${mode}” od właściwego kroku (${page.heading || UI.noHeading}).`,
                    `EditItemsApp did not start mode “${mode}” from the correct step (${page.heading || UI.noHeading}).`
                ),
                { code: 'QEI-E206' }
            );
        }

        return page;
    }

    async function prepareWorkflowStart(mode, currentState = null) {
        let page = currentState
            ? await resetWorkflowSession(currentState)
            : await loadSettledWorkflowPage();

        if (!currentState) {
            page = await resetWorkflowSession(page.state);
        }

        let lastError = null;
        for (let attempt = 0; attempt < MODE_CHANGE_ATTEMPTS; attempt += 1) {
            try {
                return await selectWorkflowMode(page, mode);
            } catch (error) {
                if (
                    isStopRequestedError(error) ||
                    (error instanceof WorkflowError && error.fatal)
                ) {
                    throw error;
                }
                lastError = error;
            }

            setStatus(UI.changingMode);
            page = await resetWorkflowSession(
                activeWorkflowState || page.state
            );
        }

        throw new WorkflowError(
            lastError?.message ||
                uiMessage(
                    `EditItemsApp nie rozpoczął trybu „${mode}”.`,
                    `EditItemsApp did not start mode “${mode}”.`
                ),
            { code: lastError?.code || 'QEI-E206', fatal: true }
        );
    }
    async function resetToContainerStep(page) {
        await endWorkflow(page.state);
        const resetPage = await loadSettledWorkflowPage();

        if (!isContainerStep(resetPage)) {
            throw new WorkflowError(
                uiMessage(
                    `EditItemsApp nie rozpoczął kroku skanowania pojemnika (${resetPage.heading || UI.noHeading}).`,
                    `EditItemsApp did not start the container scanning step (${resetPage.heading || UI.noHeading}).`
                ),
                { code: 'QEI-E201', fatal: true }
            );
        }

        return resetPage;
    }

    async function getWorkflowForContainer(container) {
        let page = await loadSettledWorkflowPage();
        const currentContainer = readCurrentContainer(page);

        if (
            isProductStep(page) &&
            currentContainer &&
            sameContainer(currentContainer, container)
        ) {
            return page.state;
        }

        if (!isContainerStep(page)) {
            page = await resetToContainerStep(page);
        }

        await sendAction(page.state, 'Input', container);
        const productPage = await loadWorkflowPage();
        if (!isProductStep(productPage)) {
            throw new WorkflowError(
                uiMessage(
                    `Nie przyjęto pojemnika ${container}.`,
                    `Container ${container} was not accepted.`
                ),
                { code: 'QEI-E202' }
            );
        }

        const acceptedContainer = readCurrentContainer(productPage);
        if (
            !acceptedContainer ||
            !sameContainer(acceptedContainer, container)
        ) {
            throw new WorkflowError(
                uiMessage(
                    `EditItemsApp otworzył inny pojemnik niż ${container}.`,
                    `EditItemsApp opened a different container instead of ${container}.`
                ),
                { code: 'QEI-E203' }
            );
        }

        return page.state;
    }

    async function changeItemInActiveWorkflow(state, item, action) {
        await sendAction(state, 'Input', item.identifier);
        let page;

        for (const expectedOption of action.options) {
            page = await loadWorkflowPage();
            const selectedOption = findWorkflowOption(
                page,
                expectedOption
            );
            if (!selectedOption) {
                throw new WorkflowError(
                    uiMessage(
                        `Nie znaleziono opcji „${expectedOption.visibleLabel}” dla ${item.identifierType} ${item.identifier}.`,
                        `Option “${expectedOption.englishLabel}” was not found for ${item.identifierType} ${item.identifier}.`
                    ),
                    { code: 'QEI-E301' }
                );
            }

            await sendAction(state, 'Input', selectedOption);
        }

        page = await loadWorkflowPage();
        if (!isConfirmationStep(page)) {
            throw new WorkflowError(
                uiMessage(
                    `Nie przygotowano zmiany ${item.identifierType} ${item.identifier} na ${action.targetValue}.`,
                    `The change of ${item.identifierType} ${item.identifier} to ${action.targetValue} was not prepared.`
                ),
                { code: 'QEI-E302' }
            );
        }

        await sendAction(state, 'Confirm', 'Confirm');
        const afterConfirmation = await loadWorkflowPage();
        if (!isProductStep(afterConfirmation)) {
            throw new WorkflowError(
                uiMessage(
                    `Po zmianie ${item.identifierType} ${item.identifier} EditItemsApp nie wrócił do kroku skanowania produktu.`,
                    `After changing ${item.identifierType} ${item.identifier}, EditItemsApp did not return to the product scanning step.`
                ),
                { code: 'QEI-E303' }
            );
        }
    }

    function isExpectedSkuBatchLimit(error) {
        return error instanceof WorkflowError &&
            error.code === 'QEI-E108' &&
            normalizeValue(error.message).includes('ERRORED');
    }

    async function openSkuSourcePage(
        identifier,
        currentState,
        selectedSourceMode,
        excludedSourceOptions = new Set()
    ) {
        const startPage = await prepareWorkflowStart('Sku', currentState);
        await sendAction(startPage.state, 'Input', identifier);
        const sourcePage = await loadWorkflowPage();

        if (!isSkuSourceStep(sourcePage)) {
            throw new WorkflowError(
                uiMessage(
                    `Nie otwarto wyboru stanu źródłowego dla FNSku ${identifier}.`,
                    `The source state selection did not open for FNSku ${identifier}.`
                ),
                { code: 'QEI-E304' }
            );
        }

        return {
            page: sourcePage,
            state: startPage.state,
            source: readSkuSource(
                sourcePage,
                selectedSourceMode,
                excludedSourceOptions
            ),
        };
    }

    async function changeSkuBatch(
        state,
        sourcePage,
        group,
        action,
        selectedSourceMode,
        excludedSourceOptions,
        previousProgress
    ) {
        const source = readSkuSource(
            sourcePage,
            selectedSourceMode,
            excludedSourceOptions
        );
        if (source.quantity <= 0) {
            return { changed: false };
        }
        if (source.disabled) {
            throw new WorkflowError(
                selectedSourceMode === 'all'
                    ? uiMessage(
                        `Źródło „Wszystkie” dla FNSku ${group.identifier} jest wyłączone mimo ilości ${source.quantity}.`,
                        `The “All” source for FNSku ${group.identifier} is disabled despite quantity ${source.quantity}.`
                    )
                    : uiMessage(
                        `Stan „zapas” dla FNSku ${group.identifier} jest wyłączony mimo ilości ${source.quantity}.`,
                        `The “inventory” state for FNSku ${group.identifier} is disabled despite quantity ${source.quantity}.`
                    ),
                { code: 'QEI-E306' }
            );
        }

        await sendAction(state, 'Input', source.option);
        let page = await loadWorkflowPage();
        let progress = {
            key: normalizeValue(source.option),
            quantity: source.quantity,
        };
        const targetStateOption = findWorkflowOption(
            page,
            action.options[0]
        );

        if (!targetStateOption) {
            const sourceDisposition = readSkuSourceDisposition(
                page,
                action.targetValue
            );
            if (!sourceDisposition) {
                return {
                    changed: false,
                    sourceOption: source.option,
                };
            }
            if (sourceDisposition.disabled) {
                throw new WorkflowError(
                    uiMessage(
                        `Dyspozycja źródłowa SKU jest wyłączona mimo ilości ${sourceDisposition.quantity}.`,
                        `The Sku source disposition is disabled despite quantity ${sourceDisposition.quantity}.`
                    ),
                    { code: 'QEI-E306' }
                );
            }
            progress = {
                key: `${normalizeValue(source.option)}\u0000${normalizeValue(sourceDisposition.option)}`,
                quantity: sourceDisposition.quantity,
            };
            if (
                previousProgress?.key === progress.key &&
                progress.quantity >= previousProgress.quantity
            ) {
                throw new WorkflowError(
                    uiMessage(
                        `FNSku ${group.identifier}: zapas nie zmniejszył się (${previousProgress.quantity} → ${progress.quantity}).`,
                        `FNSku ${group.identifier}: inventory did not decrease (${previousProgress.quantity} → ${progress.quantity}).`
                    ),
                    { code: 'QEI-E305' }
                );
            }
            await sendAction(state, 'Input', sourceDisposition.option);
            page = await loadWorkflowPage();
        } else if (
            previousProgress?.key === progress.key &&
            progress.quantity >= previousProgress.quantity
        ) {
            throw new WorkflowError(
                uiMessage(
                    `FNSku ${group.identifier}: zapas nie zmniejszył się (${previousProgress.quantity} → ${progress.quantity}).`,
                    `FNSku ${group.identifier}: inventory did not decrease (${previousProgress.quantity} → ${progress.quantity}).`
                ),
                { code: 'QEI-E305' }
            );
        }

        for (const expectedOption of action.options) {
            const selectedOption = findWorkflowOption(
                page,
                expectedOption
            );
            if (!selectedOption) {
                throw new WorkflowError(
                    uiMessage(
                        `Nie znaleziono opcji „${expectedOption.visibleLabel}” dla FNSku ${group.identifier}.`,
                        `Option “${expectedOption.englishLabel}” was not found for FNSku ${group.identifier}.`
                    ),
                    { code: 'QEI-E301' }
                );
            }

            await sendAction(state, 'Input', selectedOption);
            page = await loadWorkflowPage();
        }

        if (!isConfirmationStep(page)) {
            throw new WorkflowError(
                uiMessage(
                    `Nie przygotowano zmiany FNSku ${group.identifier} na ${action.targetValue}.`,
                    `The change of FNSku ${group.identifier} to ${action.targetValue} was not prepared.`
                ),
                { code: 'QEI-E302' }
            );
        }

        try {
            await sendAction(state, 'Confirm', 'Confirm');
        } catch (error) {
            if (!isExpectedSkuBatchLimit(error)) {
                throw error;
            }
        }
        return { changed: true, progress };
    }

    async function safelyEndWorkflow(state) {
        try {
            await endWorkflow(state);
        } catch {
            return;
        }
    }

    async function resetActiveWorkflowImmediately() {
        const state = activeWorkflowState;
        if (state) {
            await endWorkflow(state, { allowDuringStop: true });
        }
    }

    async function waitForImmediateReset() {
        if (!stopResetPromise) {
            return;
        }

        const error = await stopResetPromise;
        if (error) {
            const description = describeError(error);
            throw new WorkflowError(
                uiMessage(
                    `Nie udało się natychmiast zresetować EditItemsApp. ${description.message}`,
                    `Could not reset EditItemsApp immediately. ${description.message}`
                ),
                { code: 'QEI-E204', fatal: true }
            );
        }
    }

    async function resetEditItemsAfterRun(state) {
        if (state) {
            await safelyEndWorkflow(state);
        }

        let page;
        try {
            page = await loadSettledWorkflowPage();
            if (!isContainerStep(page)) {
                await endWorkflow(page.state);
                page = await loadSettledWorkflowPage();
            }
        } catch (error) {
            const description = describeError(error);
            throw new WorkflowError(
                uiMessage(
                    `Nie udało się zresetować EditItemsApp. ${description.message}`,
                    `Could not reset EditItemsApp. ${description.message}`
                ),
                { code: 'QEI-E204', fatal: true }
            );
        }

        if (!isContainerStep(page)) {
            throw new WorkflowError(
                uiMessage(
                    `EditItemsApp nie został zresetowany do kroku skanowania pojemnika (${page.heading || UI.noHeading}).`,
                    `EditItemsApp was not reset to the container scanning step (${page.heading || UI.noHeading}).`
                ),
                { code: 'QEI-E204', fatal: true }
            );
        }
    }

    function setCellValue(cell, value) {
        const link = cell.querySelector(
            'a[href*="/results?s="]'
        );
        if (link) {
            link.textContent = value;
        } else {
            cell.textContent = value;
        }
    }

    function markItemEditing(item, action) {
        setCellValue(item.consumerCell, '- EDITING -');
        if (action.targetField === 'disposition') {
            setCellValue(item.dispositionCell, '- EDITING -');
        }
    }

    function restoreItem(item, action) {
        setCellValue(item.consumerCell, item.previousConsumerText);
        if (action.targetField === 'disposition') {
            setCellValue(
                item.dispositionCell,
                item.previousDispositionText
            );
        }
    }

    function markItemChanged(item, action) {
        if (action.targetField === 'consumer') {
            setCellValue(item.consumerCell, action.targetValue);
            return;
        }

        setCellValue(item.consumerCell, action.resultConsumer);
        setCellValue(item.dispositionCell, action.targetValue);
    }

    function markSkuGroupEditing(group) {
        for (const row of group.rows) {
            setCellValue(row.consumerCell, '- EDITING -');
            setCellValue(row.dispositionCell, '- EDITING -');
        }
    }

    function restoreSkuGroup(group) {
        for (const row of group.rows) {
            setCellValue(row.consumerCell, row.consumerText);
            setCellValue(row.dispositionCell, row.dispositionText);
        }
    }

    function markSkuGroupChanged(group, action) {
        for (const row of group.rows) {
            if (row.consumer === 'UNOWNED') {
                setCellValue(row.consumerCell, action.resultConsumer);
                setCellValue(row.dispositionCell, action.targetValue);
            } else {
                setCellValue(row.consumerCell, row.consumerText);
                setCellValue(row.dispositionCell, row.dispositionText);
            }
        }
    }

    async function runAllBySku(selectedSourceMode) {
        const action = ACTIONS.defectiveSku;
        const groups = await collectFnSkusToChange(selectedSourceMode);

        if (stopRequested) {
            await waitForImmediateReset();
            setStatus(UI.stopped);
            return;
        }

        if (groups.length === 0) {
            setStatus(UI.done, 'success');
            return;
        }

        const failures = [];
        let state = null;

        try {
            for (const group of groups) {
                if (stopRequested) {
                    break;
                }

                markSkuGroupEditing(group);

                try {
                    const excludedSourceOptions = new Set();
                    let previousProgress = null;
                    let opened = await openSkuSourcePage(
                        group.identifier,
                        state,
                        selectedSourceMode,
                        excludedSourceOptions
                    );
                    state = opened.state;
                    let quantity = opened.source.quantity;

                    while (quantity > 0) {
                        setStatus(
                            `${stopRequested ? `${UI.stopping} ` : ''}${group.identifier}: ${UI.stock} ${quantity}`
                        );
                        const result = await changeSkuBatch(
                            state,
                            opened.page,
                            group,
                            action,
                            selectedSourceMode,
                            excludedSourceOptions,
                            previousProgress
                        );
                        if (result.changed) {
                            previousProgress = result.progress;
                        } else {
                            excludedSourceOptions.add(
                                normalizeValue(
                                    result.sourceOption ||
                                    opened.source.option
                                )
                            );
                            previousProgress = null;
                        }

                        preserveSkuBatchStatus = true;
                        try {
                            opened = await openSkuSourcePage(
                                group.identifier,
                                state,
                                selectedSourceMode,
                                excludedSourceOptions
                            );
                        } finally {
                            preserveSkuBatchStatus = false;
                        }
                        state = opened.state;
                        quantity = opened.source.quantity;
                    }

                    markSkuGroupChanged(group, action);
                } catch (error) {
                    restoreSkuGroup(group);
                    if (isStopRequestedError(error)) {
                        break;
                    }
                    const description = describeError(error);
                    failures.push({
                        ...description,
                        identifier: group.identifier,
                    });
                    setStatus(
                        `${description.code}: ${description.message}`,
                        'error'
                    );

                    await safelyEndWorkflow(state);
                    state = null;

                    if (
                        error instanceof WorkflowError &&
                        error.fatal
                    ) {
                        break;
                    }
                }
            }
        } finally {
            try {
                if (stopRequested) {
                    await waitForImmediateReset();
                } else {
                    await prepareWorkflowStart('Sku', state);
                }
            } catch (error) {
                const description = describeError(error);
                failures.push({
                    ...description,
                    identifier: 'EditItemsApp',
                });
            }
        }

        if (stopRequested && failures.length === 0) {
            setStatus(UI.stopped);
            return;
        }

        if (failures.length === 0) {
            setStatus(UI.done, 'success');
            return;
        }

        const lastFailure = failures[failures.length - 1];
        setStatus(
            `${lastFailure.code}: ${lastFailure.message}`,
            'error'
        );
        const status = document.getElementById(IDS.status);
        if (status) {
            status.title = failures
                .map((failure) =>
                    `[${failure.code}] ${failure.identifier}: ${failure.message}`
                )
                .join('\n');
        }
    }

    async function runAll(actionKey, selectedSourceMode) {
        if (running) {
            return;
        }

        const action = ACTIONS[actionKey];
        running = true;
        stopRequested = false;
        stopResetPromise = null;
        setButtonsState();
        setStatus(UI.connectingApp);

        try {
            if (
                action.workflowMode === 'Sku' &&
                !await refreshSkuAvailability()
            ) {
                setStatus(UI.skuSameAsin);
                return;
            }
            await acquireWorkflowQueue();
            setStatus(UI.connectingApp);
            if (action.workflowMode === 'Sku') {
                await runAllBySku(selectedSourceMode);
                return;
            }

            if (actionKey === 'pendingResearch') {
                setPendingProgress(0, 0);
            }
            const items = await collectItemsToChange(
                actionKey,
                selectedSourceMode
            );
            if (actionKey === 'pendingResearch') {
                setPendingProgress(0, items.length);
            }

            if (stopRequested) {
                await waitForImmediateReset();
                setStatus(UI.stopped);
                return;
            }

            if (items.length === 0) {
                setStatus(UI.done, 'success');
                return;
            }

            let changed = 0;
            const failures = [];
            let activeContainer = '';
            let state = null;

            try {
                await prepareWorkflowStart(action.workflowMode);
                for (const item of items) {
                    if (stopRequested) {
                        break;
                    }

                    setStatus(
                        `${item.identifier} (${item.previousTargetText})`
                    );
                    markItemEditing(item, action);

                    try {
                        if (
                            !state ||
                            !sameContainer(activeContainer, item.container)
                        ) {
                            await safelyEndWorkflow(state);
                            state = await getWorkflowForContainer(
                                item.container
                            );
                            activeContainer = item.container;
                        }

                        await changeItemInActiveWorkflow(
                            state,
                            item,
                            action
                        );
                        changed += 1;
                        markItemChanged(item, action);
                        if (actionKey === 'pendingResearch') {
                            setPendingProgress(changed, items.length);
                        }
                    } catch (error) {
                        restoreItem(item, action);
                        if (isStopRequestedError(error)) {
                            break;
                        }
                        const description = describeError(error);
                        failures.push({
                            ...description,
                            identifier: item.identifier,
                        });
                        setStatus(
                            `${description.code}: ${description.message}`,
                            'error'
                        );

                        await safelyEndWorkflow(state);
                        state = null;
                        activeContainer = '';

                        if (
                            error instanceof WorkflowError &&
                            error.fatal
                        ) {
                            break;
                        }
                    }

                    if (stopRequested) {
                        break;
                    }
                }
            } finally {
                try {
                    if (stopRequested) {
                        await waitForImmediateReset();
                    } else {
                        await resetEditItemsAfterRun(state);
                    }
                } catch (error) {
                    const description = describeError(error);
                    failures.push({
                        ...description,
                        identifier: 'EditItemsApp',
                    });
                }
            }

            if (
                stopRequested &&
                failures.length === 0 &&
                changed < items.length
            ) {
                setStatus(
                    action.targetField === 'disposition'
                        ? UI.stopped
                        : uiMessage(
                            `Zatrzymano — zmieniono ${changed}/${items.length}.`,
                            `Stopped — changed ${changed}/${items.length}.`
                        )
                );
                return;
            }

            if (failures.length === 0) {
                setStatus(UI.done, 'success');
                return;
            }

            const lastFailure = failures[failures.length - 1];
            setStatus(
                action.targetField === 'disposition'
                    ? `${lastFailure.code}: ${lastFailure.message}`
                    : uiMessage(
                        `${lastFailure.code}: ${lastFailure.message} — zmieniono ${changed}/${items.length}, błędy: ${failures.length}.`,
                        `${lastFailure.code}: ${lastFailure.message} — changed ${changed}/${items.length}, errors: ${failures.length}.`
                    ),
                'error'
            );
            const status = document.getElementById(IDS.status);
            if (status) {
                status.title = failures
                    .map((failure) =>
                        `[${failure.code}] ${failure.identifier}: ${failure.message}`
                    )
                    .join('\n');
            }
        } catch (error) {
            if (isStopRequestedError(error)) {
                try {
                    await waitForImmediateReset();
                    setStatus(UI.stopped);
                } catch (resetError) {
                    const description = describeError(resetError);
                    setStatus(
                        `${description.code}: ${description.message}`,
                        'error'
                    );
                }
                return;
            }
            const description = describeError(error);
            setStatus(
                `${description.code}: ${description.message}`,
                'error'
            );
        } finally {
            try {
                await releaseWorkflowQueue();
            } catch (error) {
                const description = describeError(error);
                setStatus(`${description.code}: ${description.message}`, 'error');
            }
            running = false;
            stopRequested = false;
            stopResetPromise = null;
            setButtonsState();
        }
    }

    const observer = new MutationObserver(scheduleControlsInstall);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    if (location.pathname.endsWith('/results')) {
        initializeWorkflowQueue().catch(() => {});
    }
    ensureControls();
})();
