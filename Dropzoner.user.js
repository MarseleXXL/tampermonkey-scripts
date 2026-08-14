// ==UserScript==
// @name         Dropzoner
// @namespace    aft-move-container-auto-tools-age
// @version      1.00
// @author       aolenche
// @description  Twórz własną listę Drop-Zon i porządkuj je według grup. Sprawdzaj wiek oraz ilość towaru w kontenerach. Przeglądaj historię skanowań.
// @icon         https://drive-render.corp.amazon.com/view/aolenche@/Icons/Dropzoner.png
// @match        *://*/aft-moveapp-dub-dub.dub.proxy.amazon.com/move-container/*
// @match        *://peculiar-inventory-eu.aka.corp.amazon.com/*
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Dropzoner.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Dropzoner.user.js
// @run-at       document-start
// @connect      peculiar-inventory-eu.aka.corp.amazon.com
// @connect      cdn.sheetjs.com
// @connect      dropzones-iol-sync.dropzones-iol.workers.dev
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// ==/UserScript==
(function () {
    'use strict';

    var LAYOUT_DEBOUNCE_MS = 80;
    var UI_ANIMATION_MS = 320;
    var UI_ANIMATION_EASING = 'cubic-bezier(0.22, 0.84, 0.29, 1)';
    var ERROR_C_COOLDOWN_MS = 900;
    var CONFIRM_RETRY_COOLDOWN_MS = 1800;
    var MAX_CONFIRM_RETRIES_PER_MODAL = 3;
    var DELETE_CONFIRM_MS = 1600;
    var DEFAULT_SOURCE_SCAN = 'rcCRetStations';
    var COMPACT_SCAN_INSTRUCTION_TEXT = 'Zeskanuj';
    var DEFAULT_SOURCE_SCAN_COOLDOWN_MS = 1800;
    var DROP_ZONE_STEP_WAIT_MS = 45;
    var DROP_ZONE_SEQUENCE_MAX_WAIT_MS = 3500;
    var AFT_STEP_SOURCE = 'ScanSourceContainerStep';
    var AFT_STEP_DESTINATION = 'ScanDestinationContainerStep';
    var AFT_STEP_CONTAINER = 'ScanContainerStep';
    var INVENTORY_API_ORIGIN = 'https://peculiar-inventory-eu.aka.corp.amazon.com';
    var INVENTORY_WAREHOUSE_ID = 'WRO1';
    var PECULIAR_CONTAINER_HASH_KEY = 'dropzonerContainer';
    var FC_RESEARCH_RESULTS_URL = 'https://fcresearch-eu.aka.amazon.com/WRO1/results?s=';
    var INVENTORY_REQUEST_TIMEOUT_MS = 10000;
    var INVENTORY_RETRY_BASE_MS = 1000;
    var INVENTORY_RETRY_MAX_MS = 30000;
    var CONTAINER_SCAN_QUEUE_FAST_POLL_MS = 100;
    var CONTAINER_SCAN_QUEUE_SLOW_POLL_MS = 750;
    var CONTAINER_SCAN_QUEUE_BACKOFF_AFTER_MS = 3000;
    var CONTAINER_SCAN_QUEUE_SETTLE_MS = 500;
    var CONTAINER_SCAN_CAPTURE_TTL_MS = 10 * 60 * 1000;
    var USER_PROFILE_SYNC_API_ORIGIN = 'https://dropzones-iol-sync.dropzones-iol.workers.dev';
    var USER_PROFILE_SYNC_API_KEY = 'eb5a0db9b2e04aabbe0eff10e1cdce2db2f41911f2ee414488fcb38fbc4eafa7';
    var PAGE_WINDOW = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;

    var STORAGE_KEY_OLD_BUTTONS = 'aft_move_container_scan_buttons_v1';
    var STORAGE_KEY_GROUPS = 'aft_move_container_scan_button_groups_v2';
    var STORAGE_KEY_SELECTED_GROUP = 'aft_move_container_scan_buttons_selected_group_v1';
    var STORAGE_KEY_PRESET_GROUPS_109 = 'aft_move_container_preset_groups_109_installed_v1';
    var STORAGE_KEY_DARK_MODE = 'aft_move_container_auto_dropzone_dark_mode_v1';
    var STORAGE_KEY_AGE_ALARM_VOLUME = 'aft_move_container_age_alarm_volume_v1';
    var STORAGE_KEY_AGE_ALARM_LAST_VOLUME = 'aft_move_container_age_alarm_last_volume_v1';
    var STORAGE_KEY_SCAN_SOUND_IOL = 'aft_move_container_scan_sound_iol_v1';
    var STORAGE_KEY_SCAN_SOUND_SAFE = 'aft_move_container_scan_sound_safe_v1';
    var STORAGE_KEY_SCAN_SOUND_MISSING = 'aft_move_container_scan_sound_missing_v1';
    var STORAGE_KEY_WINDOW_FOCUS_INDICATOR = 'aft_move_container_window_focus_indicator_v1';
    var STORAGE_KEY_WINDOW_FOCUS_INDICATOR_DIRTY = 'aft_move_container_window_focus_indicator_dirty_v1';
    var STORAGE_KEY_SCAN_HISTORY = 'aft_move_container_scan_history_v1';
    var STORAGE_KEY_SCAN_HISTORY_COLLAPSED = 'aft_move_container_scan_history_collapsed_v1';
    var STORAGE_KEY_SCAN_HISTORY_HEIGHT = 'aft_move_container_scan_history_height_v1';
    var STORAGE_KEY_SCAN_HISTORY_EXPANDED_HEIGHT = 'aft_move_container_scan_history_expanded_height_v1';
    var SCAN_HISTORY_DEFAULT_HEIGHT = 220;
    var SCAN_HISTORY_MIN_HEIGHT = 0;
    var SCAN_HISTORY_COLLAPSE_ROW_COUNT = 3;
    var SCAN_HISTORY_COLLAPSE_FALLBACK_ROW_HEIGHT = 38;
    var SCAN_GROUPS_MIN_VISIBLE_HEIGHT = 96;
    var EMPTY_CONTAINER_TEXT = 'Brak';
    var BASE_AGE_LIMIT_MS = 62 * 60 * 60 * 1000;
    var DAY_SHIFT_START_MINUTES = 6 * 60;
    var NIGHT_SHIFT_START_MINUTES = 17 * 60 + 30;
    var UNGROUPED_GROUP_ID = '__ungrouped__';

    var PRESET_GROUPS_109 = [
        {
            name: 'C-RET',
            buttons: [
                { text: 'dz-P-cret-EOL1', label: 'Linia 1' },
                { text: 'dz-P-cret-EOL2', label: 'Linia 2' },
                { text: 'dz-P-cret-EOL3', label: 'Linia 3' },
                { text: 'dz-P-cret-EOL4', label: 'Linia 4' },
                { text: 'dz-P-cret-ps', label: 'C-ret PS' },
                { text: 'dz-P-CR-Addins', label: 'Addin PS' },
                { text: 'dz-P-cret-seso', label: 'Se-So' },
                { text: 'dz-P-CR-SeSoOUT', label: 'Se-So out' },
                { text: 'dz-P-cret-exception-to', label: 'Hazmat to' },
                { text: 'dz-P-cret-exception-wip', label: 'Hazmat WIP' }
            ]
        },
        {
            name: 'WHD',
            buttons: [
                { text: 'dz-P-WHD-PS', label: 'WHD PS' },
                { text: 'dz-P-WHD-Sort', label: 'WHD Sort' },
                { text: 'dz-P-ExRpInbound', label: 'External Repair' }
            ]
        }
    ];

    var lastErrorCAt = 0;
    var lastConfirmAt = 0;
    var autoConfirmScanActiveUntil = 0;
    var lastModalSignature = '';
    var modalRetryCount = 0;
    var observerTimer = null;
    var layoutTimer = null;
    var cachedElements = {};
    var scanGroups = [];
    var activeGroupId = '';
    var groupUndoStack = [];
    var groupRedoStack = [];
    var lastCommittedGroupState = '';
    var groupUndoReady = false;
    var groupUndoRestoring = false;
    var groupUndoHandlerInstalled = false;
    var layoutIndependentHotkeysInstalled = false;
    var GROUP_UNDO_LIMIT = 100;
    var dragData = null;
    var groupDragData = null;
    var dropTarget = null;
    var dropMarkerFrame = null;
    var pendingDropMarker = null;
    var pendingDeleteButtonKey = '';
    var pendingDeleteButtonTimer = null;
    var pendingDeleteButton = null;
    var pendingDeleteRow = null;
    var lastDefaultSourceScanAt = 0;
    var dropZoneScanSequence = 0;
    var dropZoneSequenceActive = false;
    var activeAgeButtonId = '';
    var activeAgeDropZoneText = '';
    var activeAgeDropZoneLabel = '';
    var lastAgeScanSignature = '';
    var containerScanQueue = [];
    var containerScanQueueTimer = null;
    var containerScanQueueActiveJob = null;
    var containerScanQueueDispatching = false;
    var containerScanQueueSawBusy = false;
    var containerScanQueueDispatchStartedAt = 0;
    var recentQueuedContainerCaptures = {};
    var inventoryAgeRequestStates = {};
    var suppressLatestAgeDisplay = false;
    var scanHistoryFullscreen = false;
    var scanHistoryEntrySequence = 0;
    var scanHistoryEntries = [];
    var scanHistoryClearedEntries = null;
    var scanHistoryClearRedoEntries = null;
    var scanHistoryClearRestored = false;
    var scanHistorySortColumn = 'time';
    var scanHistorySortDirection = 'desc';
    var scanHistoryFilters = {
        dateFrom: '',
        dateTo: '',
        dropZone: '',
        container: '',
        ageState: 'all',
        quantityMin: '',
        quantityMax: ''
    };
    var directScanEntryHandlersInstalled = false;
    var directScanEntrySuppressEnterUntil = 0;
    var physicalScannerInputInstalled = false;
    var manualAsciiInputInstalled = false;
    var windowFocusIndicatorInstalled = false;
    var windowFocusActivationGuardUntil = 0;
    var loadedXlsxLibrary = null;
    var xlsxLibraryLoading = false;
    var ageAlarmAudioContext = null;
    var ageAlarmAudioOutput = null;
    var ageAlarmUnlockInstalled = false;
    var lastScanResultSoundEntryId = '';
    var nativeAftSoundBlockerInstalled = false;
    var bootRevealTimer = null;
    var userProfileSyncInitialized = false;
    var userProfileSyncApplyingRemote = false;
    var userProfileSyncLogin = '';
    var userProfileSyncRemoteRevision = 0;
    var userProfileSyncLocalVersion = 0;
    var userProfileSyncPushTimer = null;
    var userProfileSyncRetryTimer = null;
    var userProfileSyncRequestActive = false;
    var userProfileSyncPushPending = false;

    function revealTargetPageAfterBoot() {
        var root = document.documentElement;
        var style = document.getElementById('aft-early-boot-style');
        if (bootRevealTimer) {
            window.clearTimeout(bootRevealTimer);
            bootRevealTimer = null;
        }
        if (root && root.classList) {
            root.classList.remove('aft-auto-dropzone-booting');
            root.removeAttribute('data-aft-boot-theme');
        }
        if (style && style.parentNode) {
            style.parentNode.removeChild(style);
        }
    }

    function hideTargetPageDuringBoot() {
        var root = document.documentElement;
        var style;
        var search = '';
        var dark = false;
        try {
            search = String(window.location && window.location.search || '');
        } catch (e1) {}
        if (!/(?:[?&])jobId=100(?:&|$)/.test(search) || !root) {
            return;
        }
        try {
            dark = window.localStorage.getItem(STORAGE_KEY_DARK_MODE) === '1';
        } catch (e2) {}
        root.classList.add('aft-auto-dropzone-booting');
        root.setAttribute('data-aft-boot-theme', dark ? 'dark' : 'light');
        style = document.createElement('style');
        style.id = 'aft-early-boot-style';
        style.textContent = 'html.aft-auto-dropzone-booting{background:#E9E6E1!important}html.aft-auto-dropzone-booting[data-aft-boot-theme="dark"]{background:#0B0F14!important}html.aft-auto-dropzone-booting body{visibility:hidden!important}';
        root.appendChild(style);
        bootRevealTimer = window.setTimeout(revealTargetPageAfterBoot, 8000);
    }

    hideTargetPageDuringBoot();
    function now() {
        return new Date().getTime();
    }

    function trimText(text) {
        return String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    }

    function makeId(prefix) {
        return String(prefix || 'id') + '_' + now() + '_' + Math.floor(Math.random() * 1000000);
    }

    function isArray(value) {
        return Object.prototype.toString.call(value) === '[object Array]';
    }

    function getCachedElement(id) {
        var el = cachedElements[id];
        if (el) {
            try {
                if (document.documentElement && document.documentElement.contains && document.documentElement.contains(el)) {
                    return el;
                }
                if (document.body && document.body.contains && document.body.contains(el)) {
                    return el;
                }
            } catch (e1) {}
        }

        el = document.getElementById(id);
        if (el) {
            cachedElements[id] = el;
        } else if (cachedElements[id]) {
            delete cachedElements[id];
        }
        return el;
    }

    function storageGet(key, fallback) {
        var value;
        try {
            value = window.localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (e) {}
        return fallback;
    }

    function storageSet(key, value) {
        try {
            window.localStorage.setItem(key, value);
            queueUserProfileSyncForStorageKey(key);
            return true;
        } catch (e) {}
        return false;
    }

    function storageGetJson(key, fallback) {
        var raw = storageGet(key, null);
        if (!raw) {
            return fallback;
        }
        try {
            return JSON.parse(raw);
        } catch (e) {}
        return fallback;
    }

    function isVisible(el) {
        if (!el) {
            return false;
        }
        var style = window.getComputedStyle ? window.getComputedStyle(el) : el.currentStyle;
        if (!style) {
            return true;
        }
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        return true;
    }

    function dispatchKeyboard(key, keyCode, charCode) {
        var eventNames = ['keydown', 'keypress', 'keyup'];
        for (var i = 0; i < eventNames.length; i++) {
            try {
                var ev;
                if (typeof KeyboardEvent === 'function') {
                    ev = new KeyboardEvent(eventNames[i], {
                        key: key,
                        code: key,
                        keyCode: keyCode,
                        which: keyCode,
                        charCode: charCode || keyCode,
                        bubbles: true,
                        cancelable: true
                    });
                } else {
                    ev = document.createEvent('Event');
                    ev.initEvent(eventNames[i], true, true);
                    ev.keyCode = keyCode;
                    ev.which = keyCode;
                    ev.charCode = charCode || keyCode;
                }
                document.dispatchEvent(ev);
            } catch (e) {}
        }
    }

    function triggerAftHotKey(key) {
        var upper = String(key || '').toUpperCase();
        try {
            if (PAGE_WINDOW.aft && PAGE_WINDOW.aft.registry && PAGE_WINDOW.aft.registry.eventDelegator && typeof PAGE_WINDOW.aft.registry.eventDelegator.handleHotKey === 'function') {
                PAGE_WINDOW.aft.registry.eventDelegator.handleHotKey(upper);
                return true;
            }
        } catch (e1) {}

        try {
            if (PAGE_WINDOW.aft && PAGE_WINDOW.aft.bus && typeof PAGE_WINDOW.aft.bus.trigger === 'function') {
                PAGE_WINDOW.aft.bus.trigger('hot-key-' + upper);
                return true;
            }
        } catch (e2) {}

        dispatchKeyboard(upper, upper.charCodeAt(0), upper.charCodeAt(0));
        return true;
    }

    function normalizeButton(item) {
        var label = '';
        var text = '';
        var id = '';

        if (typeof item === 'string') {
            label = trimText(item);
            text = label;
        } else if (item) {
            id = trimText(item.id || '');
            label = trimText(item.label || '');
            text = trimText(item.text || '');
        }

        if (!text && label) {
            text = label;
        }
        if (!label && text) {
            label = text;
        }
        if (!text) {
            return null;
        }
        if (!id) {
            id = makeId('btn');
        }

        return {
            id: id,
            label: label,
            text: text
        };
    }

    function isDefaultSourceScan(text) {
        return trimText(text).toLowerCase() === DEFAULT_SOURCE_SCAN.toLowerCase();
    }

    function normalizeHexColor(value) {
        var text = trimText(value);
        var shortMatch;
        var longMatch;

        if (!text) {
            return '';
        }
        if (text.charAt(0) !== '#') {
            text = '#' + text;
        }
        shortMatch = /^#([0-9a-f]{3})$/i.exec(text);
        if (shortMatch) {
            return '#' +
                shortMatch[1].charAt(0) + shortMatch[1].charAt(0) +
                shortMatch[1].charAt(1) + shortMatch[1].charAt(1) +
                shortMatch[1].charAt(2) + shortMatch[1].charAt(2);
        }
        longMatch = /^#([0-9a-f]{6})$/i.exec(text);
        return longMatch ? ('#' + longMatch[1].toUpperCase()) : '';
    }

    function normalizeGroup(group, fallbackName) {
        var normalized;
        var buttons = [];
        var sourceButtons;
        var i;
        var btn;

        if (!group) {
            return null;
        }

        normalized = {
            id: trimText(group.id || '') || makeId('grp'),
            name: trimText(group.name || fallbackName || 'Group'),
            collapsed: group.collapsed === true,
            color: normalizeHexColor(group.color || ''),
            buttons: []
        };

        sourceButtons = isArray(group.buttons) ? group.buttons : [];
        for (i = 0; i < sourceButtons.length; i++) {
            btn = normalizeButton(sourceButtons[i]);
            if (btn && !isDefaultSourceScan(btn.text || btn.label)) {
                buttons.push(btn);
            }
        }
        normalized.buttons = buttons;
        return normalized;
    }

    function ensureAtLeastOneGroup() {
        if (!scanGroups.length) {
            scanGroups.push({
                id: makeId('grp'),
                name: 'Default',
                collapsed: false,
                buttons: []
            });
        }
    }

    function loadGroups() {
        var parsedGroups;
        var oldButtons;
        var i;
        var group;
        var oldGroup;
        var btn;

        scanGroups = [];

        parsedGroups = storageGetJson(STORAGE_KEY_GROUPS, null);

        if (isArray(parsedGroups)) {
            for (i = 0; i < parsedGroups.length; i++) {
                group = normalizeGroup(parsedGroups[i], 'Grupa ' + (i + 1));
                if (group) {
                    scanGroups.push(group);
                }
            }
        }

        if (!scanGroups.length) {
            oldGroup = {
                id: makeId('grp'),
                name: 'Default',
                collapsed: false,
                buttons: []
            };

            oldButtons = storageGetJson(STORAGE_KEY_OLD_BUTTONS, []);

            if (isArray(oldButtons)) {
                for (i = 0; i < oldButtons.length; i++) {
                    btn = normalizeButton(oldButtons[i]);
                    if (btn) {
                        oldGroup.buttons.push(btn);
                    }
                }
            }

            scanGroups.push(oldGroup);
            saveGroups();
        }

        ensureAtLeastOneGroup();

        activeGroupId = storageGet(STORAGE_KEY_SELECTED_GROUP, '') || '';

        if (activeGroupId !== UNGROUPED_GROUP_ID && findGroupIndex(activeGroupId) < 0) {
            activeGroupId = scanGroups[0].id;
        }

        installPresetGroupsOnce();

        if (removeDefaultSourceButtonsFromGroups()) {
            saveGroups();
        }

        if (activeGroupId !== UNGROUPED_GROUP_ID && findGroupIndex(activeGroupId) < 0 && scanGroups.length) {
            activeGroupId = scanGroups[0].id;
        }

        initializeGroupUndoHistory();
        installGroupUndoKeyboardHandler();
    }

    function serializeGroupUndoState() {
        return JSON.stringify({
            groups: scanGroups,
            activeGroupId: activeGroupId || ''
        });
    }

    function initializeGroupUndoHistory() {
        groupUndoStack = [];
        groupRedoStack = [];
        lastCommittedGroupState = serializeGroupUndoState();
        groupUndoReady = true;
    }

    function pushLimitedUndoState(stack, state) {
        if (!state || (stack.length && stack[stack.length - 1] === state)) {
            return;
        }
        stack.push(state);
        if (stack.length > GROUP_UNDO_LIMIT) {
            stack.splice(0, stack.length - GROUP_UNDO_LIMIT);
        }
    }

    function saveGroups() {
        var currentState = serializeGroupUndoState();
        if (groupUndoReady && !groupUndoRestoring && currentState !== lastCommittedGroupState) {
            pushLimitedUndoState(groupUndoStack, lastCommittedGroupState);
            groupRedoStack = [];
        }
        lastCommittedGroupState = currentState;
        storageSet(STORAGE_KEY_GROUPS, JSON.stringify(scanGroups));
    }

    function saveActiveGroup() {
        storageSet(STORAGE_KEY_SELECTED_GROUP, activeGroupId || '');
    }

    function restoreGroupUndoState(serializedState) {
        var parsed;
        var restoredGroups = [];
        var group;
        var i;

        try {
            parsed = JSON.parse(serializedState);
        } catch (e1) {
            return false;
        }
        if (!parsed || !isArray(parsed.groups)) {
            return false;
        }

        for (i = 0; i < parsed.groups.length; i++) {
            group = normalizeGroup(parsed.groups[i], 'Grupa ' + (i + 1));
            if (group) {
                restoredGroups.push(group);
            }
        }

        groupUndoRestoring = true;
        scanGroups = restoredGroups;
        ensureAtLeastOneGroup();
        activeGroupId = trimText(parsed.activeGroupId || '');
        if (activeGroupId !== UNGROUPED_GROUP_ID && findGroupIndex(activeGroupId) < 0) {
            activeGroupId = scanGroups[0].id;
        }
        storageSet(STORAGE_KEY_GROUPS, JSON.stringify(scanGroups));
        saveActiveGroup();
        lastCommittedGroupState = serializeGroupUndoState();
        groupUndoRestoring = false;

        try {
            resetPendingDropZoneDelete();
            closeGroupColorPicker();
            clearDropMarker();
        } catch (e2) {}
        updateGroupSelect();
        renderGroups();
        queueLayoutUpdate();
        return true;
    }

    function undoGroupChange() {
        var currentState;
        var previousState;
        if (!groupUndoStack.length) {
            return false;
        }
        currentState = serializeGroupUndoState();
        previousState = groupUndoStack.pop();
        pushLimitedUndoState(groupRedoStack, currentState);
        if (!restoreGroupUndoState(previousState)) {
            groupUndoStack.push(previousState);
            groupRedoStack.pop();
            return false;
        }
        return true;
    }

    function redoGroupChange() {
        var currentState;
        var nextState;
        if (!groupRedoStack.length) {
            return false;
        }
        currentState = serializeGroupUndoState();
        nextState = groupRedoStack.pop();
        pushLimitedUndoState(groupUndoStack, currentState);
        if (!restoreGroupUndoState(nextState)) {
            groupRedoStack.push(nextState);
            groupUndoStack.pop();
            return false;
        }
        return true;
    }

    function undoLatestChange() {
        return undoScanHistoryClear() || undoGroupChange();
    }

    function redoLatestChange() {
        return redoScanHistoryClear() || redoGroupChange();
    }

    function hasEditableUndoText(target) {
        var tagName;
        if (!target) {
            return false;
        }
        tagName = String(target.tagName || '').toLowerCase();
        if (target.isContentEditable) {
            return trimText(target.textContent || '') !== '';
        }
        if (tagName === 'textarea') {
            return String(target.value || '') !== '';
        }
        if (tagName === 'input') {
            return String(target.type || 'text').toLowerCase() !== 'color' && String(target.value || '') !== '';
        }
        return false;
    }

    function installGroupUndoKeyboardHandler() {
        if (groupUndoHandlerInstalled) {
            return;
        }
        groupUndoHandlerInstalled = true;
        document.addEventListener('keydown', function (event) {
            var key = String(event && event.key || '').toLowerCase();
            var code = String(event && event.code || '');
            var wantsRedo;
            var changed;
            if (!event || !event.ctrlKey || event.altKey || (key !== 'z' && code !== 'KeyZ')) {
                return;
            }
            if (hasEditableUndoText(event.target)) {
                return;
            }
            wantsRedo = event.shiftKey === true;
            changed = wantsRedo ? redoLatestChange() : undoLatestChange();
            if (changed) {
                stopEvent(event);
            }
        }, true);
    }

    function findGroupIndex(groupId) {
        for (var i = 0; i < scanGroups.length; i++) {
            if (scanGroups[i].id === groupId) {
                return i;
            }
        }
        return -1;
    }

    function ensureUngroupedGroup() {
        var index = findGroupIndex(UNGROUPED_GROUP_ID);
        if (index >= 0) {
            return scanGroups[index];
        }

        var group = {
            id: UNGROUPED_GROUP_ID,
            name: '',
            collapsed: false,
            buttons: []
        };
        scanGroups.unshift(group);
        return group;
    }

    function isUngroupedGroup(group) {
        return !!group && group.id === UNGROUPED_GROUP_ID;
    }

    function findButtonIndex(group, buttonId) {
        if (!group || !group.buttons) {
            return -1;
        }
        for (var i = 0; i < group.buttons.length; i++) {
            if (group.buttons[i].id === buttonId) {
                return i;
            }
        }
        return -1;
    }

    function findGroupIndexByName(groupName) {
        var wanted = trimText(groupName).toLowerCase();
        for (var i = 0; i < scanGroups.length; i++) {
            if (trimText(scanGroups[i].name).toLowerCase() === wanted) {
                return i;
            }
        }
        return -1;
    }

    function findButtonIndexByText(group, scanText) {
        var wanted = trimText(scanText).toLowerCase();
        if (!group || !group.buttons) {
            return -1;
        }
        for (var i = 0; i < group.buttons.length; i++) {
            if (trimText(group.buttons[i].text || group.buttons[i].label || '').toLowerCase() === wanted) {
                return i;
            }
        }
        return -1;
    }

    function removeDefaultSourceButtonsFromGroups() {
        var changed = false;
        var group;
        var i;
        var b;

        for (i = 0; i < scanGroups.length; i++) {
            group = scanGroups[i];
            if (!group || !group.buttons) {
                continue;
            }
            for (b = group.buttons.length - 1; b >= 0; b--) {
                if (isDefaultSourceScan(group.buttons[b].text || group.buttons[b].label)) {
                    group.buttons.splice(b, 1);
                    changed = true;
                }
            }
        }

        return changed;
    }

    function installPresetGroupsOnce() {
        var alreadyInstalled = false;
        var changed = false;
        var p;
        var groupIndex;
        var group;
        var b;
        var button;
        var defaultIndex;

        alreadyInstalled = storageGet(STORAGE_KEY_PRESET_GROUPS_109, '') === '1';

        if (alreadyInstalled) {
            return;
        }

        for (p = 0; p < PRESET_GROUPS_109.length; p++) {
            groupIndex = findGroupIndexByName(PRESET_GROUPS_109[p].name);
            if (groupIndex < 0) {
                scanGroups.push({
                    id: makeId('grp'),
                    name: PRESET_GROUPS_109[p].name,
                    collapsed: false,
                    buttons: []
                });
                groupIndex = scanGroups.length - 1;
                changed = true;
            }

            group = scanGroups[groupIndex];
            group.collapsed = false;

            for (b = 0; b < PRESET_GROUPS_109[p].buttons.length; b++) {
                button = PRESET_GROUPS_109[p].buttons[b];
                if (!isDefaultSourceScan(button.text) && findButtonIndexByText(group, button.text) < 0) {
                    group.buttons.push({
                        id: makeId('btn'),
                        label: button.label,
                        text: button.text
                    });
                    changed = true;
                }
            }
        }

        defaultIndex = findGroupIndexByName('Default');
        if (defaultIndex >= 0 && scanGroups[defaultIndex].buttons && scanGroups[defaultIndex].buttons.length === 0 && scanGroups.length > PRESET_GROUPS_109.length) {
            scanGroups.splice(defaultIndex, 1);
            changed = true;
        }

        if (activeGroupId !== UNGROUPED_GROUP_ID && findGroupIndex(activeGroupId) < 0 && scanGroups.length) {
            activeGroupId = scanGroups[0].id;
            saveActiveGroup();
        }

        storageSet(STORAGE_KEY_PRESET_GROUPS_109, '1');

        if (changed) {
            saveGroups();
        }
    }

    function stopEvent(e) {
        if (!e) {
            return false;
        }
        if (e.preventDefault) {
            e.preventDefault();
        }
        if (e.stopPropagation) {
            e.stopPropagation();
        }
        e.cancelBubble = true;
        return false;
    }

    function getAftPageFocusTarget() {
        var activeStepId = getActiveAftStepId();
        var ids = activeStepId ? [activeStepId] : [];
        var el;
        var i;

        ids.push('scan-container', 'scan-destination-container', 'scan-source-container');
        for (i = 0; i < ids.length; i++) {
            el = getCachedElement(ids[i]);
            if (el && isVisible(el)) {
                return el;
            }
        }

        return document.querySelector('.steps-container') || getCachedElement('wrapper') || document.body || document.documentElement;
    }

    function focusAftPageTarget(target) {
        if (!target || typeof target.focus !== 'function') {
            return false;
        }
        try {
            if (target.setAttribute && !target.getAttribute('tabindex')) {
                target.setAttribute('tabindex', '-1');
            }
            target.focus({ preventScroll: true });
            return true;
        } catch (e1) {
            try {
                target.focus();
                return true;
            } catch (e2) {}
        }
        return false;
    }

    function restoreAftPageFocus() {
        var panel = getCachedElement('aft-scan-buttons-panel');
        var active = document.activeElement;
        var target = getAftPageFocusTarget();

        try {
            if (active && active.blur && panel && panel.contains(active)) {
                active.blur();
            }
        } catch (e1) {}
        try {
            window.focus();
        } catch (e2) {}
        focusAftPageTarget(target);
    }

    function queueAftPageFocusRestore() {
        window.setTimeout(restoreAftPageFocus, 0);
        window.setTimeout(restoreAftPageFocus, 90);
    }

    function submitScanSilently(text) {
        text = trimText(text);
        if (!text) {
            return false;
        }

        queueAftPageFocusRestore();

        if (isDefaultSourceScan(text)) {
            return scanDefaultSourceNow();
        }

        return submitDropZoneWithReset(text);
    }
    var USER_PROFILE_SYNC_DEBOUNCE_MS = 1200;
    var USER_PROFILE_SYNC_RETRY_MS = 30000;
    var USER_PROFILE_SYNC_REQUEST_TIMEOUT_MS = 12000;

    function isUserProfileSyncStorageKey(key) {
        return key === STORAGE_KEY_GROUPS ||
            key === STORAGE_KEY_SCAN_HISTORY ||
            key === STORAGE_KEY_DARK_MODE ||
            key === STORAGE_KEY_AGE_ALARM_VOLUME ||
            key === STORAGE_KEY_AGE_ALARM_LAST_VOLUME ||
            key === STORAGE_KEY_SCAN_SOUND_IOL ||
            key === STORAGE_KEY_SCAN_SOUND_SAFE ||
            key === STORAGE_KEY_SCAN_SOUND_MISSING ||
            key === STORAGE_KEY_WINDOW_FOCUS_INDICATOR;
    }

    function queueUserProfileSyncForStorageKey(key) {
        if (!userProfileSyncInitialized || userProfileSyncApplyingRemote || !isUserProfileSyncStorageKey(key)) {
            return;
        }
        userProfileSyncLocalVersion++;
        scheduleUserProfileSyncPush(USER_PROFILE_SYNC_DEBOUNCE_MS);
    }

    function isWindowFocusIndicatorSyncDirty() {
        return storageGet(STORAGE_KEY_WINDOW_FOCUS_INDICATOR_DIRTY, '0') === '1';
    }

    function markWindowFocusIndicatorSyncDirty() {
        storageSet(STORAGE_KEY_WINDOW_FOCUS_INDICATOR_DIRTY, '1');
    }

    function clearWindowFocusIndicatorSyncDirty() {
        storageSet(STORAGE_KEY_WINDOW_FOCUS_INDICATOR_DIRTY, '0');
    }

    function applyWindowFocusIndicatorFromUserProfile(data) {
        if (typeof data.windowFocusIndicator !== 'boolean') {
            return true;
        }
        var localEnabled = isWindowFocusIndicatorEnabled();
        if (data.windowFocusIndicator === localEnabled) {
            clearWindowFocusIndicatorSyncDirty();
            return true;
        }
        if (isWindowFocusIndicatorSyncDirty()) {
            return false;
        }
        storageSet(STORAGE_KEY_WINDOW_FOCUS_INDICATOR, data.windowFocusIndicator ? '1' : '0');
        return true;
    }

    function getEmployeeLoginForProfileSync() {
        var element = getCachedElement('username') || document.getElementById('username');
        var login = trimText(element && (element.value || element.textContent || element.getAttribute('value')));
        login = login.toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
        login = login.replace(/^[_\-.]+|[_\-.]+$/g, '');
        return login;
    }

    function parseUserProfileSyncResponse(response) {
        if (response && response.response && typeof response.response === 'object') {
            return response.response;
        }
        if (response && response.responseText) {
            try {
                return JSON.parse(response.responseText);
            } catch (e) {}
        }
        return null;
    }

    function requestUserProfileSync(method, profile, callback) {
        var url;
        if (typeof GM_xmlhttpRequest !== 'function' || !userProfileSyncLogin ||
                trimText(USER_PROFILE_SYNC_API_KEY).length < 20) {
            callback(0, null);
            return;
        }
        url = USER_PROFILE_SYNC_API_ORIGIN + '/v1/profiles/' + encodeURIComponent(userProfileSyncLogin);
        GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: {
                'Accept': 'application/json',
                'X-Sync-Key': USER_PROFILE_SYNC_API_KEY,
                'Content-Type': 'application/json'
            },
            data: profile ? JSON.stringify(profile) : undefined,
            responseType: 'json',
            timeout: USER_PROFILE_SYNC_REQUEST_TIMEOUT_MS,
            anonymous: true,
            onload: function (response) {
                callback(Number(response && response.status) || 0, parseUserProfileSyncResponse(response));
            },
            onerror: function () {
                callback(0, null);
            },
            ontimeout: function () {
                callback(0, null);
            }
        });
    }

    function normalizeUserProfileSyncGroups(sourceGroups) {
        var groups = [];
        var usedIds = {};
        var group;
        var i;
        if (!isArray(sourceGroups)) {
            return groups;
        }
        for (i = 0; i < sourceGroups.length; i++) {
            group = normalizeImportedGroup(sourceGroups[i], 'Grupa ' + (i + 1), usedIds);
            if (group) {
                groups.push(group);
            }
        }
        return groups;
    }

    function updateUserProfileSyncControls() {
        var toggles = document.querySelectorAll('[data-aft-sound-type]');
        var type;
        var i;
        updateAgeAlarmVolumeMenuControl(getAgeAlarmVolumePercent());
        updateWindowFocusIndicatorMenuControl(isWindowFocusIndicatorEnabled());
        updateWindowFocusIndicator();
        for (i = 0; i < toggles.length; i++) {
            type = toggles[i].getAttribute('data-aft-sound-type');
            toggles[i].checked = isScanResultSoundEnabled(type);
        }
    }

    function applyUserProfileSyncData(data) {
        var groups;
        var sounds;
        var volume;
        var lastVolume;
        if (!data || !isArray(data.groups)) {
            return false;
        }
        groups = normalizeUserProfileSyncGroups(data.groups);
        if (!groups.length) {
            return false;
        }
        sounds = data.sounds || {};
        volume = normalizeAgeAlarmVolumePercent(data.volume);
        lastVolume = data.lastVolume === undefined || data.lastVolume === null ?
            volume || 100 :
            normalizeAgeAlarmVolumePercent(data.lastVolume);
        if (!lastVolume) {
            lastVolume = volume || 100;
        }
        userProfileSyncApplyingRemote = true;
        try {
            scanGroups = groups;
            ensureAtLeastOneGroup();
            if (activeGroupId !== UNGROUPED_GROUP_ID && findGroupIndex(activeGroupId) < 0) {
                activeGroupId = scanGroups[0].id;
            }
            storageSet(STORAGE_KEY_GROUPS, JSON.stringify(scanGroups));
            storageSet(STORAGE_KEY_DARK_MODE, data.darkMode === true ? '1' : '0');
            storageSet(STORAGE_KEY_AGE_ALARM_VOLUME, String(volume));
            storageSet(STORAGE_KEY_AGE_ALARM_LAST_VOLUME, String(lastVolume));
            storageSet(STORAGE_KEY_SCAN_SOUND_IOL, sounds.iol === false ? '0' : '1');
            storageSet(STORAGE_KEY_SCAN_SOUND_SAFE, sounds.safe === false ? '0' : '1');
            storageSet(STORAGE_KEY_SCAN_SOUND_MISSING, sounds.missing === false ? '0' : '1');
            applyWindowFocusIndicatorFromUserProfile(data);
            if (isArray(data.history)) {
                storageSet(STORAGE_KEY_SCAN_HISTORY, JSON.stringify(data.history));
                loadScanHistory();
            }
            initializeGroupUndoHistory();
            applyDarkMode(data.darkMode === true);
            updateGroupSelect();
            renderGroups();
            if (isArray(data.history)) {
                renderScanHistory();
                resumePendingAgeRequests();
            }
            updateUserProfileSyncControls();
            queueLayoutUpdate();
        } finally {
            userProfileSyncApplyingRemote = false;
        }
        return true;
    }

    function buildUserProfileSyncDocument() {
        return {
            schemaVersion: 2,
            login: userProfileSyncLogin,
            revision: userProfileSyncRemoteRevision + 1,
            updatedAt: new Date().toISOString(),
            data: {
                groups: JSON.parse(JSON.stringify(scanGroups)),
                history: JSON.parse(JSON.stringify(scanHistoryEntries)),
                darkMode: storageGet(STORAGE_KEY_DARK_MODE, '') === '1',
                windowFocusIndicator: isWindowFocusIndicatorEnabled(),
                volume: getAgeAlarmVolumePercent(),
                lastVolume: getLastUnmutedAgeAlarmVolumePercent(),
                sounds: {
                    iol: storageGet(STORAGE_KEY_SCAN_SOUND_IOL, '1') !== '0',
                    safe: storageGet(STORAGE_KEY_SCAN_SOUND_SAFE, '1') !== '0',
                    missing: storageGet(STORAGE_KEY_SCAN_SOUND_MISSING, '1') !== '0'
                }
            }
        };
    }

    function scheduleUserProfileSyncRetry(callback) {
        if (userProfileSyncRetryTimer) {
            window.clearTimeout(userProfileSyncRetryTimer);
        }
        userProfileSyncRetryTimer = window.setTimeout(function () {
            userProfileSyncRetryTimer = null;
            callback();
        }, USER_PROFILE_SYNC_RETRY_MS);
    }

    function scheduleUserProfileSyncPush(delay) {
        userProfileSyncPushPending = true;
        if (userProfileSyncPushTimer) {
            window.clearTimeout(userProfileSyncPushTimer);
        }
        userProfileSyncPushTimer = window.setTimeout(function () {
            userProfileSyncPushTimer = null;
            pushUserProfileSync();
        }, Math.max(0, Number(delay) || 0));
    }

    function pushUserProfileSync() {
        var profile;
        if (!userProfileSyncInitialized || userProfileSyncRequestActive) {
            userProfileSyncPushPending = true;
            return;
        }
        userProfileSyncPushPending = false;
        userProfileSyncRequestActive = true;
        profile = buildUserProfileSyncDocument();
        requestUserProfileSync('PUT', profile, function (status, response) {
            userProfileSyncRequestActive = false;
            if (status === 200 || status === 201) {
                userProfileSyncRemoteRevision = Math.max(0, Number(response && response.profile && response.profile.revision) || profile.revision);
                if (userProfileSyncPushPending) {
                    scheduleUserProfileSyncPush(USER_PROFILE_SYNC_DEBOUNCE_MS);
                }
                return;
            }
            if (status === 409) {
                pullUserProfileSync(true);
                return;
            }
            userProfileSyncPushPending = true;
            scheduleUserProfileSyncRetry(pushUserProfileSync);
        });
    }

    function pullUserProfileSync(preserveLocal) {
        var localVersionAtStart;
        if (!userProfileSyncInitialized || userProfileSyncRequestActive) {
            return;
        }
        localVersionAtStart = userProfileSyncLocalVersion;
        userProfileSyncRequestActive = true;
        requestUserProfileSync('GET', null, function (status, response) {
            var profile;
            userProfileSyncRequestActive = false;
            if (status === 404) {
                userProfileSyncRemoteRevision = 0;
                scheduleUserProfileSyncPush(0);
                return;
            }
            if (status < 200 || status >= 300 || !response || !response.profile) {
                scheduleUserProfileSyncRetry(function () {
                    pullUserProfileSync(preserveLocal);
                });
                return;
            }
            profile = response.profile;
            userProfileSyncRemoteRevision = Math.max(0, Number(profile && profile.revision) || 0);
            if (preserveLocal || userProfileSyncLocalVersion !== localVersionAtStart) {
                scheduleUserProfileSyncPush(0);
                return;
            }
            if (!profile || (profile.schemaVersion !== 1 && profile.schemaVersion !== 2) ||
                    profile.login !== userProfileSyncLogin ||
                    !applyUserProfileSyncData(profile.data)) {
                return;
            }
            if (isWindowFocusIndicatorSyncDirty()) {
                scheduleUserProfileSyncPush(0);
                return;
            }
            if (profile.schemaVersion < 2 || !isArray(profile.data.history)) {
                scheduleUserProfileSyncPush(0);
                return;
            }
            if (userProfileSyncPushPending) {
                scheduleUserProfileSyncPush(USER_PROFILE_SYNC_DEBOUNCE_MS);
            }
        });
    }

    function initializeUserProfileSync(attempt) {
        attempt = Number(attempt) || 0;
        if (userProfileSyncInitialized || trimText(USER_PROFILE_SYNC_API_KEY).length < 20) {
            return;
        }
        userProfileSyncLogin = getEmployeeLoginForProfileSync();
        if (!userProfileSyncLogin) {
            if (attempt < 80) {
                window.setTimeout(function () {
                    initializeUserProfileSync(attempt + 1);
                }, 250);
            }
            return;
        }
        userProfileSyncInitialized = true;
        pullUserProfileSync(false);
    }
    function activateAgeDropZone(buttonId, dropZoneText, dropZoneLabel) {
        activeAgeButtonId = trimText(buttonId);
        activeAgeDropZoneText = trimText(dropZoneText);
        activeAgeDropZoneLabel = trimText(dropZoneLabel) || activeAgeDropZoneText;
        lastAgeScanSignature = '';
        suppressLatestAgeDisplay = true;
        updateActiveAgeDropZoneRows();
        updateLatestAgeOverlayPosition();
    }

    function updateActiveAgeDropZoneRows() {
        var rows = document.querySelectorAll('.aft-scan-button-row[data-button-id]');
        var activeText = trimText(activeAgeDropZoneText).toLowerCase();
        var rowText;
        var i;
        for (i = 0; i < rows.length; i++) {
            rowText = trimText(rows[i].getAttribute('data-drop-zone-text')).toLowerCase();
            rows[i].classList.toggle('aft-scan-button-active',
                !!activeText && rowText === activeText);
        }
    }

    function findAgeDropZoneButton(dropZoneText) {
        var wanted = trimText(dropZoneText).toLowerCase();
        var group;
        var button;
        var i;
        var j;
        if (!wanted) {
            return null;
        }
        for (i = 0; i < scanGroups.length; i++) {
            group = scanGroups[i];
            if (!group || !group.buttons) {
                continue;
            }
            for (j = 0; j < group.buttons.length; j++) {
                button = group.buttons[j];
                if (trimText(button && (button.text || button.label)).toLowerCase() === wanted) {
                    return button;
                }
            }
        }
        return null;
    }

    function activateAgeDropZoneForScanText(dropZoneText) {
        var normalizedText = trimText(dropZoneText);
        var button;
        var buttonId;
        var label;
        if (!normalizedText) {
            return false;
        }
        button = findAgeDropZoneButton(normalizedText);
        buttonId = button && button.id ? button.id : 'manual:' + normalizedText.toLowerCase();
        label = button ? trimText(button.label || button.text) : normalizedText;
        activateAgeDropZone(buttonId, normalizedText, label);
        return !!button;
    }

    function syncAgeDropZoneFromAftSession(expectedDropZoneText) {
        var session = getAftSession();
        var destinationId = trimText(session && session.destinationScannableId);
        var expected = trimText(expectedDropZoneText);
        if (!destinationId || (expected && destinationId.toLowerCase() !== expected.toLowerCase())) {
            return false;
        }
        if (activeAgeButtonId && activeAgeDropZoneText &&
                activeAgeDropZoneText.toLowerCase() === destinationId.toLowerCase()) {
            return true;
        }
        activateAgeDropZoneForScanText(destinationId);
        return true;
    }

    function normalizeScanHistoryEntry(item) {
        var timestamp;
        var ageMilliseconds;
        var status;
        var ageText;
        var totalQuantity;
        if (!item || !trimText(item.containerId) || !trimText(item.dropZoneText)) {
            return null;
        }
        timestamp = Number(item.scannedAt);
        if (!isFinite(timestamp) || timestamp <= 0) {
            timestamp = now();
        }
        ageMilliseconds = item.ageMilliseconds === null || item.ageMilliseconds === undefined ? null : Number(item.ageMilliseconds);
        if (ageMilliseconds !== null && (!isFinite(ageMilliseconds) || ageMilliseconds < 0)) {
            ageMilliseconds = null;
        }
        totalQuantity = normalizeTotalQuantity(item.totalQuantity);
        status = trimText(item.status) || 'error';
        ageText = ageMilliseconds !== null ? formatContainerAge(ageMilliseconds) : (trimText(item.ageText) || 'Not completed');
        if (status === 'missing' || (status === 'ready' && ageMilliseconds === null) ||
                ageText === 'Brak wieku' || ageText === 'Pusty kontener' ||
                ageText === 'Nie znaleziono' || ageText === 'Not found' || ageText === EMPTY_CONTAINER_TEXT) {
            status = 'missing';
            ageText = EMPTY_CONTAINER_TEXT;
            ageMilliseconds = null;
            totalQuantity = 0;
        }
        return {
            id: trimText(item.id) || ('scan_' + timestamp + '_' + (++scanHistoryEntrySequence)),
            buttonId: trimText(item.buttonId),
            containerId: trimText(item.containerId),
            dropZoneText: trimText(item.dropZoneText),
            dropZoneLabel: trimText(item.dropZoneLabel) || trimText(item.dropZoneText),
            scannedAt: timestamp,
            status: status,
            ageMilliseconds: ageMilliseconds,
            ageText: ageText,
            totalQuantity: totalQuantity
        };
    }

    function loadScanHistory() {
        var stored = storageGetJson(STORAGE_KEY_SCAN_HISTORY, []);
        var normalized;
        var entryKey;
        var seenKeys = {};
        var changed = false;
        var i;
        scanHistoryEntries = [];
        if (!stored || typeof stored.length !== 'number') {
            return;
        }
        for (i = 0; i < stored.length; i++) {
            normalized = normalizeScanHistoryEntry(stored[i]);
            if (!normalized) {
                changed = true;
                continue;
            }
            entryKey = '$' + normalized.containerId;
            if (seenKeys[entryKey]) {
                changed = true;
                continue;
            }
            seenKeys[entryKey] = true;
            scanHistoryEntries.push(normalized);
        }
        if (changed) {
            saveScanHistory();
        }
    }

    function saveScanHistory() {
        storageSet(STORAGE_KEY_SCAN_HISTORY, JSON.stringify(scanHistoryEntries));
    }

    function formatContainerAge(milliseconds) {
        var totalMinutes = Math.floor(Number(milliseconds) / 60000);
        var days;
        var hours;
        var minutes;

        if (!isFinite(totalMinutes) || totalMinutes < 0) {
            return EMPTY_CONTAINER_TEXT;
        }

        days = Math.floor(totalMinutes / 1440);
        hours = Math.floor((totalMinutes % 1440) / 60);
        minutes = totalMinutes % 60;
        return days + 'd ' + hours + 'h ' + minutes + 'm';
    }

    function normalizeTotalQuantity(value) {
        var quantity;
        if (value === null || value === undefined || value === '') {
            return null;
        }
        quantity = Number(value);
        if (!isFinite(quantity) || quantity < 0) {
            return null;
        }
        return Math.round(quantity);
    }

    function getShiftAgeLimitMilliseconds(scannedAt) {
        var scanned = new Date(Number(scannedAt));
        var shiftStart = new Date(Number(scannedAt));
        var minuteOfDay;
        if (!isFinite(scanned.getTime())) {
            scanned = new Date(now());
            shiftStart = new Date(scanned.getTime());
        }
        minuteOfDay = scanned.getHours() * 60 + scanned.getMinutes();
        if (minuteOfDay >= NIGHT_SHIFT_START_MINUTES) {
            shiftStart.setHours(17, 30, 0, 0);
        } else if (minuteOfDay >= DAY_SHIFT_START_MINUTES) {
            shiftStart.setHours(6, 0, 0, 0);
        } else {
            shiftStart.setDate(shiftStart.getDate() - 1);
            shiftStart.setHours(17, 30, 0, 0);
        }
        return BASE_AGE_LIMIT_MS + Math.max(0, scanned.getTime() - shiftStart.getTime());
    }

    function isScanHistoryEntryOverAgeLimit(entry) {
        return !!(entry && entry.status === 'ready' && isFinite(Number(entry.ageMilliseconds)) &&
            Number(entry.ageMilliseconds) >= getShiftAgeLimitMilliseconds(entry.scannedAt));
    }

    function isNativeAftSoundUrl(value) {
        return /\/audio\/(?:activation|confirmation|exception|scan)\.wav(?:[?#]|$)/i.test(trimText(value));
    }

    function silenceNativeAftSoundElement(element) {
        if (!element || !isNativeAftSoundUrl(element.currentSrc || element.src)) {
            return false;
        }
        try {
            element.muted = true;
            element.volume = 0;
            element.pause();
        } catch (e) {}
        return true;
    }

    function silenceNativeAftSoundApi() {
        var audio;
        try {
            audio = PAGE_WINDOW.aft && PAGE_WINDOW.aft.audio;
            if (!audio) {
                return false;
            }
            if (!audio.doPlay || !audio.doPlay.__aftNativeSoundBlockerInstalled) {
                audio.doPlay = function () {};
                audio.doPlay.__aftNativeSoundBlockerInstalled = true;
            }
            audio.isPlaying = false;
            return true;
        } catch (e) {
            return false;
        }
    }

    function installNativeAftSoundBlocker() {
        var MediaElementClass;
        var prototype;
        var originalPlay;
        var existing;
        var i;
        silenceNativeAftSoundApi();
        if (nativeAftSoundBlockerInstalled) {
            return;
        }
        try {
            MediaElementClass = PAGE_WINDOW.HTMLMediaElement;
            prototype = MediaElementClass && MediaElementClass.prototype;
            if (!prototype || typeof prototype.play !== 'function') {
                return;
            }
            if (!prototype.__aftNativeSoundBlockerInstalled) {
                originalPlay = prototype.play;
                prototype.play = function () {
                    if (silenceNativeAftSoundElement(this)) {
                        return Promise.resolve();
                    }
                    return originalPlay.apply(this, arguments);
                };
                prototype.__aftNativeSoundBlockerInstalled = true;
            }
            nativeAftSoundBlockerInstalled = true;
            existing = document.querySelectorAll('audio');
            for (i = 0; i < existing.length; i++) {
                silenceNativeAftSoundElement(existing[i]);
            }
        } catch (e) {}
    }

    function normalizeAgeAlarmVolumePercent(value) {
        value = Number(value);
        if (!isFinite(value)) {
            value = 100;
        }
        return Math.max(0, Math.min(100, Math.round(value)));
    }

    function getAgeAlarmVolumePercent() {
        return normalizeAgeAlarmVolumePercent(storageGet(STORAGE_KEY_AGE_ALARM_VOLUME, 100));
    }

    function getLastUnmutedAgeAlarmVolumePercent() {
        var value = normalizeAgeAlarmVolumePercent(storageGet(STORAGE_KEY_AGE_ALARM_LAST_VOLUME, 100));
        return value || 100;
    }

    function getScanResultSoundStorageKey(soundType) {
        if (soundType === 'iol') {
            return STORAGE_KEY_SCAN_SOUND_IOL;
        }
        if (soundType === 'safe') {
            return STORAGE_KEY_SCAN_SOUND_SAFE;
        }
        return STORAGE_KEY_SCAN_SOUND_MISSING;
    }

    function isScanResultSoundEnabled(soundType) {
        return storageGet(getScanResultSoundStorageKey(soundType), '1') !== '0';
    }

    function setScanResultSoundEnabled(soundType, enabled) {
        storageSet(getScanResultSoundStorageKey(soundType), enabled ? '1' : '0');
    }

    function getAgeAlarmAudioContext() {
        var AudioContextClass;
        if (ageAlarmAudioContext && ageAlarmAudioContext.state !== 'closed') {
            return ageAlarmAudioContext;
        }
        try {
            AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                return null;
            }
            ageAlarmAudioContext = new AudioContextClass();
        } catch (e) {
            ageAlarmAudioContext = null;
        }
        return ageAlarmAudioContext;
    }

    function unlockAgeAlarmAudio() {
        var context = getAgeAlarmAudioContext();
        if (!context || context.state !== 'suspended' || typeof context.resume !== 'function') {
            return;
        }
        try {
            context.resume();
        } catch (e) {}
    }

    function installAgeAlarmAudioUnlock() {
        if (ageAlarmUnlockInstalled) {
            return;
        }
        ageAlarmUnlockInstalled = true;
        document.addEventListener('pointerdown', unlockAgeAlarmAudio, true);
        document.addEventListener('keydown', unlockAgeAlarmAudio, true);
    }

    function getScanResultSoundPattern(soundType) {
        if (soundType === 'safe') {
            return [[523, 0, 0.18, 0.14], [659, 0.055, 0.21, 0.12]];
        }
        if (soundType === 'missing') {
            return [[392, 0, 0.18, 0.15], [330, 0.08, 0.21, 0.145]];
        }
        return [[587, 0, 0.12, 0.15], [466, 0.085, 0.12, 0.16], [587, 0.17, 0.17, 0.15]];
    }

    function getAuroraAudioOutput(context) {
        var compressor;
        var reverb;
        var wet;
        var impulse;
        var data;
        var channel;
        var i;
        var seed;
        if (ageAlarmAudioOutput && ageAlarmAudioOutput.context === context) {
            return ageAlarmAudioOutput;
        }
        compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 16;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.002;
        compressor.release.value = 0.12;
        compressor.connect(context.destination);
        reverb = context.createConvolver();
        impulse = context.createBuffer(2, Math.round(context.sampleRate * 0.25), context.sampleRate);
        for (channel = 0; channel < impulse.numberOfChannels; channel++) {
            data = impulse.getChannelData(channel);
            seed = 7919 + channel * 104729;
            for (i = 0; i < data.length; i++) {
                seed = (seed * 16807) % 2147483647;
                data[i] = (seed / 1073741823.5 - 1) * Math.pow(1 - i / data.length, 4.5);
            }
        }
        reverb.buffer = impulse;
        wet = context.createGain();
        wet.gain.value = 0.16;
        reverb.connect(wet);
        wet.connect(compressor);
        ageAlarmAudioOutput = { context: context, dry: compressor, reverb: reverb };
        return ageAlarmAudioOutput;
    }

    function scheduleAuroraVoice(context, output, voice, volumeGain) {
        var startAt = context.currentTime + 0.035 + voice[1];
        var stopAt = startAt + voice[2];
        var peak = Math.min(1, voice[3] * volumeGain * (10 / 3));
        var oscillator = context.createOscillator();
        var overtone = context.createOscillator();
        var filter = context.createBiquadFilter();
        var gain = context.createGain();
        var overtoneGain = context.createGain();
        oscillator.type = 'triangle';
        overtone.type = 'sine';
        oscillator.frequency.setValueAtTime(voice[0], startAt);
        overtone.frequency.setValueAtTime(voice[0] * 1.5, startAt);
        filter.type = 'lowpass';
        filter.frequency.value = 2600;
        filter.Q.value = 0.6;
        overtoneGain.gain.value = 0.16;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
        oscillator.connect(filter);
        overtone.connect(overtoneGain);
        overtoneGain.connect(filter);
        filter.connect(gain);
        gain.connect(output.dry);
        gain.connect(output.reverb);
        oscillator.start(startAt);
        overtone.start(startAt);
        oscillator.stop(stopAt + 0.02);
        overtone.stop(stopAt + 0.02);
    }

    function scheduleScanResultSound(context, soundType) {
        var voices = getScanResultSoundPattern(soundType);
        var volumeGain = getAgeAlarmVolumePercent() / 100;
        var output;
        var i;
        if (volumeGain <= 0) {
            return;
        }
        output = getAuroraAudioOutput(context);
        for (i = 0; i < voices.length; i++) {
            scheduleAuroraVoice(context, output, voices[i], volumeGain);
        }
    }

    function getScanResultSoundType(entry) {
        if (!entry) {
            return '';
        }
        if (entry.status === 'missing') {
            return 'missing';
        }
        if (entry.status === 'ready') {
            return isScanHistoryEntryOverAgeLimit(entry) ? 'iol' : 'safe';
        }
        return '';
    }

    function playScanResultSound(entry) {
        var context;
        var resumeResult;
        var soundType = getScanResultSoundType(entry);
        if (!soundType || entry.id === lastScanResultSoundEntryId) {
            return;
        }
        lastScanResultSoundEntryId = entry.id;
        if (!isScanResultSoundEnabled(soundType)) {
            return;
        }
        context = getAgeAlarmAudioContext();
        if (!context) {
            return;
        }
        try {
            if (context.state === 'suspended' && typeof context.resume === 'function') {
                resumeResult = context.resume();
                if (resumeResult && typeof resumeResult.then === 'function') {
                    resumeResult.then(function () {
                        scheduleScanResultSound(context, soundType);
                    }, function () {});
                    return;
                }
            }
            scheduleScanResultSound(context, soundType);
        } catch (e) {}
    }

    function findScanHistoryEntry(entryId) {
        var i;
        for (i = 0; i < scanHistoryEntries.length; i++) {
            if (scanHistoryEntries[i].id === entryId) {
                return scanHistoryEntries[i];
            }
        }
        return null;
    }

    function padScanHistoryNumber(value) {
        value = Number(value);
        return value < 10 ? '0' + value : String(value);
    }

    function formatScanHistoryDate(timestamp) {
        var date = new Date(Number(timestamp));
        if (isNaN(date.getTime())) {
            return '';
        }
        return padScanHistoryNumber(date.getDate()) + '.' +
            padScanHistoryNumber(date.getMonth() + 1) + '.' + date.getFullYear();
    }

    function formatScanHistoryClock(timestamp) {
        var date = new Date(Number(timestamp));
        if (isNaN(date.getTime())) {
            return '';
        }
        return padScanHistoryNumber(date.getHours()) + ':' + padScanHistoryNumber(date.getMinutes());
    }

    function formatScanHistoryTime(timestamp) {
        return formatScanHistoryDate(timestamp) + ' \u00B7 ' + formatScanHistoryClock(timestamp);
    }

    function appendScanHistoryCell(row, className, text, title) {
        var cell = document.createElement('div');
        cell.className = className;
        cell.textContent = text;
        cell.title = title || text;
        row.appendChild(cell);
    }

    function getPeculiarOverviewUrl(containerId) {
        return INVENTORY_API_ORIGIN + '/' + encodeURIComponent(INVENTORY_WAREHOUSE_ID) + '/overview#' +
            encodeURIComponent(PECULIAR_CONTAINER_HASH_KEY) + '=' + encodeURIComponent(trimText(containerId));
    }

    function getFcResearchContainerUrl(containerId) {
        return FC_RESEARCH_RESULTS_URL + encodeURIComponent(trimText(containerId));
    }

    function createScanHistoryContainerLink(label, title, href, serviceName) {
        var link = document.createElement('a');
        link.className = 'aft-scan-history-container-link aft-scan-history-container-link-' +
            serviceName.toLowerCase();
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = label;
        link.title = title;
        link.setAttribute('aria-label', title);
        link.addEventListener('click', function (event) {
            event.stopPropagation();
        });
        return link;
    }

    function createScanHistoryContainerCopyButton(containerId) {
        var button = document.createElement('button');
        var normalizedContainerId = trimText(containerId);
        var copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg>';
        var copiedIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
        button.type = 'button';
        button.className = 'aft-scan-history-container-link aft-scan-history-container-copy';
        button.title = 'Kopiuj kontener';
        button.setAttribute('aria-label', 'Kopiuj kontener');
        button.innerHTML = copyIcon;
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            GM_setClipboard(normalizedContainerId, 'text');
            if (button.__aftCopyFeedbackTimer) {
                window.clearTimeout(button.__aftCopyFeedbackTimer);
            }
            button.classList.remove('aft-scan-history-container-copy-confirmed');
            try {
                void button.offsetWidth;
            } catch (e) {}
            button.classList.add('aft-scan-history-container-copy-confirmed');
            button.innerHTML = copiedIcon;
            button.title = 'Skopiowano';
            button.setAttribute('aria-label', 'Skopiowano');
            button.__aftCopyFeedbackTimer = window.setTimeout(function () {
                button.classList.remove('aft-scan-history-container-copy-confirmed');
                button.innerHTML = copyIcon;
                button.title = 'Kopiuj kontener';
                button.setAttribute('aria-label', 'Kopiuj kontener');
                button.__aftCopyFeedbackTimer = null;
            }, 900);
        });
        return button;
    }

    function appendScanHistoryContainerCell(row, containerId) {
        var cell = document.createElement('div');
        var value = document.createElement('span');
        var links = document.createElement('span');
        var normalizedContainerId = trimText(containerId);
        cell.className = 'aft-scan-history-container';
        cell.title = normalizedContainerId;
        value.className = 'aft-scan-history-container-id';
        value.textContent = normalizedContainerId;
        links.className = 'aft-scan-history-container-links';
        links.appendChild(createScanHistoryContainerCopyButton(normalizedContainerId));
        links.appendChild(createScanHistoryContainerLink(
            'P',
            'Otw\u00f3rz Peculiar',
            getPeculiarOverviewUrl(normalizedContainerId),
            'peculiar'
        ));
        links.appendChild(createScanHistoryContainerLink(
            'F',
            'Otw\u00f3rz kontener w FCResearch',
            getFcResearchContainerUrl(normalizedContainerId),
            'fcresearch'
        ));
        cell.appendChild(value);
        cell.appendChild(links);
        row.appendChild(cell);
    }

    function getScanHistoryDestination(entry) {
        var destination = entry.dropZoneLabel;
        if (entry.dropZoneLabel.toLowerCase() !== entry.dropZoneText.toLowerCase()) {
            destination += ' \u00B7 ' + entry.dropZoneText;
        }
        return destination;
    }

    function getScanHistoryDateFilterValue(timestamp) {
        var date = new Date(Number(timestamp));
        if (isNaN(date.getTime())) {
            return '';
        }
        return date.getFullYear() + '-' + padScanHistoryNumber(date.getMonth() + 1) + '-' +
            padScanHistoryNumber(date.getDate());
    }

    function hasActiveScanHistoryFilters() {
        return !!(scanHistoryFilters.dateFrom || scanHistoryFilters.dateTo ||
            trimText(scanHistoryFilters.dropZone) || trimText(scanHistoryFilters.container) ||
            scanHistoryFilters.ageState !== 'all' || trimText(scanHistoryFilters.quantityMin) ||
            trimText(scanHistoryFilters.quantityMax));
    }

    function scanHistoryEntryMatchesFilters(entry) {
        var entryDate = getScanHistoryDateFilterValue(entry.scannedAt);
        var destination = getScanHistoryDestination(entry).toLowerCase();
        var container = trimText(entry.containerId).toLowerCase();
        var state = scanHistoryFilters.ageState;
        var quantity = entry.status === 'missing' ? 0 : normalizeTotalQuantity(entry.totalQuantity);
        var quantityMin = trimText(scanHistoryFilters.quantityMin);
        var quantityMax = trimText(scanHistoryFilters.quantityMax);

        if (scanHistoryFilters.dateFrom && entryDate < scanHistoryFilters.dateFrom) {
            return false;
        }
        if (scanHistoryFilters.dateTo && entryDate > scanHistoryFilters.dateTo) {
            return false;
        }
        if (trimText(scanHistoryFilters.dropZone) &&
                destination.indexOf(trimText(scanHistoryFilters.dropZone).toLowerCase()) === -1) {
            return false;
        }
        if (trimText(scanHistoryFilters.container) &&
                container.indexOf(trimText(scanHistoryFilters.container).toLowerCase()) === -1) {
            return false;
        }
        if (state === 'no' && isScanHistoryEntryOverAgeLimit(entry)) {
            return false;
        }
        if (state === 'yes' && !isScanHistoryEntryOverAgeLimit(entry)) {
            return false;
        }
        if (quantityMin && (quantity === null || quantity < Number(quantityMin))) {
            return false;
        }
        if (quantityMax && (quantity === null || quantity > Number(quantityMax))) {
            return false;
        }
        return true;
    }

    function getScanHistorySortValue(entry, column) {
        if (column === 'time') {
            return Number(entry.scannedAt);
        }
        if (column === 'dropZone') {
            return getScanHistoryDestination(entry).toLowerCase();
        }
        if (column === 'container') {
            return trimText(entry.containerId).toLowerCase();
        }
        if (column === 'age') {
            return entry.ageMilliseconds === null ? null : Number(entry.ageMilliseconds);
        }
        if (column === 'quantity') {
            return entry.status === 'missing' ? 0 : normalizeTotalQuantity(entry.totalQuantity);
        }
        return '';
    }

    function sortScanHistoryEntries(entries) {
        var direction = scanHistorySortDirection === 'asc' ? 1 : -1;
        return entries.map(function (entry, index) {
            return { entry: entry, index: index };
        }).sort(function (left, right) {
            var a = getScanHistorySortValue(left.entry, scanHistorySortColumn);
            var b = getScanHistorySortValue(right.entry, scanHistorySortColumn);
            var compared;
            if (a === null && b !== null) {
                return 1;
            }
            if (a !== null && b === null) {
                return -1;
            }
            if (typeof a === 'string' || typeof b === 'string') {
                compared = String(a).localeCompare(String(b));
            } else {
                compared = Number(a) - Number(b);
            }
            return compared ? compared * direction : left.index - right.index;
        }).map(function (item) {
            return item.entry;
        });
    }

    function createScanHistoryColumnHeader(columns, column, label) {
        var cell = document.createElement('div');
        var button = document.createElement('button');
        var labelElement = document.createElement('span');
        var indicator = document.createElement('span');
        var active = scanHistorySortColumn === column;
        cell.className = 'aft-scan-history-column aft-scan-history-column-' + column;
        if (active) {
            cell.className += ' aft-scan-history-column-active';
        }
        cell.setAttribute('role', 'columnheader');
        if (active) {
            cell.setAttribute('aria-sort', scanHistorySortDirection === 'asc' ? 'ascending' : 'descending');
        }
        button.type = 'button';
        button.className = 'aft-scan-history-sort-button' + (active ? ' aft-scan-history-sort-active' : '');
        button.setAttribute('data-scan-history-sort', column);
        button.title = 'Sortuj kolumn\u0119: ' + label;
        labelElement.className = 'aft-scan-history-column-label';
        labelElement.textContent = label;
        indicator.className = 'aft-scan-history-sort-indicator' +
            (active && scanHistorySortDirection === 'desc' ? ' aft-scan-history-sort-desc' : '');
        indicator.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5L6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        button.appendChild(labelElement);
        button.appendChild(indicator);
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (scanHistorySortColumn === column) {
                scanHistorySortDirection = scanHistorySortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                scanHistorySortColumn = column;
                scanHistorySortDirection = column === 'time' ? 'desc' : 'asc';
            }
            renderScanHistory();
        });
        cell.appendChild(button);
        columns.appendChild(cell);
    }

    function createScanHistoryRow(entry) {
        var row = document.createElement('div');
        var quantityText;
        row.className = 'aft-scan-history-row aft-scan-history-' + entry.status;
        if (entry.status === 'ready') {
            row.classList.add(isScanHistoryEntryOverAgeLimit(entry) ?
                'aft-scan-history-age-overdue' : 'aft-scan-history-age-safe');
        }
        row.setAttribute('data-scan-history-id', entry.id);
        appendScanHistoryCell(row, 'aft-scan-history-time', formatScanHistoryTime(entry.scannedAt));
        appendScanHistoryCell(row, 'aft-scan-history-destination', getScanHistoryDestination(entry));
        appendScanHistoryContainerCell(row, entry.containerId);
        appendScanHistoryCell(row, 'aft-scan-history-age', entry.ageText);
        quantityText = entry.status === 'missing' ? 0 : normalizeTotalQuantity(entry.totalQuantity);
        appendScanHistoryCell(row, 'aft-scan-history-quantity', quantityText === null ? '--' : String(quantityText));
        return row;
    }

    function updateScanHistorySummary(visibleCount) {
        var count = getCachedElement('aft-scan-history-count');
        var exportBtn = getCachedElement('aft-scan-history-export');
        var resetBtn = getCachedElement('aft-scan-history-reset');
        if (count) {
            count.textContent = String(hasActiveScanHistoryFilters() ? visibleCount : scanHistoryEntries.length);
        }
        updateScanHistoryFilterButton();
        if (exportBtn) {
            exportBtn.disabled = !scanHistoryEntries.length;
        }
        if (resetBtn) {
            resetBtn.disabled = !scanHistoryEntries.length;
        }
        updateLatestAgeOverlay();
    }

    function renderSingleScanHistoryEntry(entryId, isNewEntry) {
        var list = getCachedElement('aft-scan-history-list');
        var entry = findScanHistoryEntry(entryId);
        var columns;
        var existingRow;
        var rows;
        var i;
        var rowId;
        var row;
        if (!list || !entry || hasActiveScanHistoryFilters() ||
                (isNewEntry && (scanHistorySortColumn !== 'time' || scanHistorySortDirection !== 'desc')) ||
                (!isNewEntry && (scanHistorySortColumn === 'age' || scanHistorySortColumn === 'quantity'))) {
            renderScanHistory();
            return;
        }

        columns = list.querySelector('.aft-scan-history-columns');
        if (!columns) {
            renderScanHistory();
            return;
        }

        rows = list.querySelectorAll('[data-scan-history-id]');
        for (i = rows.length - 1; i >= 0; i--) {
            rowId = rows[i].getAttribute('data-scan-history-id');
            if (!findScanHistoryEntry(rowId)) {
                rows[i].parentNode.removeChild(rows[i]);
            }
        }

        row = createScanHistoryRow(entry);
        existingRow = list.querySelector('[data-scan-history-id="' + entryId + '"]');
        if (existingRow && existingRow.parentNode) {
            existingRow.parentNode.replaceChild(row, existingRow);
        } else if (isNewEntry) {
            list.insertBefore(row, columns.nextSibling);
        } else {
            renderScanHistory();
            return;
        }
        updateScanHistorySummary(scanHistoryEntries.length);
    }

    function createLatestAgeOverlay() {
        var target = getCachedElement('scan-container');
        var overlay = getCachedElement('aft-latest-container-age');
        var ageBox = getCachedElement('aft-latest-age-box');
        var quantityBox = getCachedElement('aft-latest-quantity-box');
        var stepsContainer = document.querySelector('.steps-container');
        var targetStyle;
        var containerValue;
        var ageValue;
        var quantityValue;

        if (!target) {
            return null;
        }

        try {
            targetStyle = window.getComputedStyle(target);
            if (!targetStyle || targetStyle.position === 'static') {
                target.style.position = 'relative';
            }
        } catch (e) {
            target.style.position = 'relative';
        }

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'aft-latest-container-age';
            overlay.className = 'aft-latest-age-overlay';
            overlay.setAttribute('aria-live', 'polite');
            overlay.style.display = 'none';

            containerValue = document.createElement('div');
            containerValue.className = 'aft-latest-container-id';
            overlay.appendChild(containerValue);
            cachedElements[overlay.id] = overlay;
        }
        if (overlay.parentNode !== target) {
            target.appendChild(overlay);
        }

        if (!ageBox) {
            ageBox = document.createElement('div');
            ageBox.id = 'aft-latest-age-box';
            ageBox.className = 'aft-latest-age-box aft-latest-age-empty';
            ageBox.setAttribute('aria-live', 'polite');
            ageValue = document.createElement('div');
            ageValue.className = 'aft-latest-container-age-value';
            ageValue.textContent = '';
            ageBox.appendChild(ageValue);
            cachedElements[ageBox.id] = ageBox;
        }
        if (!quantityBox) {
            quantityBox = document.createElement('div');
            quantityBox.id = 'aft-latest-quantity-box';
            quantityBox.className = 'aft-latest-quantity-box aft-latest-age-empty';
            quantityBox.setAttribute('aria-live', 'polite');
            quantityValue = document.createElement('div');
            quantityValue.className = 'aft-latest-container-quantity-value';
            quantityValue.textContent = '';
            quantityBox.appendChild(quantityValue);
            cachedElements[quantityBox.id] = quantityBox;
        }
        if (stepsContainer && ageBox.parentNode !== stepsContainer) {
            if (target.nextSibling) {
                stepsContainer.insertBefore(ageBox, target.nextSibling);
            } else {
                stepsContainer.appendChild(ageBox);
            }
        }
        if (stepsContainer && quantityBox.parentNode !== stepsContainer) {
            if (ageBox.nextSibling) {
                stepsContainer.insertBefore(quantityBox, ageBox.nextSibling);
            } else {
                stepsContainer.appendChild(quantityBox);
            }
        }
        return overlay;
    }

    function updateLatestAgeOverlayPosition() {
        var overlay = createLatestAgeOverlay();
        var target = getCachedElement('scan-container');
        var ageBox = getCachedElement('aft-latest-age-box');
        var quantityBox = getCachedElement('aft-latest-quantity-box');
        var session = getAftSession();
        var sourceId = trimText(session && session.sourceScannableId);
        var destinationId = trimText(session && session.destinationScannableId);
        var entry = scanHistoryEntries.length ? scanHistoryEntries[0] : null;
        var hasCurrentDropZone = !!(activeAgeButtonId && activeAgeDropZoneText && destinationId &&
            activeAgeDropZoneText.toLowerCase() === destinationId.toLowerCase());
        var entryMatchesDropZone = !!(entry && destinationId &&
            trimText(entry.dropZoneText).toLowerCase() === destinationId.toLowerCase());
        var containerValue;
        var ageValue;
        var quantityValue;
        var ageText = '';
        var quantityText = '';
        var className;
        var height;
        var ageSize;
        var availableWidth;
        var requiredWidth;
        var quantitySize;
        var quantityAvailableWidth;
        var quantityRequiredWidth;
        var targetStyle;

        if (!overlay || !ageBox || !quantityBox || !target || !isVisible(target)) {
            if (overlay) {
                overlay.style.display = 'none';
            }
            if (target && target.classList) {
                target.classList.remove('aft-latest-container-visible');
            }
            if (ageBox) {
                ageBox.style.setProperty('display', 'none', 'important');
            }
            if (quantityBox) {
                quantityBox.style.setProperty('display', 'none', 'important');
            }
            return;
        }

        containerValue = overlay.querySelector('.aft-latest-container-id');
        ageValue = ageBox.querySelector('.aft-latest-container-age-value');
        quantityValue = quantityBox.querySelector('.aft-latest-container-quantity-value');
        ageBox.style.setProperty('display', 'flex', 'important');
        quantityBox.style.setProperty('display', 'flex', 'important');
        if (!entry || !sourceId || !hasCurrentDropZone || !entryMatchesDropZone || suppressLatestAgeDisplay) {
            overlay.style.display = 'none';
            target.classList.remove('aft-latest-container-visible');
            ageBox.className = 'aft-latest-age-box aft-latest-age-empty';
            quantityBox.className = 'aft-latest-quantity-box aft-latest-age-empty';
            if (containerValue && containerValue.textContent !== '') {
                containerValue.textContent = '';
            }
            if (ageValue && ageValue.textContent !== '') {
                ageValue.textContent = '';
            }
            if (quantityValue && quantityValue.textContent !== '') {
                quantityValue.textContent = '';
            }
            return;
        }

        try {
            targetStyle = window.getComputedStyle(target);
        } catch (e1) {
            targetStyle = null;
        }
        height = target.clientHeight || target.offsetHeight || 80;
        if (entry.status === 'ready') {
            ageText = entry.ageText;
            quantityText = normalizeTotalQuantity(entry.totalQuantity);
            quantityText = quantityText === null ? '--' : String(quantityText);
        } else if (entry.status === 'loading') {
            ageText = '...';
            quantityText = '...';
        } else if (entry.status === 'missing') {
            ageText = EMPTY_CONTAINER_TEXT;
            quantityText = '0';
        } else {
            ageText = '--';
            quantityText = '--';
        }
        if (containerValue && containerValue.textContent !== entry.containerId) {
            containerValue.textContent = entry.containerId;
        }
        if (ageValue && ageValue.textContent !== ageText) {
            ageValue.textContent = ageText;
        }
        if (quantityValue && quantityValue.textContent !== quantityText) {
            quantityValue.textContent = quantityText;
        }
        className = 'aft-latest-age-overlay aft-latest-age-' + entry.status;
        if (overlay.className !== className) {
            overlay.className = className;
        }
        className = 'aft-latest-age-box aft-latest-age-' + entry.status;
        if (entry.status === 'ready') {
            className += isScanHistoryEntryOverAgeLimit(entry) ? ' aft-latest-age-overdue' : ' aft-latest-age-safe';
        }
        if (ageBox.className !== className) {
            ageBox.className = className;
        }
        className = 'aft-latest-quantity-box aft-latest-age-' + entry.status;
        if (quantityBox.className !== className) {
            quantityBox.className = className;
        }
        overlay.style.display = 'flex';
        target.classList.add('aft-latest-container-visible');
        overlay.style.setProperty('--aft-latest-ts-size', Math.round(Math.max(20, Math.min(36, height * 0.36))) + 'px');
        ageSize = Math.round(Math.max(32, Math.min(64, (ageBox.clientHeight || ageBox.offsetHeight || 104) * 0.55)));
        ageBox.style.setProperty('--aft-latest-age-size', ageSize + 'px');
        if (ageValue && ageText) {
            availableWidth = ageValue.clientWidth || Math.max(0, ageBox.clientWidth - 44);
            requiredWidth = ageValue.scrollWidth;
            if (availableWidth > 0 && requiredWidth > availableWidth) {
                ageSize = Math.max(12, Math.floor(ageSize * availableWidth / requiredWidth));
                ageBox.style.setProperty('--aft-latest-age-size', ageSize + 'px');
            }
        }
        quantitySize = Math.round(Math.max(32, Math.min(64, (quantityBox.clientHeight || quantityBox.offsetHeight || 104) * 0.55)));
        quantityBox.style.setProperty('--aft-latest-quantity-size', quantitySize + 'px');
        if (quantityValue && quantityText) {
            quantityAvailableWidth = quantityValue.clientWidth || Math.max(0, quantityBox.clientWidth - 44);
            quantityRequiredWidth = quantityValue.scrollWidth;
            if (quantityAvailableWidth > 0 && quantityRequiredWidth > quantityAvailableWidth) {
                quantitySize = Math.max(12, Math.floor(quantitySize * quantityAvailableWidth / quantityRequiredWidth));
                quantityBox.style.setProperty('--aft-latest-quantity-size', quantitySize + 'px');
            }
        }
        overlay.style.borderRadius = targetStyle && targetStyle.borderRadius ? targetStyle.borderRadius : '8px';
    }

    function updateLatestAgeOverlay() {
        updateLatestAgeOverlayPosition();
    }

    function renderScanHistory() {
        var list = getCachedElement('aft-scan-history-list');
        var fragment;
        var columns;
        var empty;
        var entry;
        var matchingEntries = [];
        var i;

        if (!list) {
            return;
        }

        list.textContent = '';
        for (i = 0; i < scanHistoryEntries.length; i++) {
            entry = scanHistoryEntries[i];
            if (scanHistoryEntryMatchesFilters(entry)) {
                matchingEntries.push(entry);
            }
        }
        matchingEntries = sortScanHistoryEntries(matchingEntries);
        updateScanHistorySummary(matchingEntries.length);
        if (!scanHistoryEntries.length) {
            empty = document.createElement('div');
            empty.className = 'aft-scan-history-empty';
            empty.textContent = 'Brak skan\u00f3w';
            list.appendChild(empty);
            return;
        }
        if (!matchingEntries.length) {
            empty = document.createElement('div');
            empty.className = 'aft-scan-history-empty';
            empty.textContent = 'Brak wynik\u00f3w';
            list.appendChild(empty);
            return;
        }

        fragment = document.createDocumentFragment();
        columns = document.createElement('div');
        columns.className = 'aft-scan-history-columns';
        columns.setAttribute('role', 'row');
        createScanHistoryColumnHeader(columns, 'time', 'Data / godzina');
        createScanHistoryColumnHeader(columns, 'dropZone', 'Drop-Zone');
        createScanHistoryColumnHeader(columns, 'container', 'Kontener');
        createScanHistoryColumnHeader(columns, 'age', 'Wiek');
        createScanHistoryColumnHeader(columns, 'quantity', 'Ilo\u015b\u0107');
        fragment.appendChild(columns);

        for (i = 0; i < matchingEntries.length; i++) {
            entry = matchingEntries[i];
            fragment.appendChild(createScanHistoryRow(entry));
        }
        list.appendChild(fragment);
    }

    function cloneScanHistoryEntries(entries) {
        return JSON.parse(JSON.stringify(entries || []));
    }

    function mergeClearedScanHistoryEntries(currentEntries, clearedEntries) {
        var merged = cloneScanHistoryEntries(currentEntries);
        var seenContainers = {};
        var entry;
        var key;
        var i;
        for (i = 0; i < merged.length; i++) {
            seenContainers['$' + trimText(merged[i].containerId)] = true;
        }
        for (i = 0; i < clearedEntries.length; i++) {
            entry = clearedEntries[i];
            key = '$' + trimText(entry.containerId);
            if (!seenContainers[key]) {
                seenContainers[key] = true;
                merged.push(cloneScanHistoryEntries([entry])[0]);
            }
        }
        return merged;
    }

    function restartRestoredScanHistoryRequests() {
        var entry;
        var i;
        for (i = 0; i < scanHistoryEntries.length; i++) {
            entry = scanHistoryEntries[i];
            if (entry.status === 'loading') {
                requestFreshContainerAge(entry.containerId, entry.id);
            }
        }
    }

    function clearScanHistory() {
        if (!scanHistoryEntries.length) {
            return false;
        }
        scanHistoryClearedEntries = cloneScanHistoryEntries(scanHistoryEntries);
        scanHistoryClearRedoEntries = null;
        scanHistoryClearRestored = false;
        scanHistoryEntries = [];
        saveScanHistory();
        renderScanHistory();
        return true;
    }

    function undoScanHistoryClear() {
        if (!scanHistoryClearedEntries || scanHistoryClearRestored) {
            return false;
        }
        scanHistoryClearRedoEntries = cloneScanHistoryEntries(scanHistoryEntries);
        scanHistoryEntries = mergeClearedScanHistoryEntries(
            scanHistoryEntries,
            scanHistoryClearedEntries
        );
        scanHistoryClearRestored = true;
        saveScanHistory();
        renderScanHistory();
        restartRestoredScanHistoryRequests();
        return true;
    }

    function redoScanHistoryClear() {
        if (!scanHistoryClearedEntries || !scanHistoryClearRestored) {
            return false;
        }
        scanHistoryEntries = cloneScanHistoryEntries(scanHistoryClearRedoEntries);
        scanHistoryClearRestored = false;
        saveScanHistory();
        renderScanHistory();
        return true;
    }

    function invalidateRestoredScanHistoryClearRedo() {
        if (!scanHistoryClearRestored) {
            return;
        }
        scanHistoryClearedEntries = null;
        scanHistoryClearRedoEntries = null;
        scanHistoryClearRestored = false;
    }

    function getXlsxLibrary() {
        if (loadedXlsxLibrary && loadedXlsxLibrary.utils) {
            return loadedXlsxLibrary;
        }
        try {
            if (typeof XLSX !== 'undefined' && XLSX && XLSX.utils) {
                return XLSX;
            }
        } catch (e1) {}
        try {
            if (PAGE_WINDOW.XLSX && PAGE_WINDOW.XLSX.utils) {
                return PAGE_WINDOW.XLSX;
            }
        } catch (e2) {}
        return null;
    }

    function loadXlsxLibraryForExport(onReady) {
        var existing = getXlsxLibrary();
        if (existing) {
            onReady(existing);
            return;
        }
        if (xlsxLibraryLoading) {
            return;
        }
        if (typeof GM_xmlhttpRequest !== 'function') {
            window.alert('Nie uda\u0142o si\u0119 za\u0142adowa\u0107 biblioteki eksportu Excel.');
            return;
        }
        xlsxLibraryLoading = true;
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
            onload: function (response) {
                var evaluate;
                xlsxLibraryLoading = false;
                if (!response || response.status < 200 || response.status >= 300 || !response.responseText) {
                    window.alert('Nie uda\u0142o si\u0119 za\u0142adowa\u0107 biblioteki eksportu Excel.');
                    return;
                }
                try {
                    evaluate = new Function(String(response.responseText) + '\nreturn typeof XLSX !== "undefined" ? XLSX : null;');
                    loadedXlsxLibrary = evaluate();
                } catch (e1) {
                    loadedXlsxLibrary = null;
                }
                if (!loadedXlsxLibrary || !loadedXlsxLibrary.utils) {
                    window.alert('Nie uda\u0142o si\u0119 uruchomi\u0107 biblioteki eksportu Excel.');
                    return;
                }
                onReady(loadedXlsxLibrary);
            },
            onerror: function () {
                xlsxLibraryLoading = false;
                window.alert('Nie uda\u0142o si\u0119 za\u0142adowa\u0107 biblioteki eksportu Excel.');
            },
            ontimeout: function () {
                xlsxLibraryLoading = false;
                window.alert('Przekroczono czas oczekiwania na bibliotek\u0119 eksportu Excel.');
            },
            timeout: 15000
        });
    }

    function exportScanHistoryXlsx() {
        var xlsx = getXlsxLibrary();
        var rows = [[
            'Data',
            'Godzina',
            'Nazwa Drop-Zone',
            'Kod Drop-Zone',
            'Kontener',
            'Wiek',
            'Ilo\u015b\u0107'
        ]];
        var entry;
        var sheet;
        var workbook;
        var fileDate;
        var scannedDate;
        var rowNumber;
        var i;

        if (!scanHistoryEntries.length) {
            return false;
        }
        if (!xlsx) {
            loadXlsxLibraryForExport(function () {
                exportScanHistoryXlsx();
            });
            return false;
        }

        for (i = scanHistoryEntries.length - 1; i >= 0; i--) {
            entry = scanHistoryEntries[i];
            scannedDate = new Date(entry.scannedAt);
            rows.push([
                scannedDate,
                scannedDate,
                entry.dropZoneLabel,
                entry.dropZoneText,
                entry.containerId,
                entry.ageText,
                entry.status === 'missing' ? 0 : normalizeTotalQuantity(entry.totalQuantity)
            ]);
        }

        sheet = xlsx.utils.aoa_to_sheet(rows, { cellDates: true });
        for (rowNumber = 2; rowNumber <= rows.length; rowNumber++) {
            if (sheet['A' + rowNumber]) {
                sheet['A' + rowNumber].z = 'dd.mm.yyyy';
            }
            if (sheet['B' + rowNumber]) {
                sheet['B' + rowNumber].z = 'hh:mm';
            }
        }
        sheet['!cols'] = [
            { wch: 13 },
            { wch: 9 },
            { wch: 20 },
            { wch: 24 },
            { wch: 28 },
            { wch: 14 },
            { wch: 10 }
        ];
        sheet['!autofilter'] = { ref: 'A1:G' + rows.length };
        workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, sheet, 'Historia skanowania');
        workbook.Props = {
            Title: 'Historia skanowania Dropzoner',
            Subject: 'Skany kontener\u00f3w i Drop-Zon'
        };
        fileDate = new Date().toISOString().slice(0, 10);
        xlsx.writeFile(workbook, 'dropzoner-history-' + fileDate + '.xlsx', { compression: true });
        return true;
    }

    function updateScanHistoryEntry(entryId, status, ageText, ageMilliseconds, totalQuantity) {
        var entry = findScanHistoryEntry(entryId);
        if (!entry) {
            return;
        }
        if (status === 'ready' && (!isFinite(Number(ageMilliseconds)) || Number(ageMilliseconds) < 0)) {
            status = 'missing';
        }
        entry.status = status;
        if (status === 'missing') {
            entry.ageText = EMPTY_CONTAINER_TEXT;
            entry.ageMilliseconds = null;
            entry.totalQuantity = 0;
        } else {
            entry.ageText = ageText;
            entry.ageMilliseconds = ageMilliseconds === undefined ? null : ageMilliseconds;
            entry.totalQuantity = normalizeTotalQuantity(totalQuantity);
        }
        playScanResultSound(entry);
        saveScanHistory();
        renderSingleScanHistoryEntry(entryId, false);
    }

    function parseInventoryResponse(response) {
        if (response && response.response && typeof response.response === 'object') {
            return response.response;
        }
        if (response && response.responseText) {
            return JSON.parse(response.responseText);
        }
        return null;
    }

    function requestFreshContainerAge(containerId, entryId) {
        var url = INVENTORY_API_ORIGIN + '/searchByContainer/' +
            encodeURIComponent(INVENTORY_WAREHOUSE_ID) + '/' + encodeURIComponent(containerId) +
            '?aft_age_request=' + now();
        var entry = findScanHistoryEntry(entryId);
        var state = inventoryAgeRequestStates[entryId];

        function complete(status, ageText, ageMilliseconds, totalQuantity) {
            delete inventoryAgeRequestStates[entryId];
            updateScanHistoryEntry(entryId, status, ageText, ageMilliseconds, totalQuantity);
        }

        function retry() {
            var currentEntry = findScanHistoryEntry(entryId);
            var delay;
            if (!currentEntry || currentEntry.status !== 'loading') {
                delete inventoryAgeRequestStates[entryId];
                return;
            }
            state.active = false;
            state.attempt++;
            delay = Math.min(
                INVENTORY_RETRY_MAX_MS,
                INVENTORY_RETRY_BASE_MS * Math.pow(2, Math.min(5, state.attempt - 1))
            );
            state.timer = window.setTimeout(function () {
                state.timer = null;
                requestFreshContainerAge(containerId, entryId);
            }, delay);
        }

        if (!entry || entry.status !== 'loading') {
            delete inventoryAgeRequestStates[entryId];
            return;
        }
        if (state && (state.active || state.timer)) {
            return;
        }
        if (!state) {
            state = { active: false, timer: null, attempt: 0 };
            inventoryAgeRequestStates[entryId] = state;
        }

        if (typeof GM_xmlhttpRequest !== 'function') {
            complete('error', '\u017b\u0105danie niedost\u0119pne');
            return;
        }

        state.active = true;
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            responseType: 'json',
            timeout: INVENTORY_REQUEST_TIMEOUT_MS,
            anonymous: false,
            onload: function (response) {
                var data;
                var record;
                try {
                    if (!response || response.status < 200 || response.status >= 300) {
                        if (!response || !response.status || response.status === 429 || response.status >= 500) {
                            retry();
                            return;
                        }
                        complete('error', 'B\u0142\u0105d \u017c\u0105dania');
                        return;
                    }
                    data = parseInventoryResponse(response);
                    if (!data || data.present !== true || !data.containerRecord) {
                        complete('missing', EMPTY_CONTAINER_TEXT);
                        return;
                    }
                    record = data.containerRecord;
                    complete(
                        'ready',
                        formatContainerAge(record.oldestInventoryAgeMills),
                        Number(record.oldestInventoryAgeMills),
                        record.totalQuantity
                    );
                } catch (e) {
                    retry();
                }
            },
            onerror: function () {
                retry();
            },
            ontimeout: function () {
                retry();
            }
        });
    }

    function addContainerAgeEntry(buttonId, dropZoneText, dropZoneLabel, containerId) {
        var scannedAt = now();
        var entryId = 'scan_' + scannedAt + '_' + (++scanHistoryEntrySequence);
        var normalizedContainerId = trimText(containerId);
        var i;

        invalidateRestoredScanHistoryClearRedo();
        for (i = scanHistoryEntries.length - 1; i >= 0; i--) {
            if (trimText(scanHistoryEntries[i].containerId) === normalizedContainerId) {
                scanHistoryEntries.splice(i, 1);
            }
        }

        suppressLatestAgeDisplay = false;
        scanHistoryEntries.unshift({
            id: entryId,
            buttonId: buttonId,
            containerId: containerId,
            dropZoneText: dropZoneText,
            dropZoneLabel: dropZoneLabel || dropZoneText,
            scannedAt: scannedAt,
            status: 'loading',
            ageMilliseconds: null,
            ageText: '\u0141adowanie...',
            totalQuantity: null
        });
        requestFreshContainerAge(containerId, entryId);
        saveScanHistory();
        renderSingleScanHistoryEntry(entryId, true);
        return entryId;
    }

    function getQueuedContainerCaptureSignature(buttonId, containerId) {
        return trimText(buttonId) + '|' + trimText(containerId);
    }

    function markQueuedContainerCapture(signature) {
        recentQueuedContainerCaptures[signature] = now() + CONTAINER_SCAN_CAPTURE_TTL_MS;
    }

    function hasRecentQueuedContainerCapture(signature) {
        var expiresAt = Number(recentQueuedContainerCaptures[signature]) || 0;
        var currentTime = now();
        var key;
        if (expiresAt > currentTime) {
            return true;
        }
        delete recentQueuedContainerCaptures[signature];
        for (key in recentQueuedContainerCaptures) {
            if (Object.prototype.hasOwnProperty.call(recentQueuedContainerCaptures, key) &&
                    Number(recentQueuedContainerCaptures[key]) <= currentTime) {
                delete recentQueuedContainerCaptures[key];
            }
        }
        return false;
    }

    function scheduleAftContainerScanQueue(delay) {
        if (containerScanQueueTimer) {
            return;
        }
        containerScanQueueTimer = window.setTimeout(function () {
            containerScanQueueTimer = null;
            processAftContainerScanQueue();
        }, Math.max(0, Number(delay) || 0));
    }

    function getAftContainerScanQueuePollDelay() {
        var job = containerScanQueueActiveJob || containerScanQueue[0];
        var startedAt = containerScanQueueActiveJob ?
            containerScanQueueDispatchStartedAt : Number(job && job.queuedAt);
        var stalled = startedAt > 0 && now() - startedAt >= CONTAINER_SCAN_QUEUE_BACKOFF_AFTER_MS;
        var inactive = typeof isAftWindowInactive === 'function' && isAftWindowInactive();
        return stalled || inactive ?
            CONTAINER_SCAN_QUEUE_SLOW_POLL_MS : CONTAINER_SCAN_QUEUE_FAST_POLL_MS;
    }

    function processAftContainerScanQueue() {
        var busy;
        var dispatched;
        if (containerScanQueueTimer) {
            window.clearTimeout(containerScanQueueTimer);
            containerScanQueueTimer = null;
        }
        if (!containerScanQueue.length) {
            containerScanQueueActiveJob = null;
            containerScanQueueSawBusy = false;
            return;
        }

        if (containerScanQueueActiveJob) {
            busy = isAftInputDisabled() || hasBlockingAftModal();
            if (busy) {
                containerScanQueueSawBusy = true;
            }
            if (!busy && isActiveAftStep(AFT_STEP_CONTAINER) &&
                    (containerScanQueueSawBusy ||
                    now() - containerScanQueueDispatchStartedAt >= CONTAINER_SCAN_QUEUE_SETTLE_MS)) {
                containerScanQueue.shift();
                containerScanQueueActiveJob = null;
                containerScanQueueSawBusy = false;
                scheduleAftContainerScanQueue(0);
                return;
            }
            scheduleAftContainerScanQueue(getAftContainerScanQueuePollDelay());
            return;
        }

        if (!canScanAftStep(AFT_STEP_CONTAINER)) {
            scheduleAftContainerScanQueue(getAftContainerScanQueuePollDelay());
            return;
        }

        containerScanQueueActiveJob = containerScanQueue[0];
        containerScanQueueSawBusy = false;
        containerScanQueueDispatchStartedAt = now();
        lastAgeScanSignature = containerScanQueueActiveJob.signature;
        containerScanQueueDispatching = true;
        dispatched = scanDirect(containerScanQueueActiveJob.containerId);
        containerScanQueueDispatching = false;
        if (!dispatched) {
            containerScanQueueActiveJob = null;
            scheduleAftContainerScanQueue(getAftContainerScanQueuePollDelay());
            return;
        }
        containerScanQueueSawBusy = isAftInputDisabled() || hasBlockingAftModal();
        scheduleAftContainerScanQueue(getAftContainerScanQueuePollDelay());
    }

    function enqueueAftContainerScan(containerId) {
        var normalizedContainerId = trimText(containerId);
        var signature;
        var entryId;
        syncAgeDropZoneFromAftSession();
        if (!normalizedContainerId || normalizedContainerId.length <= 1 || !activeAgeButtonId) {
            return false;
        }
        signature = getQueuedContainerCaptureSignature(activeAgeButtonId, normalizedContainerId);
        markQueuedContainerCapture(signature);
        lastAgeScanSignature = signature;
        entryId = addContainerAgeEntry(
            activeAgeButtonId,
            activeAgeDropZoneText,
            activeAgeDropZoneLabel,
            normalizedContainerId
        );
        containerScanQueue.push({
            containerId: normalizedContainerId,
            entryId: entryId,
            signature: signature,
            queuedAt: now()
        });
        scheduleAftContainerScanQueue(0);
        return true;
    }

    function captureAftContainerScan(barcode, delegator) {
        var session;
        var containerId;
        var destinationId;
        var sourceId;

        if (getActiveAftStepId() !== AFT_STEP_CONTAINER) {
            return;
        }
        syncAgeDropZoneFromAftSession();
        if (!activeAgeButtonId) {
            return;
        }
        if (delegator && delegator.isInputDisabled) {
            return;
        }
        if (isVisible(getCachedElement('diversion-with-back'))) {
            return;
        }

        containerId = trimText(barcode);
        if (containerId.length <= 1) {
            return;
        }
        session = getAftSession();
        sourceId = trimText(session && session.sourceScannableId);
        destinationId = trimText(session && session.destinationScannableId);
        if ((sourceId && containerId.toLowerCase() === sourceId.toLowerCase()) ||
                (destinationId && containerId.toLowerCase() === destinationId.toLowerCase())) {
            return;
        }
        if (activeAgeDropZoneText && destinationId &&
                activeAgeDropZoneText.toLowerCase() !== destinationId.toLowerCase()) {
            return;
        }

        lastAgeScanSignature = activeAgeButtonId + '|' + containerId;
        addContainerAgeEntry(activeAgeButtonId, activeAgeDropZoneText, activeAgeDropZoneLabel, containerId);
    }

    function installAftContainerScanHook() {
        var delegator;
        var originalHandleScan;
        var wrappedHandleScan;
        try {
            delegator = PAGE_WINDOW.aft && PAGE_WINDOW.aft.registry ? PAGE_WINDOW.aft.registry.eventDelegator : null;
            if (!delegator || typeof delegator.handleScan !== 'function') {
                return false;
            }
            if (delegator.handleScan === delegator.__aftAutoDropZoneAgeWrappedScan) {
                return true;
            }
            originalHandleScan = delegator.handleScan;
            wrappedHandleScan = function (barcode) {
                var activeStepId = getActiveAftStepId();
                var expectedDestination = activeStepId === AFT_STEP_DESTINATION ? trimText(barcode) : '';
                var result;
                if (activeStepId === AFT_STEP_CONTAINER && !containerScanQueueDispatching &&
                        !isVisible(getCachedElement('diversion-with-back')) &&
                        (this.isInputDisabled || containerScanQueueActiveJob || containerScanQueue.length)) {
                    if (enqueueAftContainerScan(barcode)) {
                        return;
                    }
                }
                if (!containerScanQueueDispatching) {
                    captureAftContainerScan(barcode, this);
                }
                if (expectedDestination) {
                    activateAgeDropZoneForScanText(expectedDestination);
                }
                result = originalHandleScan.apply(this, arguments);
                if (expectedDestination) {
                    syncAgeDropZoneFromAftSession(expectedDestination);
                    window.setTimeout(function () {
                        syncAgeDropZoneFromAftSession(expectedDestination);
                    }, 0);
                    window.setTimeout(function () {
                        syncAgeDropZoneFromAftSession(expectedDestination);
                    }, 80);
                }
                return result;
            };
            delegator.__aftAutoDropZoneAgeWrappedScan = wrappedHandleScan;
            delegator.handleScan = wrappedHandleScan;
            return true;
        } catch (e) {}
        return false;
    }

    function resumePendingAgeRequests() {
        var i;
        for (i = 0; i < scanHistoryEntries.length; i++) {
            if (scanHistoryEntries[i].status === 'loading') {
                requestFreshContainerAge(scanHistoryEntries[i].containerId, scanHistoryEntries[i].id);
            }
        }
    }

    function observeScannedContainerAge() {
        var session;
        var containerId;
        var destinationId;
        var signature;

        if (!activeAgeButtonId) {
            return;
        }

        session = getAftSession();
        containerId = trimText(session && session.containerScannableId);
        if (!containerId) {
            lastAgeScanSignature = '';
            return;
        }

        destinationId = trimText(session && session.destinationScannableId);
        if (activeAgeDropZoneText && destinationId &&
                activeAgeDropZoneText.toLowerCase() !== destinationId.toLowerCase()) {
            return;
        }

        signature = activeAgeButtonId + '|' + containerId;
        if (hasRecentQueuedContainerCapture(signature)) {
            lastAgeScanSignature = signature;
            return;
        }
        if (signature === lastAgeScanSignature) {
            return;
        }
        lastAgeScanSignature = signature;
        addContainerAgeEntry(activeAgeButtonId, activeAgeDropZoneText, activeAgeDropZoneLabel, containerId);
    }

    function getElementOuterHeight(element) {
        var style;
        var height;
        if (!element || !isVisible(element)) {
            return 0;
        }
        height = element.getBoundingClientRect().height || element.offsetHeight || 0;
        try {
            style = window.getComputedStyle(element);
            height += parseFloat(style.marginTop) || 0;
            height += parseFloat(style.marginBottom) || 0;
        } catch (e) {}
        return height;
    }

    function getScanHistoryMaxHeight() {
        var panelBody = getCachedElement('aft-scan-panel-body');
        var historyBox = getCachedElement('aft-scan-history-box');
        var historyHeader = historyBox ? historyBox.querySelector('.aft-scan-history-header') : null;
        var stepsContainer = panelBody ? panelBody.querySelector('.steps-container') : null;
        var newDropZoneWrap = getCachedElement('aft-scan-new-dropzone-wrap');
        var addControls = getCachedElement('aft-scan-add-controls');
        var panelBodyStyle;
        var historyBoxStyle;
        var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
        var maxHeight = Math.floor(viewportHeight - 250);
        var contentHeight;
        var reservedHeight = 0;
        if (panelBody && panelBody.clientHeight > 0 && historyBox && historyHeader) {
            contentHeight = panelBody.clientHeight;
            try {
                panelBodyStyle = window.getComputedStyle(panelBody);
                contentHeight -= parseFloat(panelBodyStyle.paddingTop) || 0;
                contentHeight -= parseFloat(panelBodyStyle.paddingBottom) || 0;
            } catch (e1) {}
            reservedHeight += getElementOuterHeight(stepsContainer);
            reservedHeight += SCAN_GROUPS_MIN_VISIBLE_HEIGHT;
            reservedHeight += getElementOuterHeight(historyHeader);
            try {
                historyBoxStyle = window.getComputedStyle(historyBox);
                reservedHeight += parseFloat(historyBoxStyle.borderTopWidth) || 0;
                reservedHeight += parseFloat(historyBoxStyle.borderBottomWidth) || 0;
                reservedHeight += parseFloat(historyBoxStyle.marginTop) || 0;
                reservedHeight += parseFloat(historyBoxStyle.marginBottom) || 0;
            } catch (e2) {}
            reservedHeight += getElementOuterHeight(newDropZoneWrap);
            reservedHeight += getElementOuterHeight(addControls);
            maxHeight = Math.floor(contentHeight - reservedHeight);
        }
        return Math.max(SCAN_HISTORY_MIN_HEIGHT, maxHeight);
    }

    function updateQuickBoxHistoryClearance(height, maxHeight) {
        var quickBox = getCachedElement('aft-scan-quick-buttons');
        var clearance;
        var marginBottom;
        var paddingBottom;
        if (!quickBox) {
            return;
        }
        clearance = Math.max(0, Math.min(29, maxHeight - height));
        marginBottom = Math.min(14, clearance);
        paddingBottom = Math.min(14, Math.max(0, clearance - marginBottom));
        quickBox.style.marginBottom = marginBottom + 'px';
        quickBox.style.paddingBottom = paddingBottom + 'px';
        quickBox.style.borderBottomWidth = clearance > 28 ? '1px' : '0px';
    }

    function clampScanHistoryHeight(value) {
        value = Math.round(Number(value));
        if (!isFinite(value)) {
            value = SCAN_HISTORY_DEFAULT_HEIGHT;
        }
        return Math.max(SCAN_HISTORY_MIN_HEIGHT, Math.min(getScanHistoryMaxHeight(), value));
    }

    function getScanHistoryCollapseThreshold() {
        var list = getCachedElement('aft-scan-history-list');
        var columns;
        var rows;
        var rowHeight = SCAN_HISTORY_COLLAPSE_FALLBACK_ROW_HEIGHT;
        var height = 0;
        var i;
        if (!list) {
            return SCAN_HISTORY_COLLAPSE_ROW_COUNT * rowHeight;
        }
        columns = list.querySelector('.aft-scan-history-columns');
        rows = list.querySelectorAll('.aft-scan-history-row');
        if (columns) {
            height += getElementOuterHeight(columns);
        }
        if (rows.length) {
            rowHeight = getElementOuterHeight(rows[0]) || rowHeight;
        }
        for (i = 0; i < SCAN_HISTORY_COLLAPSE_ROW_COUNT; i++) {
            height += rows[i] ? (getElementOuterHeight(rows[i]) || rowHeight) : rowHeight;
        }
        return Math.max(rowHeight, Math.min(getScanHistoryMaxHeight(), Math.round(height)));
    }

    function setScanHistoryCollapsePreview(rawHeight, threshold) {
        var box = getCachedElement('aft-scan-history-box');
        var list = getCachedElement('aft-scan-history-list');
        var active = rawHeight < threshold;
        if (!box || !list) {
            return false;
        }
        box.classList.toggle('aft-scan-history-collapse-preview', active);
        list.style.setProperty('--aft-scan-history-collapse-opacity', active ? '0' : '1');
        list.style.setProperty('--aft-scan-history-collapse-offset', active ? '16px' : '0px');
        list.style.setProperty('--aft-scan-history-collapse-scale', active ? '0.96' : '1');
        return active;
    }

    function clearScanHistoryCollapsePreview() {
        var box = getCachedElement('aft-scan-history-box');
        var list = getCachedElement('aft-scan-history-list');
        if (box) {
            box.classList.remove('aft-scan-history-collapse-preview');
        }
        if (list) {
            list.style.removeProperty('--aft-scan-history-collapse-opacity');
            list.style.removeProperty('--aft-scan-history-collapse-offset');
            list.style.removeProperty('--aft-scan-history-collapse-scale');
        }
    }

    function getStoredScanHistoryHeight() {
        return clampScanHistoryHeight(storageGet(STORAGE_KEY_SCAN_HISTORY_HEIGHT, SCAN_HISTORY_DEFAULT_HEIGHT));
    }

    function applyScanHistoryHeight(value, persist) {
        var box = getCachedElement('aft-scan-history-box');
        var list = getCachedElement('aft-scan-history-list');
        var handle = getCachedElement('aft-scan-history-resize-handle');
        var filterPanel = getCachedElement('aft-scan-history-filter-panel');
        var maxHeight = getScanHistoryMaxHeight();
        var numericValue = Math.round(Number(value));
        var height;
        if (!isFinite(numericValue)) {
            numericValue = SCAN_HISTORY_DEFAULT_HEIGHT;
        }
        height = Math.max(SCAN_HISTORY_MIN_HEIGHT, Math.min(maxHeight, numericValue));
        updateQuickBoxHistoryClearance(height, maxHeight);
        if (box) {
            box.style.setProperty('--aft-scan-history-list-height', height + 'px');
            box.classList.toggle('aft-scan-history-content-hidden', height <= 0);
        }
        if (filterPanel) {
            filterPanel.setAttribute('aria-hidden', height <= 0 ||
                !filterPanel.classList.contains('aft-scan-history-filter-panel-open') ? 'true' : 'false');
        }
        if (list) {
            list.style.height = height + 'px';
        }
        if (handle) {
            handle.setAttribute('aria-valuenow', String(height));
            handle.setAttribute('aria-valuemax', String(maxHeight));
        }
        if (persist) {
            storageSet(STORAGE_KEY_SCAN_HISTORY_HEIGHT, String(height));
            if (height > 0) {
                storageSet(STORAGE_KEY_SCAN_HISTORY_EXPANDED_HEIGHT, String(height));
            }
        }
        return height;
    }

    function startScanHistoryResize(event) {
        var handle = event.currentTarget;
        var list = getCachedElement('aft-scan-history-list');
        var root = document.documentElement;
        var startHeight;
        var currentHeight;
        var rawHeight;
        var pointerId = event.pointerId;
        var panel = getCachedElement('aft-scan-buttons-panel');
        var fullscreenThreshold = panel ? panel.getBoundingClientRect().top + 8 : 8;
        var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
        var lastClientY = event.clientY;
        var dragDistance = 0;
        var collapseThreshold;
        var collapsePreviewActive = false;
        var isHeaderDrag = !!(handle.classList && handle.classList.contains('aft-scan-history-header'));
        var dragShield = document.createElement('div');

        if (!list || (event.button !== undefined && event.button !== 0)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (list.__aftHeightAnimationTimer) {
            window.clearTimeout(list.__aftHeightAnimationTimer);
            list.__aftHeightAnimationTimer = null;
        }
        if (list.__aftCollapsePreviewTransitionTimer) {
            window.clearTimeout(list.__aftCollapsePreviewTransitionTimer);
            list.__aftCollapsePreviewTransitionTimer = null;
        }
        list.style.transition = 'none';
        clearScanHistoryCollapsePreview();
        if (scanHistoryFullscreen) {
            setScanHistoryFullscreen(false);
            startHeight = getScanHistoryMaxHeight();
            applyScanHistoryHeight(startHeight, false);
        } else {
            startHeight = list.getBoundingClientRect().height;
            if (!isFinite(startHeight)) {
                startHeight = getStoredScanHistoryHeight();
            }
        }
        currentHeight = startHeight;
        rawHeight = startHeight;
        collapseThreshold = getScanHistoryCollapseThreshold();
        if (root && root.classList) {
            root.classList.add('aft-resizing-scan-history');
        }
        dragShield.setAttribute('aria-hidden', 'true');
        dragShield.style.position = 'fixed';
        dragShield.style.inset = '0';
        dragShield.style.zIndex = '2147483646';
        dragShield.style.background = 'transparent';
        dragShield.style.cursor = 'ns-resize';
        dragShield.style.touchAction = 'none';
        document.body.appendChild(dragShield);
        try {
            handle.setPointerCapture(pointerId);
        } catch (e1) {}

        function onPointerMove(moveEvent) {
            var currentY;
            if (moveEvent.pointerId !== pointerId) {
                return;
            }
            moveEvent.preventDefault();
            currentY = moveEvent.clientY;
            if (currentY <= 0 && lastClientY > viewportHeight * 0.75) {
                currentY = viewportHeight;
            }
            currentY = Math.max(0, Math.min(viewportHeight, currentY));
            dragDistance += Math.abs(currentY - lastClientY);
            if (currentY <= fullscreenThreshold && lastClientY <= fullscreenThreshold + 48) {
                if (!scanHistoryFullscreen) {
                    setScanHistoryFullscreen(true);
                }
                currentHeight = getScanHistoryMaxHeight();
                rawHeight = currentHeight;
                lastClientY = currentY;
                return;
            }
            if (scanHistoryFullscreen) {
                setScanHistoryFullscreen(false);
                currentHeight = getScanHistoryMaxHeight();
                rawHeight = currentHeight;
                lastClientY = fullscreenThreshold;
            }
            rawHeight += lastClientY - currentY;
            if (rawHeight < collapseThreshold) {
                if (!collapsePreviewActive) {
                    if (list.__aftCollapsePreviewTransitionTimer) {
                        window.clearTimeout(list.__aftCollapsePreviewTransitionTimer);
                        list.__aftCollapsePreviewTransitionTimer = null;
                    }
                    list.style.transition = 'height 220ms ' + UI_ANIMATION_EASING +
                        ', opacity 180ms ease, transform 180ms ease';
                }
                collapsePreviewActive = setScanHistoryCollapsePreview(rawHeight, collapseThreshold);
                currentHeight = applyScanHistoryHeight(0, false);
            } else {
                if (collapsePreviewActive) {
                    clearScanHistoryCollapsePreview();
                    list.style.transition = 'height 220ms ' + UI_ANIMATION_EASING +
                        ', opacity 180ms ease, transform 180ms ease';
                    list.__aftCollapsePreviewTransitionTimer = window.setTimeout(function () {
                        if (!collapsePreviewActive) {
                            list.style.transition = 'none';
                        }
                        list.__aftCollapsePreviewTransitionTimer = null;
                    }, 230);
                }
                collapsePreviewActive = false;
                currentHeight = applyScanHistoryHeight(rawHeight, false);
            }
            lastClientY = currentY;
        }

        function finishResize(endEvent) {
            if (endEvent && endEvent.pointerId !== pointerId) {
                return;
            }
            window.removeEventListener('pointermove', onPointerMove, true);
            window.removeEventListener('pointerup', finishResize, true);
            window.removeEventListener('pointercancel', finishResize, true);
            if (root && root.classList) {
                root.classList.remove('aft-resizing-scan-history');
            }
            if (dragShield.parentNode) {
                dragShield.parentNode.removeChild(dragShield);
            }
            try {
                handle.releasePointerCapture(pointerId);
            } catch (e2) {}
            if (list.__aftCollapsePreviewTransitionTimer) {
                window.clearTimeout(list.__aftCollapsePreviewTransitionTimer);
                list.__aftCollapsePreviewTransitionTimer = null;
            }
            if (!scanHistoryFullscreen && isHeaderDrag && dragDistance < 4) {
                clearScanHistoryCollapsePreview();
                applyScanHistoryHeight(startHeight, false);
                list.style.transition = '';
                toggleScanHistoryCollapsed();
                queueLayoutUpdate();
            } else if (!scanHistoryFullscreen && collapsePreviewActive) {
                if (list.__aftHeightAnimationTimer) {
                    window.clearTimeout(list.__aftHeightAnimationTimer);
                }
                currentHeight = applyScanHistoryHeight(0, true);
                clearScanHistoryCollapsePreview();
                list.style.transition = '';
                queueLayoutUpdate();
            } else if (!scanHistoryFullscreen) {
                clearScanHistoryCollapsePreview();
                applyScanHistoryHeight(currentHeight, true);
                list.style.transition = '';
                queueLayoutUpdate();
            } else {
                clearScanHistoryCollapsePreview();
                list.style.transition = '';
                queueLayoutUpdate();
            }
        }

        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', finishResize, true);
        window.addEventListener('pointercancel', finishResize, true);
    }

    function resizeScanHistoryWithKeyboard(event) {
        var list = getCachedElement('aft-scan-history-list');
        var currentHeight;
        var nextHeight;
        if (!list) {
            return;
        }
        currentHeight = list.getBoundingClientRect().height || getStoredScanHistoryHeight();
        if (event.key === 'ArrowUp') {
            nextHeight = currentHeight + 24;
        } else if (event.key === 'ArrowDown') {
            nextHeight = currentHeight - 24;
        } else if (event.key === 'Home') {
            nextHeight = SCAN_HISTORY_DEFAULT_HEIGHT;
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        applyScanHistoryHeight(nextHeight, true);
        queueLayoutUpdate();
    }

    function isScanHistoryCollapsed() {
        return false;
    }

    function setScanHistoryToggleIcon(btn, collapsed) {
        if (!btn) {
            return;
        }
        btn.innerHTML = collapsed
            ? '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.title = collapsed ? 'Rozwi\u0144 histori\u0119 skanowania' : 'Zwi\u0144 histori\u0119 skanowania';
    }

    function setScanHistoryFullscreenIcon(btn, fullscreen) {
        if (!btn) {
            return;
        }
        btn.innerHTML = fullscreen
            ? '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5V9H3.5M15 3.5V9h5.5M9 20.5V15H3.5M15 20.5V15h5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5H3.5V9M15 3.5h5.5V9M9 20.5H3.5V15M15 20.5h5.5V15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.title = fullscreen ? 'Zamknij histori\u0119 pe\u0142noekranow\u0105' : 'Otw\u00f3rz histori\u0119 pe\u0142noekranow\u0105';
        btn.setAttribute('aria-pressed', fullscreen ? 'true' : 'false');
    }

    function setScanHistoryFullscreen(fullscreen) {
        var root = document.documentElement;
        var box = getCachedElement('aft-scan-history-box');
        var body = getCachedElement('aft-scan-history-body');
        var fullscreenBtn = getCachedElement('aft-scan-history-fullscreen');
        if (!root || !box || !body) {
            return;
        }
        scanHistoryFullscreen = !!fullscreen;
        root.classList.toggle('aft-scan-history-fullscreen', scanHistoryFullscreen);
        box.classList.toggle('aft-scan-history-fullscreen', scanHistoryFullscreen);
        setScanHistoryFullscreenIcon(fullscreenBtn, scanHistoryFullscreen);
        if (!scanHistoryFullscreen) {
            applyScanHistoryHeight(getStoredScanHistoryHeight(), false);
        }
        queueLayoutUpdate();
    }

    function toggleScanHistoryFullscreen() {
        setScanHistoryFullscreen(!scanHistoryFullscreen);
    }

    function applyScanHistoryCollapsedState(body, toggleBtn) {
        var collapsed = isScanHistoryCollapsed();
        var box = getCachedElement('aft-scan-history-box');
        if (!body) {
            return;
        }
        body.style.overflow = 'hidden';
        body.style.transition = 'max-height ' + UI_ANIMATION_MS + 'ms ' + UI_ANIMATION_EASING + ', opacity 240ms ease';
        body.style.maxHeight = collapsed ? '0px' : 'none';
        body.style.opacity = collapsed ? '0' : '1';
        body.style.pointerEvents = collapsed ? 'none' : 'auto';
        if (box && box.classList) {
            box.classList.toggle('aft-scan-history-collapsed', collapsed);
        }
        setScanHistoryToggleIcon(toggleBtn, collapsed);
    }

    function toggleScanHistoryCollapsed() {
        var body = getCachedElement('aft-scan-history-body');
        var list = getCachedElement('aft-scan-history-list');
        var currentHeight;
        var expandedHeight;
        var targetHeight;
        if (!body || !list) {
            return;
        }
        currentHeight = Math.round(list.getBoundingClientRect().height);
        if (currentHeight > 0) {
            storageSet(STORAGE_KEY_SCAN_HISTORY_EXPANDED_HEIGHT, String(currentHeight));
            setScanHistoryFullscreen(false);
            targetHeight = 0;
        } else {
            expandedHeight = storageGet(STORAGE_KEY_SCAN_HISTORY_EXPANDED_HEIGHT, SCAN_HISTORY_DEFAULT_HEIGHT);
            targetHeight = clampScanHistoryHeight(expandedHeight);
        }
        if (list.__aftHeightAnimationTimer) {
            window.clearTimeout(list.__aftHeightAnimationTimer);
        }
        list.style.transition = 'none';
        applyScanHistoryHeight(currentHeight, false);
        list.offsetHeight;
        list.style.transition = 'height ' + UI_ANIMATION_MS + 'ms ' + UI_ANIMATION_EASING;
        applyScanHistoryHeight(targetHeight, true);
        list.__aftHeightAnimationTimer = window.setTimeout(function () {
            list.style.transition = '';
            list.__aftHeightAnimationTimer = null;
            queueLayoutUpdate();
        }, UI_ANIMATION_MS + 50);
    }

    function updateScanHistoryFilterButton() {
        var button = getCachedElement('aft-scan-history-filter-toggle');
        var active = hasActiveScanHistoryFilters();
        if (!button) {
            return;
        }
        button.classList.toggle('aft-scan-history-filter-active', active);
        if (active) {
            button.textContent = 'Wyczy\u015b\u0107 filtry';
        } else {
            button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.5 7.2v5.3l-3 1.5v-6.8L4 5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }
        button.title = active ? 'Wyczy\u015b\u0107 filtry' : 'Filtruj histori\u0119 skanowania';
        button.setAttribute('aria-label', button.title);
    }

    function setScanHistoryFilterValue(key, value) {
        if (!Object.prototype.hasOwnProperty.call(scanHistoryFilters, key)) {
            return;
        }
        scanHistoryFilters[key] = value;
        renderScanHistory();
    }

    function createScanHistoryFilterControl(type, key, placeholder) {
        var control = type === 'select' ? document.createElement('select') : document.createElement('input');
        if (type !== 'select') {
            control.type = type;
        }
        if (type === 'number') {
            control.min = '0';
            control.step = '1';
        }
        control.className = 'aft-scan-history-filter-control';
        control.setAttribute('data-scan-history-filter', key);
        if (placeholder) {
            control.placeholder = placeholder;
        }
        control.value = scanHistoryFilters[key];
        control.addEventListener(type === 'select' ? 'change' : 'input', function () {
            setScanHistoryFilterValue(key, control.value);
        });
        return control;
    }

    function formatScanHistoryDateButtonValue(value) {
        var parts = String(value || '').split('-');
        if (parts.length !== 3) {
            return '';
        }
        return parts[2] + '.' + parts[1] + '.' + parts[0];
    }

    function createScanHistoryDateFilterControl(key, emptyText, ariaLabel) {
        var wrapper = document.createElement('div');
        var input = document.createElement('input');
        var button = document.createElement('button');
        var buttonText = document.createElement('span');
        var icon = document.createElement('span');

        function updateButtonText() {
            buttonText.textContent = formatScanHistoryDateButtonValue(input.value) || emptyText;
            button.classList.toggle('aft-scan-history-date-selected', !!input.value);
        }

        wrapper.className = 'aft-scan-history-date-picker';
        input.type = 'date';
        input.className = 'aft-scan-history-date-native';
        input.tabIndex = -1;
        input.setAttribute('aria-hidden', 'true');
        input.setAttribute('data-scan-history-filter', key);
        input.value = scanHistoryFilters[key];
        input.__aftRefreshLabel = updateButtonText;
        input.addEventListener('input', function () {
            updateButtonText();
            setScanHistoryFilterValue(key, input.value);
        });

        button.type = 'button';
        button.className = 'aft-scan-history-filter-control aft-scan-history-date-button';
        button.setAttribute('aria-label', ariaLabel);
        icon.className = 'aft-scan-history-date-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1z"/></svg>';
        button.appendChild(buttonText);
        button.appendChild(icon);
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            try {
                if (typeof input.showPicker === 'function') {
                    input.showPicker();
                } else {
                    input.click();
                }
            } catch (e) {
                input.click();
            }
        });
        wrapper.appendChild(input);
        wrapper.appendChild(button);
        updateButtonText();
        return wrapper;
    }

    function appendScanHistoryFilterOption(select, value, text) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    }

    function appendScanHistoryFilterField(grid, control, columnName) {
        var field = document.createElement('div');
        field.className = 'aft-scan-history-filter-field aft-scan-history-filter-column-' + columnName;
        field.appendChild(control);
        grid.appendChild(field);
    }

    function appendScanHistoryRangeFilterField(grid, columnName, startControl, endControl) {
        var field = document.createElement('div');
        var range = document.createElement('div');
        field.className = 'aft-scan-history-filter-field aft-scan-history-filter-range-column ' +
            'aft-scan-history-filter-column-' + columnName;
        range.className = 'aft-scan-history-filter-range';
        range.appendChild(startControl);
        range.appendChild(endControl);
        field.appendChild(range);
        grid.appendChild(field);
    }

    function setScanHistoryFilterPanelOpen(open) {
        var panel = getCachedElement('aft-scan-history-filter-panel');
        var button = getCachedElement('aft-scan-history-filter-toggle');
        if (!panel || !button) {
            return;
        }
        panel.classList.toggle('aft-scan-history-filter-panel-open', open);
        panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        queueLayoutUpdate();
    }

    function clearScanHistoryFilters(hidePanel) {
        var panel = getCachedElement('aft-scan-history-filter-panel');
        var controls;
        var key;
        var i;
        for (key in scanHistoryFilters) {
            if (Object.prototype.hasOwnProperty.call(scanHistoryFilters, key)) {
                scanHistoryFilters[key] = key === 'ageState' ? 'all' : '';
            }
        }
        if (panel) {
            controls = panel.querySelectorAll('[data-scan-history-filter]');
            for (i = 0; i < controls.length; i++) {
                key = controls[i].getAttribute('data-scan-history-filter');
                controls[i].value = scanHistoryFilters[key];
                if (typeof controls[i].__aftRefreshLabel === 'function') {
                    controls[i].__aftRefreshLabel();
                }
            }
        }
        renderScanHistory();
        if (hidePanel) {
            setScanHistoryFilterPanelOpen(false);
        }
    }

    function createScanHistoryFilterPanel() {
        var panel = document.createElement('div');
        var grid = document.createElement('div');
        var ageState = createScanHistoryFilterControl('select', 'ageState');

        panel.id = 'aft-scan-history-filter-panel';
        panel.className = 'aft-scan-history-filter-panel';
        panel.setAttribute('aria-hidden', 'true');
        cachedElements[panel.id] = panel;
        grid.className = 'aft-scan-history-filter-grid';

        appendScanHistoryFilterOption(ageState, 'all', 'Wszystkie');
        appendScanHistoryFilterOption(ageState, 'yes', 'Tak');
        appendScanHistoryFilterOption(ageState, 'no', 'Nie');
        ageState.value = scanHistoryFilters.ageState;
        ageState.setAttribute('aria-label', 'IOL');

        appendScanHistoryRangeFilterField(grid, 'time',
            createScanHistoryDateFilterControl('dateFrom', 'Od', 'Data od'),
            createScanHistoryDateFilterControl('dateTo', 'Do', 'Data do'));
        appendScanHistoryFilterField(grid,
            createScanHistoryFilterControl('text', 'dropZone', 'Drop-Zone'), 'dropzone');
        appendScanHistoryFilterField(grid,
            createScanHistoryFilterControl('text', 'container', 'Kontener'), 'container');
        appendScanHistoryFilterField(grid, ageState, 'age');
        appendScanHistoryRangeFilterField(grid, 'quantity',
            createScanHistoryFilterControl('number', 'quantityMin', 'Od'),
            createScanHistoryFilterControl('number', 'quantityMax', 'Do'));

        panel.appendChild(grid);
        return panel;
    }

    function toggleScanHistoryFilterPanel() {
        var panel = getCachedElement('aft-scan-history-filter-panel');
        var button = getCachedElement('aft-scan-history-filter-toggle');
        var list = getCachedElement('aft-scan-history-list');
        if (!panel || !button) {
            return;
        }
        if (hasActiveScanHistoryFilters()) {
            clearScanHistoryFilters(true);
            return;
        }
        if (list && list.getBoundingClientRect().height < 1) {
            toggleScanHistoryCollapsed();
        }
        setScanHistoryFilterPanelOpen(!panel.classList.contains('aft-scan-history-filter-panel-open'));
    }

    function createScanHistoryBox() {
        var box = document.createElement('section');
        var header = document.createElement('div');
        var body = document.createElement('div');
        var title = document.createElement('div');
        var count = document.createElement('span');
        var actions = document.createElement('div');
        var filterPanel = createScanHistoryFilterPanel();
        var fullscreenBtn = makeButton('', 'Otw\u00f3rz histori\u0119 pe\u0142noekranow\u0105', toggleScanHistoryFullscreen);
        var filterBtn = makeButton('', 'Filtruj histori\u0119 skanowania', toggleScanHistoryFilterPanel);
        var exportBtn = makeButton('', 'Eksportuj histori\u0119 skanowania do Excela', exportScanHistoryXlsx);
        var clearBtn = makeButton('', 'Wyczy\u015b\u0107 zapisan\u0105 histori\u0119 skanowania', clearScanHistory);
        var list = document.createElement('div');
        var resizeHandle = document.createElement('div');

        box.id = 'aft-scan-history-box';
        box.className = 'aft-scan-history-box';
        cachedElements[box.id] = box;
        resizeHandle.id = 'aft-scan-history-resize-handle';
        resizeHandle.className = 'aft-scan-history-resize-handle';
        resizeHandle.title = 'Przeci\u0105gnij g\u00f3rn\u0105 kraw\u0119d\u017a, aby zmieni\u0107 rozmiar historii';
        resizeHandle.setAttribute('role', 'separator');
        resizeHandle.setAttribute('aria-orientation', 'horizontal');
        resizeHandle.setAttribute('aria-valuemin', String(SCAN_HISTORY_MIN_HEIGHT));
        resizeHandle.setAttribute('aria-valuemax', String(getScanHistoryMaxHeight()));
        resizeHandle.tabIndex = 0;
        resizeHandle.addEventListener('pointerdown', startScanHistoryResize);
        resizeHandle.addEventListener('keydown', resizeScanHistoryWithKeyboard);
        cachedElements[resizeHandle.id] = resizeHandle;
        header.className = 'aft-scan-history-header';
        header.title = 'Kliknij, aby ukry\u0107 lub przywr\u00f3ci\u0107 histori\u0119; przeci\u0105gnij g\u00f3rn\u0105 kraw\u0119d\u017a, aby zmieni\u0107 wysoko\u015b\u0107';
        header.addEventListener('pointerdown', function (event) {
            if (getClosestWithClass(event.target, 'aft-scan-history-actions')) {
                return;
            }
            startScanHistoryResize(event);
        });
        body.id = 'aft-scan-history-body';
        body.className = 'aft-scan-history-body';
        cachedElements[body.id] = body;
        title.className = 'aft-scan-history-title';
        title.textContent = 'Historia skanowania ';
        count.id = 'aft-scan-history-count';
        count.className = 'aft-scan-history-count';
        cachedElements[count.id] = count;
        title.appendChild(count);
        actions.className = 'aft-scan-history-actions';
        filterBtn.id = 'aft-scan-history-filter-toggle';
        filterBtn.className += ' aft-scan-history-filter-toggle';
        filterBtn.setAttribute('aria-expanded', 'false');
        styleSmallIconButton(filterBtn);
        cachedElements[filterBtn.id] = filterBtn;
        updateScanHistoryFilterButton();
        fullscreenBtn.id = 'aft-scan-history-fullscreen';
        fullscreenBtn.className += ' aft-scan-history-fullscreen-toggle';
        styleSmallIconButton(fullscreenBtn);
        setScanHistoryFullscreenIcon(fullscreenBtn, false);
        cachedElements[fullscreenBtn.id] = fullscreenBtn;
        exportBtn.id = 'aft-scan-history-export';
        exportBtn.className += ' aft-scan-history-export';
        exportBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M7.5 10.5L12 15l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
        styleSmallIconButton(exportBtn);
        cachedElements[exportBtn.id] = exportBtn;
        clearBtn.id = 'aft-scan-history-reset';
        clearBtn.className += ' aft-scan-history-reset';
        clearBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8V4m0 0h4M5 4l3 3a7 7 0 1 1-2 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        styleSmallIconButton(clearBtn);
        cachedElements[clearBtn.id] = clearBtn;
        list.id = 'aft-scan-history-list';
        list.className = 'aft-scan-history-list';
        cachedElements[list.id] = list;

        actions.appendChild(filterBtn);
        actions.appendChild(exportBtn);
        actions.appendChild(clearBtn);
        actions.appendChild(fullscreenBtn);
        header.appendChild(title);
        header.appendChild(actions);
        box.appendChild(resizeHandle);
        box.appendChild(header);
        body.appendChild(filterPanel);
        body.appendChild(list);
        box.appendChild(body);
        storageSet(STORAGE_KEY_SCAN_HISTORY_COLLAPSED, '0');
        applyScanHistoryHeight(getStoredScanHistoryHeight(), false);
        applyScanHistoryCollapsedState(body, null);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && scanHistoryFullscreen) {
                event.preventDefault();
                event.stopPropagation();
                setScanHistoryFullscreen(false);
            }
        }, true);
        return box;
    }
    function makeButton(text, title, onClick) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.title = title || '';
        btn.style.margin = '0';
        btn.style.padding = '7px 10px';
        btn.style.border = '1px solid #d8e4d8';
        btn.style.borderRadius = '10px';
        btn.style.background = '#ffffff';
        btn.style.color = '#1f5f38';
        btn.style.cursor = 'pointer';
        btn.style.font = '600 13px Arial, sans-serif';
        btn.style.boxShadow = '0 1px 2px rgba(20,40,24,0.06)';
        btn.style.transition = 'background 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease';
        btn.addEventListener('mouseover', function () {
            btn.style.background = '#f4fbf5';
            btn.style.borderColor = '#9fc59f';
        });
        btn.addEventListener('mouseout', function () {
            btn.style.background = btn.getAttribute('data-aft-custom-bg') || '#ffffff';
            btn.style.borderColor = btn.getAttribute('data-aft-custom-border') || '#d8e4d8';
        });
        btn.addEventListener('click', function (e) {
            stopEvent(e);
            if (typeof onClick === 'function') {
                onClick(e);
            }
            return false;
        });
        return btn;
    }

    function animateIconButtonClick(btn) {
        if (!btn || !btn.classList) {
            return;
        }
        if (btn.__aftIconClickAnimationTimer) {
            window.clearTimeout(btn.__aftIconClickAnimationTimer);
        }
        btn.classList.remove('aft-scan-icon-button-clicked');
        try {
            void btn.offsetWidth;
        } catch (e) {}
        btn.classList.add('aft-scan-icon-button-clicked');
        btn.__aftIconClickAnimationStartedAt = now();
        btn.__aftIconClickAnimationTimer = window.setTimeout(function () {
            btn.classList.remove('aft-scan-icon-button-clicked');
            btn.__aftIconClickAnimationTimer = null;
        }, 760);
    }

    function enableIconButtonClickAnimation(btn) {
        if (!btn || btn.__aftIconClickAnimationEnabled) {
            return;
        }
        btn.__aftIconClickAnimationEnabled = true;
        btn.className = trimText((btn.className || '') + ' aft-scan-icon-button-animated');
        btn.addEventListener('pointerdown', function (e) {
            if (!e || e.button === undefined || e.button === 0) {
                animateIconButtonClick(btn);
            }
        }, true);
        btn.addEventListener('keydown', function (e) {
            var key = e && (e.key || e.keyCode);
            if (key === 'Enter' || key === ' ' || key === 13 || key === 32) {
                animateIconButtonClick(btn);
            }
        }, true);
        btn.addEventListener('click', function () {
            if (!btn.__aftIconClickAnimationStartedAt || now() - btn.__aftIconClickAnimationStartedAt > 1000) {
                animateIconButtonClick(btn);
            }
        }, true);
    }

    function styleSmallIconButton(btn) {
        enableIconButtonClickAnimation(btn);
        btn.style.flex = '0 0 auto';
        btn.style.width = '32px';
        btn.style.height = '32px';
        btn.style.minWidth = '32px';
        btn.style.padding = '0';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.lineHeight = '1';
        btn.style.fontSize = '15px';
        btn.style.borderRadius = '10px';
        btn.style.background = '#ffffff';
        btn.style.borderColor = '#d8e4d8';
        btn.style.color = '#285d38';
        btn.setAttribute('data-aft-custom-bg', '#ffffff');
        btn.setAttribute('data-aft-custom-border', '#d8e4d8');
    }

    function setGroupToggleIcon(btn, collapsed) {
        if (!btn) {
            return;
        }
        btn.innerHTML = collapsed
            ? '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.title = collapsed ? 'Rozwi\u0144 grup\u0119' : 'Zwi\u0144 grup\u0119';
    }

    function styleInput(input) {
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';
        input.style.marginBottom = '8px';
        input.style.padding = '10px 12px';
        input.style.borderRadius = '10px';
        input.style.border = '1px solid #cddccd';
        input.style.background = '#ffffff';
        input.style.color = '#253528';
        input.style.font = '13px Arial, sans-serif';
        input.style.outline = 'none';
        input.style.boxShadow = 'none';
    }

    function styleSelectControl(select) {
        select.style.width = '100%';
        select.style.boxSizing = 'border-box';
        select.style.marginBottom = '0';
        select.style.padding = '10px 12px';
        select.style.borderRadius = '10px';
        select.style.border = '1px solid #cddccd';
        select.style.background = '#ffffff';
        select.style.color = '#253528';
        select.style.font = '13px Arial, sans-serif';
        select.style.outline = 'none';
        select.style.boxShadow = 'none';
    }

    function styleGroupCard(groupWrap, groupColor) {
        var color = normalizeHexColor(groupColor || '');
        groupWrap.style.border = '1px solid #dce8dc';
        groupWrap.style.borderRadius = '16px';
        groupWrap.style.marginTop = '14px';
        groupWrap.style.padding = '0';
        groupWrap.style.background = '#ffffff';
        groupWrap.style.borderColor = '#dce8dc';
        groupWrap.style.overflow = 'hidden';
        groupWrap.style.boxSizing = 'border-box';
        groupWrap.style.boxShadow = '0 4px 14px rgba(20,45,25,0.08)';
        groupWrap.style.transition = 'transform 170ms cubic-bezier(0.22, 0.85, 0.25, 1), opacity 160ms ease, margin 160ms ease';
        groupWrap.style.setProperty('--aft-group-accent', color || '#E07B5B');
        groupWrap.style.setProperty('--aft-group-swatch', color || '#E07B5B');
    }

    function styleGroupHeader(header) {
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.gap = '8px';
        header.style.minHeight = '42px';
        header.style.padding = '10px 20px';
        header.style.borderBottom = '2px solid var(--aft-group-accent, #E07B5B)';
        header.style.boxSizing = 'border-box';
    }

    function styleGroupColorButton(btn, color) {
        var normalized = normalizeHexColor(color || '');
        if (String(btn.className || '').indexOf('aft-scan-group-color-button') === -1) {
            btn.className = trimText((btn.className || '') + ' aft-scan-group-color-button');
        }
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.style.background = normalized || '#ffffff';
        btn.style.borderColor = '#d8e4d8';
        btn.style.color = normalized || '#285d38';
        btn.style.boxShadow = normalized ? '0 1px 2px rgba(20,40,24,0.06), inset 0 0 0 2px rgba(255,255,255,0.62)' : '0 1px 2px rgba(20,40,24,0.06)';
        btn.style.setProperty('--aft-group-swatch', normalized || '#E07B5B');
        btn.setAttribute('data-aft-custom-bg', normalized || '#ffffff');
        btn.setAttribute('data-aft-custom-border', '#d8e4d8');
    }

    function setGroupColor(groupId, color) {
        var index = findGroupIndex(groupId);
        if (index < 0 || groupId === UNGROUPED_GROUP_ID) {
            return;
        }
        scanGroups[index].color = normalizeHexColor(color || '');
        saveGroups();
        renderGroups();
    }

    function closeGroupColorPicker() {
        var picker = getCachedElement('aft-scan-group-color-picker');
        if (picker && picker.parentNode) {
            picker.parentNode.removeChild(picker);
        }
        if (cachedElements['aft-scan-group-color-picker']) {
            delete cachedElements['aft-scan-group-color-picker'];
        }
    }

    function openGroupColorPicker(groupId, anchor) {
        var index = findGroupIndex(groupId);
        var currentColor;
        var picker;
        var rect;
        var left;
        var top;

        if (index < 0 || groupId === UNGROUPED_GROUP_ID) {
            return;
        }

        currentColor = normalizeHexColor(scanGroups[index].color || '') || '#E07B5B';
        closeGroupColorPicker();

        picker = document.createElement('input');
        picker.id = 'aft-scan-group-color-picker';
        cachedElements[picker.id] = picker;
        picker.type = 'color';
        picker.value = currentColor;
        picker.title = 'Wybierz kolor grupy';
        picker.style.position = 'fixed';
        picker.style.zIndex = '2147483647';
        picker.style.width = '34px';
        picker.style.height = '34px';
        picker.style.padding = '0';
        picker.style.border = '0';
        picker.style.opacity = '0.01';
        picker.style.pointerEvents = 'none';

        try {
            rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
        } catch (e2) {
            rect = null;
        }
        left = rect ? Math.min(window.innerWidth - 42, Math.max(8, rect.left)) : 20;
        top = rect ? Math.min(window.innerHeight - 42, Math.max(8, rect.top)) : 80;
        picker.style.left = Math.round(left) + 'px';
        picker.style.top = Math.round(top) + 'px';
        picker.addEventListener('change', function () {
            setGroupColor(groupId, picker.value);
            window.setTimeout(closeGroupColorPicker, 0);
        });
        picker.addEventListener('blur', function () {
            window.setTimeout(closeGroupColorPicker, 250);
        });

        document.body.appendChild(picker);
        try {
            picker.focus();
            picker.click();
        } catch (e3) {}
    }

    function styleDragHandle(handle, isGroup) {
        handle.textContent = isGroup ? '\u283F' : '\u22EE\u22EE';
        handle.style.flex = '0 0 auto';
        handle.style.width = isGroup ? '30px' : '24px';
        handle.style.textAlign = 'center';
        handle.style.color = '#527252';
        handle.style.cursor = 'pointer';
        handle.style.userSelect = 'none';
        handle.style.fontSize = isGroup ? '22px' : '18px';
        handle.style.lineHeight = '1';
    }

    function styleDropZoneRow(row, dragHandle, scanBtn, editBtn, matrixBtn, delBtn, isUngrouped) {
        var actionBg = isUngrouped ? '#f8fcf8' : '#ffffff';
        var actionButtons = [editBtn, matrixBtn, delBtn];
        var actionButton;
        var i;
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.boxSizing = 'border-box';
        row.style.gap = '8px';
        row.style.marginTop = '0';
        row.style.padding = '0 8px';
        row.style.border = '1px solid #dce6dc';
        row.style.borderRadius = '12px';
        row.style.background = isUngrouped ? '#f8fcf8' : '#ffffff';
        row.style.boxShadow = '0 2px 7px rgba(20,40,24,0.07)';
        row.style.minHeight = '46px';
        row.style.cursor = 'pointer';
        row.title = 'Przeci\u0105gnij, aby zmieni\u0107 kolejno\u015b\u0107 lub przenie\u015b\u0107 do innej grupy';
        row.style.transition = 'transform 120ms ease, opacity 120ms ease, background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease';

        if (dragHandle) {
            styleDragHandle(dragHandle, false);
        }

        if (String(scanBtn.className || '').indexOf('aft-scan-dropzone-main-button') === -1) {
            scanBtn.className = trimText((scanBtn.className || '') + ' aft-scan-dropzone-main-button');
        }
        scanBtn.style.flex = '1';
        scanBtn.style.margin = '0';
        scanBtn.style.padding = '10px 4px';
        scanBtn.style.border = '0';
        scanBtn.style.background = 'transparent';
        scanBtn.style.boxShadow = 'none';
        scanBtn.style.color = '#1f683a';
        scanBtn.style.font = '700 15px Arial, sans-serif';
        scanBtn.style.textAlign = 'center';
        scanBtn.style.minHeight = '38px';
        scanBtn.style.overflow = 'hidden';
        scanBtn.style.textOverflow = 'ellipsis';
        scanBtn.style.whiteSpace = 'nowrap';
        scanBtn.setAttribute('data-aft-custom-bg', 'transparent');
        scanBtn.setAttribute('data-aft-custom-border', 'transparent');

        for (i = 0; i < actionButtons.length; i++) {
            actionButton = actionButtons[i];
            if (!actionButton) {
                continue;
            }
            if (String(actionButton.className || '').indexOf('aft-scan-dropzone-action-button') === -1) {
                actionButton.className = trimText((actionButton.className || '') + ' aft-scan-dropzone-action-button');
            }
            actionButton.style.width = '32px';
            actionButton.style.height = '32px';
            actionButton.style.minWidth = '32px';
            actionButton.style.background = actionBg;
            actionButton.style.border = '1px solid #d8e4d8';
            actionButton.style.boxShadow = '0 1px 2px rgba(20,40,24,0.06)';
            actionButton.setAttribute('data-aft-custom-bg', actionBg);
            actionButton.setAttribute('data-aft-custom-border', '#d8e4d8');
        }

        editBtn.style.color = '#E07B5B';
        matrixBtn.style.color = '#E07B5B';
    }

    function createDropZoneActionArea(row, actionButtons) {
        var area = document.createElement('div');
        var i;
        area.className = 'aft-scan-dropzone-actions';
        area.style.display = 'flex';
        area.style.alignItems = 'center';
        area.style.alignSelf = 'stretch';
        area.style.flex = '0 0 auto';
        area.style.gap = '8px';
        area.style.marginLeft = '-8px';
        area.style.marginRight = '-8px';
        area.style.paddingLeft = '8px';
        area.style.paddingRight = '8px';
        area.style.boxSizing = 'border-box';
        area.addEventListener('mouseenter', function () {
            row.classList.add('aft-scan-action-hover');
        });
        area.addEventListener('mouseleave', function () {
            row.classList.remove('aft-scan-action-hover');
        });
        for (i = 0; i < actionButtons.length; i++) {
            if (actionButtons[i]) {
                area.appendChild(actionButtons[i]);
            }
        }
        return area;
    }

    function animateDropZoneButtonClick(row) {
        if (!row || !row.classList) {
            return;
        }
        if (row.__aftClickAnimationTimer) {
            window.clearTimeout(row.__aftClickAnimationTimer);
        }
        row.classList.remove('aft-scan-button-clicked');
        try {
            void row.offsetWidth;
        } catch (e) {}
        row.classList.add('aft-scan-button-clicked');
        row.__aftClickAnimationTimer = window.setTimeout(function () {
            row.classList.remove('aft-scan-button-clicked');
            row.__aftClickAnimationTimer = null;
        }, 760);
    }

    function applyDropZoneRowLength(row, scanBtn, labelText) {
        var labelLength = trimText(labelText).length;
        var labelWidth = Math.max(88, Math.min(420, 18 + Math.ceil(labelLength * 8.4)));
        var desiredWidth = labelWidth + 136;

        if (!row) {
            return;
        }

        row.style.flex = '';
        row.style.width = '100%';
        row.style.minWidth = '0';
        row.style.maxWidth = '100%';
        row.style.justifySelf = 'stretch';
        row.style.gridColumn = 'auto';
        row.setAttribute('data-aft-desired-width', String(Math.max(260, Math.min(520, desiredWidth))));

        if (scanBtn) {
            scanBtn.style.flex = '1 1 0';
            scanBtn.style.minWidth = '0';
        }
    }

    function stylePrimaryNewButton(btn) {
        btn.style.width = '100%';
        btn.style.boxSizing = 'border-box';
        btn.style.minHeight = '46px';
        btn.style.margin = '0';
        btn.style.display = 'block';
        btn.style.borderColor = '#1f683a';
        btn.style.color = '#ffffff';
        btn.style.background = 'linear-gradient(180deg, #2f8249 0%, #1f683a 100%)';
        btn.style.fontWeight = 'bold';
        btn.style.fontSize = '15px';
        btn.style.borderRadius = '12px';
        btn.style.boxShadow = '0 6px 14px rgba(31,104,58,0.22)';
        btn.setAttribute('data-aft-custom-bg', '#1f683a');
        btn.setAttribute('data-aft-custom-border', '#1f683a');
    }

    var DATA_MATRIX_SYMBOLS = [
        { size: 10, regionRows: 1, regionCols: 1, regionHeight: 8, regionWidth: 8, data: 3, ecc: 5 },
        { size: 12, regionRows: 1, regionCols: 1, regionHeight: 10, regionWidth: 10, data: 5, ecc: 7 },
        { size: 14, regionRows: 1, regionCols: 1, regionHeight: 12, regionWidth: 12, data: 8, ecc: 10 },
        { size: 16, regionRows: 1, regionCols: 1, regionHeight: 14, regionWidth: 14, data: 12, ecc: 12 },
        { size: 18, regionRows: 1, regionCols: 1, regionHeight: 16, regionWidth: 16, data: 18, ecc: 14 },
        { size: 20, regionRows: 1, regionCols: 1, regionHeight: 18, regionWidth: 18, data: 22, ecc: 18 },
        { size: 22, regionRows: 1, regionCols: 1, regionHeight: 20, regionWidth: 20, data: 30, ecc: 20 },
        { size: 24, regionRows: 1, regionCols: 1, regionHeight: 22, regionWidth: 22, data: 36, ecc: 24 },
        { size: 26, regionRows: 1, regionCols: 1, regionHeight: 24, regionWidth: 24, data: 44, ecc: 28 },
        { size: 32, regionRows: 2, regionCols: 2, regionHeight: 14, regionWidth: 14, data: 62, ecc: 36 }
    ];

    var DATA_MATRIX_RS_COEFFICIENTS = {
        5: [228, 48, 15, 111, 62],
        7: [23, 68, 144, 134, 240, 92, 254],
        10: [28, 24, 185, 166, 223, 248, 116, 255, 110, 61],
        12: [41, 153, 158, 91, 61, 42, 142, 213, 97, 178, 100, 242],
        14: [156, 97, 192, 252, 95, 9, 157, 119, 138, 45, 18, 186, 83, 185],
        18: [83, 195, 100, 39, 188, 75, 66, 61, 241, 213, 109, 129, 94, 254, 225, 48, 90, 188],
        20: [15, 195, 244, 9, 233, 71, 168, 2, 188, 160, 153, 145, 253, 79, 108, 82, 27, 174, 186, 172],
        24: [52, 190, 88, 205, 109, 39, 176, 21, 155, 197, 251, 223, 155, 21, 5, 172, 254, 124, 12, 181, 184, 96, 50, 193],
        28: [211, 231, 43, 97, 71, 96, 103, 174, 37, 151, 170, 53, 75, 34, 249, 121, 17, 138, 110, 213, 141, 136, 120, 151, 233, 168, 93, 255],
        36: [245, 127, 242, 218, 130, 250, 162, 181, 102, 120, 84, 179, 220, 251, 80, 182, 229, 18, 2, 4, 68, 33, 101, 137, 95, 119, 115, 44, 175, 184, 59, 25, 225, 98, 81, 112]
    };

    var dataMatrixGfExp = null;
    var dataMatrixGfLog = null;

    function setDataMatrixButtonIcon(btn) {
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h3v3H2V2zm5 0h2v2H7V2zm4 0h3v3h-3V2zM2 7h2v2H2V7zm4 0h4v4H6V7zm6 0h2v2h-2V7zM2 11h3v3H2v-3zm6 2h2v2H8v-2zm4-2h2v3h-2v-3z" fill="currentColor"/></svg>';
    }

    function initDataMatrixGalois() {
        var x;
        var i;
        if (dataMatrixGfExp && dataMatrixGfLog) {
            return;
        }
        dataMatrixGfExp = [];
        dataMatrixGfLog = [];
        x = 1;
        for (i = 0; i < 255; i++) {
            dataMatrixGfExp[i] = x;
            dataMatrixGfLog[x] = i;
            x <<= 1;
            if (x & 256) {
                x ^= 301;
            }
        }
        for (i = 255; i < 512; i++) {
            dataMatrixGfExp[i] = dataMatrixGfExp[i - 255];
        }
    }

    function dataMatrixGfMultiply(a, b) {
        if (!a || !b) {
            return 0;
        }
        initDataMatrixGalois();
        return dataMatrixGfExp[dataMatrixGfLog[a] + dataMatrixGfLog[b]];
    }

    function encodeDataMatrixAscii(text) {
        var codewords = [];
        var i = 0;
        var c;
        var next;
        while (i < text.length) {
            c = text.charCodeAt(i);
            next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
            if (c >= 48 && c <= 57 && next >= 48 && next <= 57) {
                codewords.push(130 + ((c - 48) * 10) + (next - 48));
                i += 2;
            } else if (c <= 127) {
                codewords.push(c + 1);
                i++;
            } else if (c <= 255) {
                codewords.push(235);
                codewords.push(c - 127);
                i++;
            } else {
                throw new Error('DataMatrix supports only basic text for this button.');
            }
        }
        return codewords;
    }

    function chooseDataMatrixSymbol(codewordCount) {
        var i;
        for (i = 0; i < DATA_MATRIX_SYMBOLS.length; i++) {
            if (codewordCount <= DATA_MATRIX_SYMBOLS[i].data) {
                return DATA_MATRIX_SYMBOLS[i];
            }
        }
        return null;
    }

    function randomizeDataMatrixPad(position) {
        var value = 129 + (((149 * position) % 253) + 1);
        return value <= 254 ? value : value - 254;
    }

    function padDataMatrixCodewords(codewords, capacity) {
        var result = codewords.slice(0);
        if (result.length < capacity) {
            result.push(129);
        }
        while (result.length < capacity) {
            result.push(randomizeDataMatrixPad(result.length + 1));
        }
        return result;
    }

    function createDataMatrixEcc(dataCodewords, eccCount) {
        var coeffs = DATA_MATRIX_RS_COEFFICIENTS[eccCount];
        var ecc = [];
        var result = [];
        var i;
        var j;
        var m;
        if (!coeffs) {
            throw new Error('No DataMatrix error correction table for this size.');
        }
        for (i = 0; i < eccCount; i++) {
            ecc[i] = 0;
        }
        for (i = 0; i < dataCodewords.length; i++) {
            m = dataCodewords[i] ^ ecc[eccCount - 1];
            for (j = eccCount - 1; j > 0; j--) {
                ecc[j] = ecc[j - 1] ^ dataMatrixGfMultiply(m, coeffs[j]);
            }
            ecc[0] = dataMatrixGfMultiply(m, coeffs[0]);
        }
        for (i = eccCount - 1; i >= 0; i--) {
            result.push(ecc[i]);
        }
        return result;
    }

    function placeDataMatrixCodewords(codewords, rows, cols) {
        var modules = [];
        var row = 4;
        var col = 0;
        var pos = 0;
        var i;

        for (i = 0; i < rows * cols; i++) {
            modules[i] = -1;
        }

        function setModule(r, c, p, bit) {
            if (r < 0) {
                r += rows;
                c += 4 - ((rows + 4) % 8);
            }
            if (c < 0) {
                c += cols;
                r += 4 - ((cols + 4) % 8);
            }
            modules[(r * cols) + c] = (codewords[p] & (1 << (8 - bit))) ? 1 : 0;
        }

        function utah(r, c, p) {
            setModule(r - 2, c - 2, p, 1);
            setModule(r - 2, c - 1, p, 2);
            setModule(r - 1, c - 2, p, 3);
            setModule(r - 1, c - 1, p, 4);
            setModule(r - 1, c, p, 5);
            setModule(r, c - 2, p, 6);
            setModule(r, c - 1, p, 7);
            setModule(r, c, p, 8);
        }

        function corner1(p) {
            setModule(rows - 1, 0, p, 1);
            setModule(rows - 1, 1, p, 2);
            setModule(rows - 1, 2, p, 3);
            setModule(0, cols - 2, p, 4);
            setModule(0, cols - 1, p, 5);
            setModule(1, cols - 1, p, 6);
            setModule(2, cols - 1, p, 7);
            setModule(3, cols - 1, p, 8);
        }

        function corner2(p) {
            setModule(rows - 3, 0, p, 1);
            setModule(rows - 2, 0, p, 2);
            setModule(rows - 1, 0, p, 3);
            setModule(0, cols - 4, p, 4);
            setModule(0, cols - 3, p, 5);
            setModule(0, cols - 2, p, 6);
            setModule(0, cols - 1, p, 7);
            setModule(1, cols - 1, p, 8);
        }

        function corner3(p) {
            setModule(rows - 3, 0, p, 1);
            setModule(rows - 2, 0, p, 2);
            setModule(rows - 1, 0, p, 3);
            setModule(0, cols - 2, p, 4);
            setModule(0, cols - 1, p, 5);
            setModule(1, cols - 1, p, 6);
            setModule(2, cols - 1, p, 7);
            setModule(3, cols - 1, p, 8);
        }

        function corner4(p) {
            setModule(rows - 1, 0, p, 1);
            setModule(rows - 1, cols - 1, p, 2);
            setModule(0, cols - 3, p, 3);
            setModule(0, cols - 2, p, 4);
            setModule(0, cols - 1, p, 5);
            setModule(1, cols - 3, p, 6);
            setModule(1, cols - 2, p, 7);
            setModule(1, cols - 1, p, 8);
        }

        do {
            if (row === rows && col === 0) {
                corner1(pos++);
            }
            if (row === rows - 2 && col === 0 && (cols % 4) !== 0) {
                corner2(pos++);
            }
            if (row === rows - 2 && col === 0 && (cols % 8) === 4) {
                corner3(pos++);
            }
            if (row === rows + 4 && col === 2 && (cols % 8) === 0) {
                corner4(pos++);
            }

            do {
                if (row < rows && col >= 0 && modules[(row * cols) + col] < 0) {
                    utah(row, col, pos++);
                }
                row -= 2;
                col += 2;
            } while (row >= 0 && col < cols);
            row += 1;
            col += 3;

            do {
                if (row >= 0 && col < cols && modules[(row * cols) + col] < 0) {
                    utah(row, col, pos++);
                }
                row += 2;
                col -= 2;
            } while (row < rows && col >= 0);
            row += 3;
            col += 1;
        } while (row < rows || col < cols);

        if (modules[(rows * cols) - 1] < 0) {
            modules[(rows * cols) - 1] = 1;
            modules[((rows - 2) * cols) + cols - 2] = 1;
        }

        return modules;
    }

    function buildDataMatrix(text) {
        var encoded = encodeDataMatrixAscii(text);
        var symbol = chooseDataMatrixSymbol(encoded.length);
        var dataRows;
        var dataCols;
        var dataCodewords;
        var codewords;
        var placed;
        var matrix = [];
        var row;
        var col;
        var innerRow;
        var innerCol;
        var regionRow;
        var regionCol;
        var dataRow;
        var dataCol;
        var y;
        var x;

        if (!symbol) {
            throw new Error('Tekst Drop-Zone jest zbyt d\u0142ugi dla wbudowanego kodu DataMatrix.');
        }

        dataRows = symbol.regionRows * symbol.regionHeight;
        dataCols = symbol.regionCols * symbol.regionWidth;
        dataCodewords = padDataMatrixCodewords(encoded, symbol.data);
        codewords = dataCodewords.concat(createDataMatrixEcc(dataCodewords, symbol.ecc));
        placed = placeDataMatrixCodewords(codewords, dataRows, dataCols);

        for (y = 0; y < symbol.size; y++) {
            row = [];
            innerRow = y % (symbol.regionHeight + 2);
            regionRow = Math.floor(y / (symbol.regionHeight + 2));
            for (x = 0; x < symbol.size; x++) {
                innerCol = x % (symbol.regionWidth + 2);
                regionCol = Math.floor(x / (symbol.regionWidth + 2));
                if (innerRow === 0) {
                    row[x] = innerCol % 2 === 0 ? 1 : 0;
                } else if (innerRow === symbol.regionHeight + 1) {
                    row[x] = 1;
                } else if (innerCol === 0) {
                    row[x] = 1;
                } else if (innerCol === symbol.regionWidth + 1) {
                    row[x] = innerRow % 2 === 0 ? 1 : 0;
                } else {
                    dataRow = (regionRow * symbol.regionHeight) + innerRow - 1;
                    dataCol = (regionCol * symbol.regionWidth) + innerCol - 1;
                    row[x] = placed[(dataRow * dataCols) + dataCol] === 1 ? 1 : 0;
                }
            }
            matrix.push(row);
        }

        return matrix;
    }

    function drawDataMatrixCanvas(canvas, text, backgroundColor) {
        var matrix = buildDataMatrix(text);
        var quiet = 4;
        var modules = matrix.length + (quiet * 2);
        var scale = Math.max(5, Math.floor(300 / modules));
        var size = modules * scale;
        var ctx;
        var y;
        var x;

        canvas.width = size;
        canvas.height = size;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        canvas.style.maxWidth = 'min(72vw, 320px)';
        canvas.style.maxHeight = 'min(72vw, 320px)';
        canvas.style.imageRendering = 'pixelated';

        ctx = canvas.getContext('2d');
        ctx.fillStyle = backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000000';
        for (y = 0; y < matrix.length; y++) {
            for (x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x]) {
                    ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
                }
            }
        }
    }

    function closeDataMatrixModal() {
        var overlay = getCachedElement('aft-scan-datamatrix-overlay');
        if (overlay && overlay.__aftKeyHandler) {
            try {
                document.removeEventListener('keydown', overlay.__aftKeyHandler, true);
            } catch (e1) {}
        }
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        if (cachedElements['aft-scan-datamatrix-overlay']) {
            delete cachedElements['aft-scan-datamatrix-overlay'];
        }
    }

    function showDataMatrixModal(scanText, labelText) {
        var dark = isDarkModeEnabled();
        var overlay;
        var card;
        var topRow;
        var title;
        var closeBtn;
        var canvasWrap;
        var canvas;
        var value;
        var error;
        var keyHandler;

        scanText = trimText(scanText);
        labelText = trimText(labelText || scanText);
        if (!scanText) {
            return;
        }

        closeDataMatrixModal();

        overlay = document.createElement('div');
        overlay.id = 'aft-scan-datamatrix-overlay';
        cachedElements[overlay.id] = overlay;
        overlay.style.position = 'fixed';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.right = '0';
        overlay.style.bottom = '0';
        overlay.style.zIndex = '2147483647';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.padding = '18px';
        overlay.style.boxSizing = 'border-box';
        overlay.style.background = dark ? 'rgba(5,7,10,0.72)' : 'rgba(18,35,22,0.22)';

        card = document.createElement('div');
        card.className = 'aft-scan-datamatrix-card';
        card.style.width = 'min(420px, 92vw)';
        card.style.boxSizing = 'border-box';
        card.style.borderRadius = '16px';
        card.style.border = dark ? '1px solid #364351' : '1px solid #dce8dc';
        card.style.background = dark ? '#11161D' : '#ffffff';
        card.style.color = dark ? '#EFF4F8' : '#253528';
        card.style.boxShadow = dark ? '0 18px 42px rgba(0,0,0,0.66)' : '0 18px 42px rgba(20,45,25,0.22)';
        card.style.padding = '14px';
        card.style.font = '13px Arial, sans-serif';

        topRow = document.createElement('div');
        topRow.className = 'aft-scan-datamatrix-header';
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '8px';
        topRow.style.marginBottom = '12px';

        title = document.createElement('div');
        title.textContent = labelText;
        title.style.flex = '1';
        title.style.minWidth = '0';
        title.style.overflow = 'hidden';
        title.style.textOverflow = 'ellipsis';
        title.style.whiteSpace = 'nowrap';
        title.style.fontWeight = '700';
        title.style.fontSize = '16px';

        closeBtn = makeButton('\u00D7', 'Zamknij DataMatrix', function () {
            closeDataMatrixModal();
        });
        closeBtn.className = trimText((closeBtn.className || '') + ' aft-scan-datamatrix-close');
        styleSmallIconButton(closeBtn);
        closeBtn.style.color = '#E07B5B';
        closeBtn.style.background = dark ? '#18202A' : '#ffffff';
        closeBtn.style.borderColor = dark ? '#364351' : '#d8e4d8';

        canvasWrap = document.createElement('div');
        canvasWrap.className = 'aft-scan-datamatrix-canvas-wrap';
        canvasWrap.style.display = 'flex';
        canvasWrap.style.justifyContent = 'center';
        canvasWrap.style.alignItems = 'center';
        canvasWrap.style.padding = '14px';
        canvasWrap.style.borderRadius = '14px';
        canvasWrap.style.background = dark ? '#E07B5B' : '#ffffff';
        canvasWrap.style.border = dark ? '1px solid #364351' : '1px solid #e6eee6';

        canvas = document.createElement('canvas');
        try {
            drawDataMatrixCanvas(canvas, scanText, dark ? '#E07B5B' : '#ffffff');
            canvasWrap.appendChild(canvas);
        } catch (e2) {
            error = document.createElement('div');
            error.textContent = e2 && e2.message ? e2.message : 'Nie uda\u0142o si\u0119 utworzy\u0107 DataMatrix.';
            error.style.color = '#E07B5B';
            error.style.fontWeight = '700';
            error.style.textAlign = 'center';
            canvasWrap.appendChild(error);
        }

        value = document.createElement('div');
        value.className = 'aft-scan-datamatrix-value';
        value.textContent = scanText;
        value.style.marginTop = '12px';
        value.style.padding = '10px 12px';
        value.style.borderRadius = '10px';
        value.style.border = dark ? '1px solid #364351' : '1px solid #dce8dc';
        value.style.background = dark ? '#0B0F14' : '#f7fbf7';
        value.style.color = dark ? '#AEB8C2' : '#315c31';
        value.style.font = '700 13px Consolas, monospace';
        value.style.textAlign = 'center';
        value.style.overflow = 'hidden';
        value.style.textOverflow = 'ellipsis';
        value.style.whiteSpace = 'nowrap';

        topRow.appendChild(title);
        topRow.appendChild(closeBtn);
        card.appendChild(topRow);
        card.appendChild(canvasWrap);
        card.appendChild(value);
        overlay.appendChild(card);

        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) {
                closeDataMatrixModal();
                return stopEvent(e);
            }
            if (e && e.stopPropagation) {
                e.stopPropagation();
            }
            return true;
        }, false);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closeDataMatrixModal();
                return stopEvent(e);
            }
            if (e && e.stopPropagation) {
                e.stopPropagation();
            }
            return true;
        }, false);
        card.addEventListener('mousedown', function (e) {
            if (e && e.stopPropagation) {
                e.stopPropagation();
            }
        }, false);
        card.addEventListener('click', function (e) {
            if (e && e.stopPropagation) {
                e.stopPropagation();
            }
        }, false);

        keyHandler = function (e) {
            if (e && (e.key === 'Escape' || e.keyCode === 27)) {
                closeDataMatrixModal();
                return stopEvent(e);
            }
        };
        overlay.__aftKeyHandler = keyHandler;
        try {
            document.addEventListener('keydown', keyHandler, true);
        } catch (e3) {}

        document.body.appendChild(overlay);
    }

    function resetPendingDropZoneDelete() {
        if (pendingDeleteButtonTimer) {
            try {
                window.clearTimeout(pendingDeleteButtonTimer);
            } catch (e1) {}
        }
        pendingDeleteButtonTimer = null;

        if (pendingDeleteButton) {
            pendingDeleteButton.textContent = pendingDeleteButton.__aftDeleteBaseText || '\u00D7';
            pendingDeleteButton.title = pendingDeleteButton.__aftDeleteBaseTitle || 'Usu\u0144 Drop-Zone';
            pendingDeleteButton.style.setProperty('background', pendingDeleteButton.__aftDeleteBaseBg || '#ffffff', '');
            pendingDeleteButton.style.setProperty('border-color', pendingDeleteButton.__aftDeleteBaseBorder || '#d8e4d8', '');
            pendingDeleteButton.style.setProperty('color', pendingDeleteButton.__aftDeleteBaseColor || '#b45a5a', '');
            pendingDeleteButton.style.transform = '';
            pendingDeleteButton.setAttribute('data-aft-custom-bg', pendingDeleteButton.__aftDeleteBaseBg || '#ffffff');
            pendingDeleteButton.setAttribute('data-aft-custom-border', pendingDeleteButton.__aftDeleteBaseBorder || '#d8e4d8');
        }

        if (pendingDeleteRow) {
            pendingDeleteRow.style.setProperty('box-shadow', pendingDeleteRow.__aftDeleteBaseShadow || '', '');
            pendingDeleteRow.style.setProperty('border-color', pendingDeleteRow.__aftDeleteBaseBorder || '', '');
            pendingDeleteRow.style.transform = '';
            pendingDeleteRow.title = pendingDeleteRow.__aftDeleteBaseTitle || 'Przeci\u0105gnij, aby zmieni\u0107 kolejno\u015b\u0107 lub przenie\u015b\u0107 do innej grupy';
        }

        pendingDeleteButtonKey = '';
        pendingDeleteButton = null;
        pendingDeleteRow = null;
    }

    function deleteDropZoneButton(groupId, buttonId) {
        var groupIndex = findGroupIndex(groupId);
        var buttonIndex;

        if (groupIndex < 0) {
            return;
        }

        buttonIndex = findButtonIndex(scanGroups[groupIndex], buttonId);
        if (buttonIndex < 0) {
            return;
        }

        scanGroups[groupIndex].buttons.splice(buttonIndex, 1);
        if (activeAgeButtonId === buttonId) {
            activeAgeButtonId = '';
            activeAgeDropZoneText = '';
            activeAgeDropZoneLabel = '';
            lastAgeScanSignature = '';
        }
        resetPendingDropZoneDelete();
        saveGroups();
        renderGroups();
    }

    function animateDeleteConfirmation(row) {
        try {
            if (row && row.animate) {
                row.animate([
                    { transform: 'translateX(0)' },
                    { transform: 'translateX(-2px)' },
                    { transform: 'translateX(2px)' },
                    { transform: 'translateX(0)' }
                ], {
                    duration: 260,
                    easing: 'ease'
                });
            }
        } catch (e) {}
    }

    function confirmDeleteDropZoneButton(groupId, buttonId, delBtn, row) {
        var key = groupId + '|' + buttonId;
        var baseBg;
        var baseBorder;
        var baseColor;

        if (pendingDeleteButtonKey === key) {
            deleteDropZoneButton(groupId, buttonId);
            return;
        }

        resetPendingDropZoneDelete();

        pendingDeleteButtonKey = key;
        pendingDeleteButton = delBtn;
        pendingDeleteRow = row;

        if (delBtn) {
            baseBg = delBtn.getAttribute('data-aft-custom-bg') || '#ffffff';
            baseBorder = delBtn.getAttribute('data-aft-custom-border') || '#d8e4d8';
            baseColor = delBtn.style.color || '#b45a5a';
            delBtn.__aftDeleteBaseBg = baseBg;
            delBtn.__aftDeleteBaseBorder = baseBorder;
            delBtn.__aftDeleteBaseColor = baseColor;
            delBtn.__aftDeleteBaseText = delBtn.textContent || '\u00D7';
            delBtn.__aftDeleteBaseTitle = delBtn.title || 'Usu\u0144 Drop-Zone';
            delBtn.textContent = '!';
            delBtn.title = 'Kliknij ponownie, aby usun\u0105\u0107';
            delBtn.setAttribute('data-aft-custom-bg', '#E07B5B');
            delBtn.setAttribute('data-aft-custom-border', '#E07B5B');
            delBtn.style.setProperty('background', '#E07B5B', 'important');
            delBtn.style.setProperty('border-color', '#E07B5B', 'important');
            delBtn.style.setProperty('color', '#ffffff', 'important');
        }

        if (row) {
            row.__aftDeleteBaseShadow = row.style.boxShadow || '';
            row.__aftDeleteBaseBorder = row.style.borderColor || '';
            row.__aftDeleteBaseTitle = row.title || 'Przeci\u0105gnij, aby zmieni\u0107 kolejno\u015b\u0107 lub przenie\u015b\u0107 do innej grupy';
            row.title = 'Kliknij usu\u0144 ponownie, aby potwierdzi\u0107';
            row.style.setProperty('box-shadow', '0 0 0 2px rgba(224,123,91,0.46), 0 6px 14px rgba(224,123,91,0.20)', 'important');
            row.style.setProperty('border-color', '#E07B5B', 'important');
        }

        animateDeleteConfirmation(row);
        pendingDeleteButtonTimer = window.setTimeout(resetPendingDropZoneDelete, DELETE_CONFIRM_MS);
    }
    function installPanelStyle() {
        if (getCachedElement('aft-scan-buttons-panel-style')) {
            return;
        }
        var style = document.createElement('style');
        style.id = 'aft-scan-buttons-panel-style';
        style.textContent = `#aft-scan-buttons-panel input:focus,
#aft-scan-buttons-panel select:focus,
#aft-scan-buttons-panel textarea:focus,
#aft-scan-buttons-panel button:focus {
  outline: none !important;
  box-shadow: none !important;
}
#aft-scan-buttons-panel input:focus,
#aft-scan-buttons-panel select:focus,
#aft-scan-buttons-panel textarea:focus {
  border-color: #7aa97a !important;
}
#aft-scan-buttons-panel * {
  -webkit-tap-highlight-color: transparent;
}
.aft-dropzone-context-menu {
  position: fixed;
  z-index: 2147483646;
  min-width: 204px;
  padding: 6px;
  border: 1px solid var(--aft-light-border, #D4CCC2);
  border-radius: 10px;
  box-sizing: border-box;
  background: var(--aft-light-surface-raised, #FCFAF6);
  box-shadow: 0 12px 30px rgba(43, 35, 30, 0.22);
}
.aft-dropzone-context-menu-action {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--aft-light-text, #2F3337);
  font: 700 13px Arial, sans-serif;
  text-align: left;
  cursor: pointer;
}
.aft-dropzone-context-menu-action:hover,
.aft-dropzone-context-menu-action:focus-visible {
  outline: none;
  background: var(--aft-light-surface-hover, #E6E0D8);
}
.aft-dropzone-context-menu-icon {
  display: inline-flex;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--aft-light-border, #D4CCC2);
  border-radius: 6px;
  box-sizing: border-box;
  color: var(--aft-light-icon, #3E4247);
}
html.aft-auto-dropzone-dark .aft-dropzone-context-menu {
  border-color: #344150;
  background: #11161D;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.52);
}
html.aft-auto-dropzone-dark .aft-dropzone-context-menu-action {
  color: #E6EDF3;
}
html.aft-auto-dropzone-dark .aft-dropzone-context-menu-action:hover,
html.aft-auto-dropzone-dark .aft-dropzone-context-menu-action:focus-visible {
  background: #25303C;
}
html.aft-auto-dropzone-dark .aft-dropzone-context-menu-icon {
  border-color: #344150;
  color: #F2F5F7;
}
.aft-scan-button-row.aft-dropzone-duplicate-source {
  position: relative;
  transform-origin: right center;
  animation: aft-dropzone-cell-source-split 760ms cubic-bezier(0.2, 0.82, 0.24, 1);
}
.aft-scan-button-row.aft-dropzone-duplicate-source::after {
  content: "";
  position: absolute;
  z-index: 3;
  top: 8%;
  right: -6px;
  width: 2px;
  height: 84%;
  border-radius: 999px;
  background: #E07B5B;
  pointer-events: none;
  animation: aft-dropzone-cell-division-line 760ms ease-out;
}
.aft-scan-button-row.aft-dropzone-duplicate-copy {
  transform-origin: left center;
  animation: aft-dropzone-cell-copy-split 760ms cubic-bezier(0.2, 0.82, 0.24, 1);
}
@keyframes aft-dropzone-cell-source-split {
  0%, 100% { transform: scaleX(1); }
  34% { transform: scaleX(0.9); }
  58% { transform: scaleX(0.96); }
}
@keyframes aft-dropzone-cell-copy-split {
  0% { opacity: 0; transform: translateX(-55%) scaleX(0.14); }
  38% { opacity: 0.72; transform: translateX(-22%) scaleX(0.62); }
  68% { opacity: 1; transform: translateX(2%) scaleX(1.02); }
  100% { opacity: 1; transform: translateX(0) scaleX(1); }
}
@keyframes aft-dropzone-cell-division-line {
  0%, 100% { opacity: 0; transform: scaleY(0.2); }
  30%, 62% { opacity: 1; transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .aft-scan-button-row.aft-dropzone-duplicate-source,
  .aft-scan-button-row.aft-dropzone-duplicate-copy,
  .aft-scan-button-row.aft-dropzone-duplicate-source::after {
    animation: none;
  }
}
.aft-scan-button-row.aft-scan-button-clicked {
  animation: aft-dropzone-click-press 720ms cubic-bezier(0.22,0.75,0.26,1);
}
.aft-scan-icon-button-animated.aft-scan-icon-button-clicked {
  animation: aft-dropzone-click-press 720ms cubic-bezier(0.22,0.75,0.26,1);
}
@keyframes aft-dropzone-click-press {
  0%, 100% { transform: scale(1); }
  30% { transform: scale(0.97); }
  64% { transform: scale(1.008); }
}
@media (prefers-reduced-motion: reduce) {
  .aft-scan-button-row.aft-scan-button-clicked {
    animation: none;
  }
  .aft-scan-icon-button-animated.aft-scan-icon-button-clicked {
    animation: none;
  }
}
#aft-scan-buttons-panel ::placeholder {
  color: #8d9a8f;
}
#aft-scan-quick-buttons::-webkit-scrollbar {
  width: 8px;
}
#aft-scan-quick-buttons::-webkit-scrollbar-thumb {
  background: #cddccd;
  border-radius: 999px;
}
#aft-scan-quick-buttons::-webkit-scrollbar-track {
  background: transparent;
}
.aft-scan-history-box {
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  margin: 0 6px 14px;
  border: 1px solid #d7e2d7;
  border-radius: 16px;
  background: #ffffff;
  overflow: hidden;
  box-sizing: border-box;
  box-shadow: 0 4px 14px rgba(20,45,25,0.08);
}
.aft-scan-history-resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  height: 9px;
  cursor: ns-resize;
  touch-action: none;
  outline: none;
}
.aft-scan-history-resize-handle::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 50%;
  width: 54px;
  height: 3px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgba(224,123,91,0.45);
  transition: width 140ms ease, background 140ms ease;
}
.aft-scan-history-resize-handle:hover::after,
.aft-scan-history-resize-handle:focus-visible::after,
html.aft-resizing-scan-history .aft-scan-history-resize-handle::after {
  width: 82px;
  background: #E07B5B;
}
html.aft-resizing-scan-history,
html.aft-resizing-scan-history * {
  cursor: ns-resize !important;
  user-select: none !important;
}
.aft-scan-history-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 10px 20px;
  border-bottom: 2px solid #E07B5B;
  box-sizing: border-box;
  cursor: pointer;
}
.aft-scan-history-title {
  min-width: 0;
  overflow: hidden;
  justify-self: stretch;
  font-size: 20px;
  font-weight: 700;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aft-scan-history-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 5px;
  padding: 0;
  background: transparent;
  color: #E07B5B;
  font-size: 20px;
  font-weight: 700;
}
.aft-scan-history-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.aft-scan-history-actions {
  justify-self: end;
}
.aft-scan-history-filter-toggle {
  position: relative;
  flex: 0 0 auto;
}
.aft-scan-history-filter-toggle.aft-scan-history-filter-active::after {
  content: none;
}
.aft-scan-history-filter-toggle.aft-scan-history-filter-active {
  width: auto !important;
  min-width: max-content !important;
  padding: 0 10px !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  white-space: nowrap !important;
}
.aft-scan-history-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.aft-scan-history-filter-panel {
  display: none;
  flex: 0 0 auto;
  padding: 12px;
  border-bottom: 1px solid #D5DDD7;
  background: #F5F7F5;
}
.aft-scan-history-filter-panel-open {
  display: block;
}
#aft-scan-history-box.aft-scan-history-content-hidden .aft-scan-history-filter-panel {
  display: none !important;
}
.aft-scan-history-filter-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.aft-scan-history-filter-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.aft-scan-history-filter-control {
  width: 100%;
  height: 32px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid #CAD4CD;
  border-radius: 7px;
  box-sizing: border-box;
  background: #FFFFFF;
  color: #29342D;
  font-size: 13px;
}
.aft-scan-history-filter-range {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  min-width: 0;
}
.aft-scan-history-date-picker {
  position: relative;
  min-width: 0;
}
.aft-scan-history-date-native {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
.aft-scan-history-date-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.aft-scan-history-date-icon {
  display: inline-flex;
  flex: 0 0 15px;
  width: 15px;
  height: 15px;
  opacity: 0.72;
}
.aft-scan-history-date-icon svg {
  width: 15px;
  height: 15px;
}
.aft-scan-history-date-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.aft-scan-history-actions .aft-scan-history-export:disabled,
.aft-scan-history-actions .aft-scan-history-reset:disabled {
  opacity: 0.45;
  cursor: default;
}
.aft-scan-history-list {
  height: var(--aft-scan-history-list-height, 220px);
  min-height: 0;
  max-height: none;
  overflow: auto;
  scrollbar-width: thin;
}
.aft-scan-history-box.aft-scan-history-collapse-preview .aft-scan-history-list {
  opacity: var(--aft-scan-history-collapse-opacity, 1);
  transform: translateY(var(--aft-scan-history-collapse-offset, 0)) scaleY(var(--aft-scan-history-collapse-scale, 1));
  transform-origin: bottom center;
}
html.aft-scan-history-fullscreen,
html.aft-scan-history-fullscreen body {
  overflow: hidden !important;
}
html.aft-scan-history-fullscreen #aft-scan-buttons-panel {
  overflow: visible !important;
}
#aft-scan-history-box.aft-scan-history-fullscreen {
  position: fixed !important;
  inset: 8px !important;
  z-index: 2147483647 !important;
  width: auto !important;
  height: auto !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  border-radius: 12px !important;
  box-shadow: 0 20px 60px rgba(0,0,0,0.44) !important;
}
#aft-scan-history-box.aft-scan-history-fullscreen .aft-scan-history-resize-handle {
  display: block !important;
  z-index: 12;
}
#aft-scan-history-box.aft-scan-history-fullscreen .aft-scan-history-header {
  flex: 0 0 auto;
}
#aft-scan-history-box.aft-scan-history-fullscreen .aft-scan-history-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none !important;
  opacity: 1 !important;
  overflow: hidden !important;
  pointer-events: auto !important;
}
#aft-scan-history-box.aft-scan-history-fullscreen .aft-scan-history-list {
  flex: 1 1 auto;
  height: 100% !important;
  min-height: 0 !important;
  max-height: none !important;
}
.aft-scan-history-columns,
.aft-scan-history-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  column-gap: 12px;
  min-width: 800px;
  padding: 7px 12px;
  box-sizing: border-box;
}
.aft-scan-history-columns {
  position: sticky;
  top: 0;
  z-index: 2;
  min-height: 42px;
  padding-top: 0;
  padding-bottom: 0;
  border-top: 0;
  border-bottom: 1px solid #CCD5CF;
  background: #FFFFFF;
  box-shadow: none;
  color: #66716A;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}
.aft-scan-history-column {
  position: relative;
  align-self: stretch;
  min-width: 0;
  border-right: 0;
}
.aft-scan-history-column-active::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 3px;
  background: #E07B5B;
}
.aft-scan-history-sort-button {
  width: 100%;
  height: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  text-transform: inherit;
  box-shadow: none;
  cursor: pointer;
}
.aft-scan-history-sort-button:hover,
.aft-scan-history-sort-button:focus-visible,
.aft-scan-history-sort-active {
  background: transparent;
  color: #29342D;
}
.aft-scan-history-column-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aft-scan-history-sort-indicator {
  display: none;
  flex: 0 0 auto;
  opacity: 0.32;
  transition: transform 140ms ease, opacity 140ms ease;
}
.aft-scan-history-sort-active .aft-scan-history-sort-indicator {
  display: inline-flex;
  opacity: 1;
}
.aft-scan-history-sort-desc {
  transform: rotate(180deg);
}
.aft-scan-history-row {
  border-top: 1px solid #e1e8e3;
  min-height: 38px;
  font-size: 14px;
}
.aft-scan-history-row > div {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 720px) {
  .aft-scan-history-columns,
  .aft-scan-history-row {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    column-gap: 4px;
    min-width: 0;
    padding-left: 6px;
    padding-right: 6px;
  }
  .aft-scan-history-columns {
    min-height: 38px;
    font-size: 10px;
  }
  .aft-scan-history-row {
    min-height: 34px;
    font-size: 12px;
  }
  .aft-scan-history-sort-button {
    min-height: 36px;
    gap: 2px;
  }
  .aft-scan-history-filter-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
  }
  .aft-scan-history-filter-panel {
    padding-right: 6px;
    padding-left: 6px;
  }
  .aft-scan-history-filter-control {
    padding-right: 4px;
    padding-left: 4px;
    font-size: 11px;
  }
}
.aft-scan-history-container,
.aft-scan-history-age,
.aft-scan-history-quantity {
  font-weight: 700;
}
.aft-scan-history-container {
  display: flex;
  align-items: center;
  gap: 4px;
}
.aft-scan-history-container-id {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aft-scan-history-container-links {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}
.aft-scan-history-container-link {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0 !important;
  border: 1px solid var(--aft-light-border, #D4CCC2) !important;
  border-radius: 4px;
  box-sizing: border-box;
  background: var(--aft-light-surface-raised, #FCFAF6) !important;
  color: var(--aft-light-icon, #3E4247) !important;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  text-decoration: none !important;
}
.aft-scan-history-container-link:hover,
.aft-scan-history-container-link:focus-visible {
  border-color: var(--aft-light-border-strong, #BEB3A7) !important;
  background: var(--aft-light-surface-hover, #E6E0D8) !important;
  color: var(--aft-light-icon, #3E4247) !important;
}
.aft-scan-history-container-copy-confirmed,
.aft-scan-history-container-copy-confirmed:hover,
.aft-scan-history-container-copy-confirmed:focus-visible {
  border-color: #E07B5B !important;
  background: #E07B5B !important;
  color: #FFFFFF !important;
  animation: aft-scan-history-copy-confirmed 900ms cubic-bezier(0.2, 0.82, 0.24, 1);
}
@keyframes aft-scan-history-copy-confirmed {
  0%, 100% { transform: scale(1); }
  24% { transform: scale(1.3) rotate(-7deg); }
  48% { transform: scale(0.92) rotate(3deg); }
  70% { transform: scale(1.08) rotate(0); }
}
@media (prefers-reduced-motion: reduce) {
  .aft-scan-history-container-copy-confirmed,
  .aft-scan-history-container-copy-confirmed:hover,
  .aft-scan-history-container-copy-confirmed:focus-visible {
    animation: none;
  }
}
.aft-scan-history-age,
.aft-scan-history-quantity {
  color: #C96345;
}
.aft-scan-history-loading .aft-scan-history-age {
  opacity: 0.65;
}
.aft-scan-history-error .aft-scan-history-age {
  color: #a24c4c;
}
.aft-scan-history-missing .aft-scan-history-age,
.aft-scan-history-missing .aft-scan-history-quantity {
  color: #7A817F;
}
.aft-scan-history-empty {
  padding: 18px 12px;
  color: #7a887e;
  text-align: center;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-box {
  background: #0D1218 !important;
  border-color: #2A3440 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-header {
  background: #11161D !important;
  border-bottom-color: #E07B5B !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-filter-panel {
  background: #111820 !important;
  border-color: #303C49 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-filter-control {
  background: #0D1218 !important;
  color: #EFF4F8 !important;
  border-color: #3A4857 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-resize-handle::after {
  background: rgba(224,123,91,0.58);
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-columns {
  background: #0D1218 !important;
  color: #9EABB8 !important;
  border-top-color: transparent !important;
  border-bottom-color: #303C49 !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-column {
  border-right-color: transparent !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-sort-button {
  background: transparent !important;
  color: #D1DAE3 !important;
  border: 0 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-sort-button:hover,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-sort-button:focus-visible,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-sort-active {
  background: transparent !important;
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-row {
  background: #0D1218 !important;
  border-color: #222D38 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-age,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-quantity {
  color: #E07B5B !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-container-link {
  border-color: #2A3440 !important;
  background: #11161D !important;
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-container-link:hover,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-container-link:focus-visible {
  border-color: #465564 !important;
  background: #18202A !important;
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-container-copy-confirmed,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-container-copy-confirmed:hover,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-container-copy-confirmed:focus-visible {
  border-color: #E07B5B !important;
  background: #E07B5B !important;
  color: #FFFFFF !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-count {
  background: transparent !important;
  color: #E07B5B !important;
}
.aft-script-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  background: rgba(32, 35, 38, 0.34);
  backdrop-filter: blur(3px);
}
.aft-script-dialog {
  width: min(520px, 94vw);
  padding: 20px;
  border: 1px solid #D4CCC2;
  border-radius: 16px;
  box-sizing: border-box;
  background: #F8F5F0;
  color: #292C30;
  box-shadow: 0 22px 60px rgba(32, 27, 23, 0.28);
}
.aft-script-dialog-title {
  font-size: 21px;
  font-weight: 800;
}
.aft-script-dialog-message {
  margin-top: 9px;
  color: #555A60;
  font-size: 14px;
  line-height: 1.45;
}
.aft-script-dialog-fields {
  margin-top: 16px;
}
.aft-script-dialog-form,
.aft-script-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.aft-script-dialog-form {
  gap: 13px;
}
.aft-script-dialog-field > span {
  color: #555A60;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
.aft-script-dialog-field input,
.aft-script-dialog-field select {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #D4CCC2;
  border-radius: 10px;
  box-sizing: border-box;
  background: #FCFAF6;
  color: #292C30;
  font: 600 14px/1 Arial, sans-serif;
  outline: none;
}
.aft-script-dialog-field input:focus,
.aft-script-dialog-field select:focus {
  border-color: #E07B5B;
  box-shadow: 0 0 0 3px rgba(224, 123, 91, 0.16);
}
.aft-script-dialog-new-group-row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.aft-script-dialog-new-group-row input {
  flex: 1 1 auto;
  min-width: 0;
}
.aft-script-dialog-create-group {
  flex: 0 0 auto;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid #D4CCC2;
  border-radius: 10px;
  font-weight: 700;
}
.aft-script-dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 20px;
}
.aft-script-dialog-button {
  min-height: 38px;
  padding: 0 15px;
  border: 1px solid #D4CCC2;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
}
.aft-script-dialog-cancel {
  background: #EEE9E2;
  color: #555A60;
}
.aft-script-dialog-primary {
  background: #E07B5B;
  color: #FFFFFF;
  border-color: #E07B5B;
}
.aft-script-dialog-danger {
  background: #C95151;
  color: #FFFFFF;
  border-color: #C95151;
}
html.aft-auto-dropzone-dark .aft-script-dialog-overlay {
  background: rgba(3, 6, 9, 0.68);
}
html.aft-auto-dropzone-dark .aft-script-dialog {
  background: #11161D;
  color: #EFF4F8;
  border-color: #364351;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.62);
}
html.aft-auto-dropzone-dark .aft-script-dialog-message,
html.aft-auto-dropzone-dark .aft-script-dialog-field > span {
  color: #AAB5BF;
}
html.aft-auto-dropzone-dark .aft-script-dialog-field input,
html.aft-auto-dropzone-dark .aft-script-dialog-field select {
  background: #0D1218;
  color: #EFF4F8;
  border-color: #364351;
}
html.aft-auto-dropzone-dark .aft-script-dialog-field select option {
  background: #11161D;
  color: #EFF4F8;
}
html.aft-auto-dropzone-dark .aft-script-dialog-cancel {
  background: #18202A;
  color: #EFF4F8;
  border-color: #364351;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-error .aft-scan-history-age {
  color: #F09A80 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-missing .aft-scan-history-age,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-history-missing .aft-scan-history-quantity {
  color: #8B98A5 !important;
}
#aft-latest-container-age {
  position: absolute;
  inset: 0;
  z-index: 20;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 0 22px;
  pointer-events: none;
  box-sizing: border-box;
  overflow: hidden;
  background: #0D1218;
  border: 2px solid #E07B5B;
  box-shadow: 0 8px 24px rgba(0,0,0,0.44), inset 0 0 0 1px rgba(224,123,91,0.18);
  font-family: Arial, sans-serif;
  line-height: 1;
  letter-spacing: 0;
  text-align: center;
  transition: opacity 140ms ease, color 140ms ease, border-color 140ms ease;
}
#aft-latest-container-age .aft-latest-container-id {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: #EFF4F8 !important;
  font-size: var(--aft-latest-ts-size, 20px);
  font-weight: 700;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#scan-container.aft-latest-container-visible > :not(#aft-latest-container-age):not(.aft-scan-waiting-pulse):not(.aft-direct-scan-input) {
  visibility: hidden !important;
}
#aft-latest-age-box .aft-latest-container-age-value,
#aft-latest-quantity-box .aft-latest-container-quantity-value {
  flex: 1 1 auto;
  min-width: 0;
  color: #E07B5B !important;
  font-size: var(--aft-latest-age-size, 38px);
  font-weight: 800;
  text-align: center;
  white-space: nowrap;
}
#aft-latest-quantity-box .aft-latest-container-quantity-value {
  font-size: var(--aft-latest-quantity-size, 38px);
}
#aft-latest-age-box.aft-latest-age-loading .aft-latest-container-age-value {
  color: #F0A68F !important;
}
#aft-latest-quantity-box.aft-latest-age-loading .aft-latest-container-quantity-value {
  color: #F0A68F !important;
}
#aft-latest-age-box.aft-latest-age-missing .aft-latest-container-age-value,
#aft-latest-age-box.aft-latest-age-empty .aft-latest-container-age-value,
#aft-latest-quantity-box.aft-latest-age-missing .aft-latest-container-quantity-value,
#aft-latest-quantity-box.aft-latest-age-empty .aft-latest-container-quantity-value {
  color: #8B98A5 !important;
}
#aft-latest-age-box.aft-latest-age-error .aft-latest-container-age-value,
#aft-latest-quantity-box.aft-latest-age-error .aft-latest-container-quantity-value {
  color: #D85454 !important;
}
#aft-latest-age-box.aft-latest-age-error,
#aft-latest-age-box.aft-latest-age-missing,
#aft-latest-quantity-box.aft-latest-age-error,
#aft-latest-quantity-box.aft-latest-age-missing {
  border-color: #465564;
}`;
        document.head.appendChild(style);
        cachedElements[style.id] = style;
    }

    function installDarkModeStyle() {
        if (getCachedElement('aft-auto-dropzone-dark-style')) {
            return;
        }

        var style = document.createElement('style');
        style.id = 'aft-auto-dropzone-dark-style';
        style.textContent = `html.aft-auto-dropzone-dark,
html.aft-auto-dropzone-dark body {
  background: #0c120f !important;
  color: #e2eee7 !important;
  color-scheme: dark;
}
html.aft-auto-dropzone-dark body div,
html.aft-auto-dropzone-dark body span,
html.aft-auto-dropzone-dark body h1,
html.aft-auto-dropzone-dark body h2,
html.aft-auto-dropzone-dark body h3,
html.aft-auto-dropzone-dark body h4,
html.aft-auto-dropzone-dark body p,
html.aft-auto-dropzone-dark body label,
html.aft-auto-dropzone-dark body li,
html.aft-auto-dropzone-dark body table,
html.aft-auto-dropzone-dark body td,
html.aft-auto-dropzone-dark body th {
  color: #e2eee7 !important;
}
html.aft-auto-dropzone-dark body table,
html.aft-auto-dropzone-dark body td,
html.aft-auto-dropzone-dark body th {
  background: #0f1812 !important;
  border-color: #263b2f !important;
}
html.aft-auto-dropzone-dark #wrapper,
html.aft-auto-dropzone-dark .steps-container,
html.aft-auto-dropzone-dark .step-container,
html.aft-auto-dropzone-dark .scan,
html.aft-auto-dropzone-dark .scanned,
html.aft-auto-dropzone-dark .success-step {
  background: #0f1812 !important;
  color: #e2eee7 !important;
}
html.aft-auto-dropzone-dark #header {
  background: #111b15 !important;
  color: #eaf4ee !important;
  border-color: #263b2f !important;
}
html.aft-auto-dropzone-dark .center-inner h3,
html.aft-auto-dropzone-dark .secondary-instruction,
html.aft-auto-dropzone-dark .handling-scan,
html.aft-auto-dropzone-dark .scanned-label,
html.aft-auto-dropzone-dark .scanned-value,
html.aft-auto-dropzone-dark .success-step-label,
html.aft-auto-dropzone-dark .success-step-value {
  color: #dfece5 !important;
}
html.aft-auto-dropzone-dark .step-container {
  border-color: #263b2f !important;
}
html.aft-auto-dropzone-dark .modal-container,
html.aft-auto-dropzone-dark .exception-container,
html.aft-auto-dropzone-dark #main-menu-container,
html.aft-auto-dropzone-dark #diversion-with-back-container {
  background: #121d17 !important;
  color: #e5f0ea !important;
  border-color: #2d4437 !important;
  box-shadow: 0 16px 38px rgba(0,0,0,0.55) !important;
}
html.aft-auto-dropzone-dark .menu-bg {
  background: rgba(3,7,5,0.72) !important;
}
html.aft-auto-dropzone-dark .title-tab,
html.aft-auto-dropzone-dark .menu-options li,
html.aft-auto-dropzone-dark .menu-item-title,
html.aft-auto-dropzone-dark .modal-header,
html.aft-auto-dropzone-dark .modal-instruction,
html.aft-auto-dropzone-dark .modal-message,
html.aft-auto-dropzone-dark .diversion-modal-action {
  color: #e5f0ea !important;
}
html.aft-auto-dropzone-dark .menu-options li {
  background: #17241d !important;
  border-color: #2d4437 !important;
}
html.aft-auto-dropzone-dark .hot-key {
  color: #f3d37a !important;
}
html.aft-auto-dropzone-dark .warning-msg,
html.aft-auto-dropzone-dark .non-recoverable {
  color: #ffb2a5 !important;
}
html.aft-auto-dropzone-dark .continue-btn {
  background: #1b3325 !important;
  color: #d6f4de !important;
  border-color: #3e684b !important;
}
html.aft-auto-dropzone-dark input,
html.aft-auto-dropzone-dark select,
html.aft-auto-dropzone-dark textarea {
  background: #101a14 !important;
  color: #e5f0ea !important;
  border-color: #314a3c !important;
}
html.aft-auto-dropzone-dark img.arrow {
  filter: brightness(0.82) saturate(0.9) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel {
  background: rgba(17,27,21,0.98) !important;
  color: #e5f0ea !important;
  border-color: #2d4437 !important;
  box-shadow: 0 18px 42px rgba(0,0,0,0.54) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button {
  background: #17251d !important;
  color: #dceee3 !important;
  border-color: #35523f !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button:hover {
  background: #203529 !important;
  border-color: #4d775b !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button[data-aft-custom-bg="transparent"] {
  background: transparent !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel input,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel select {
  background: #101a14 !important;
  color: #e5f0ea !important;
  border-color: #314a3c !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel ::placeholder {
  color: #94a79b !important;
}
html.aft-auto-dropzone-dark #aft-scan-quick-buttons {
  border-color: #2d4437 !important;
  scrollbar-color: #456b52 transparent;
}
html.aft-auto-dropzone-dark #aft-scan-quick-buttons::-webkit-scrollbar-thumb {
  background: #456b52 !important;
}
html.aft-auto-dropzone-dark .aft-scan-group-wrap {
  background: #132019 !important;
  border-color: #2d4437 !important;
  box-shadow: 0 4px 14px rgba(0,0,0,0.22) !important;
}
html.aft-auto-dropzone-dark .aft-scan-button-row {
  background: #17251d !important;
  border-color: #334c3d !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.22) !important;
}
html.aft-auto-dropzone-dark .aft-scan-ungrouped-grid {
  background: transparent !important;
}
html.aft-auto-dropzone-dark .aft-scan-empty-group {
  background: #101a14 !important;
  color: #98ad9f !important;
  border-color: #35523f !important;
}
html.aft-auto-dropzone-dark .aft-scan-button-row button[data-aft-custom-bg="transparent"] {
  color: #8ee7a5 !important;
}
html.aft-auto-dropzone-dark #aft-scan-add-controls {
  background: #121f18 !important;
  border-color: #2d4437 !important;
}
html.aft-auto-dropzone-dark #aft-scan-new-dropzone-wrap button,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button[data-aft-custom-bg="#1f683a"] {
  background: linear-gradient(180deg, #31915a 0%, #226d41 100%) !important;
  color: #ffffff !important;
  border-color: #38a766 !important;
  box-shadow: 0 8px 18px rgba(0,0,0,0.28) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button[title^="Delete"],
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button[title="Anuluj"] {
  color: #ffaaaa !important;
}
html.aft-auto-dropzone-dark #aft-scan-dark-mode-toggle {
  color: #f3d37a !important;
}
html.aft-auto-dropzone-dark .aft-scan-group-name {
  color: #e8f4ed !important;
}
html.aft-auto-dropzone-dark,
html.aft-auto-dropzone-dark body {
  background: #111111 !important;
  color: #f5efec !important;
  color-scheme: dark;
}
html.aft-auto-dropzone-dark body div,
html.aft-auto-dropzone-dark body span,
html.aft-auto-dropzone-dark body h1,
html.aft-auto-dropzone-dark body h2,
html.aft-auto-dropzone-dark body h3,
html.aft-auto-dropzone-dark body h4,
html.aft-auto-dropzone-dark body p,
html.aft-auto-dropzone-dark body label,
html.aft-auto-dropzone-dark body li,
html.aft-auto-dropzone-dark body table,
html.aft-auto-dropzone-dark body td,
html.aft-auto-dropzone-dark body th {
  color: #f5efec !important;
}
html.aft-auto-dropzone-dark body table,
html.aft-auto-dropzone-dark body td,
html.aft-auto-dropzone-dark body th {
  background: #1A1919 !important;
  border-color: #47403D !important;
}
html.aft-auto-dropzone-dark #wrapper,
html.aft-auto-dropzone-dark .steps-container,
html.aft-auto-dropzone-dark .step-container,
html.aft-auto-dropzone-dark .scan,
html.aft-auto-dropzone-dark .scanned,
html.aft-auto-dropzone-dark .success-step {
  background: #1A1919 !important;
  color: #f5efec !important;
  border-color: #47403D !important;
  border-radius: 16px !important;
  box-shadow: 0 18px 42px rgba(0,0,0,0.42) !important;
}
html.aft-auto-dropzone-dark .step-container,
html.aft-auto-dropzone-dark .center-inner,
html.aft-auto-dropzone-dark .success-step {
  background: #2B2726 !important;
}
html.aft-auto-dropzone-dark #header {
  background: #111111 !important;
  color: #f5efec !important;
  border-color: #47403D !important;
}
html.aft-auto-dropzone-dark .center-inner h3,
html.aft-auto-dropzone-dark .secondary-instruction,
html.aft-auto-dropzone-dark .handling-scan,
html.aft-auto-dropzone-dark .scanned-label,
html.aft-auto-dropzone-dark .scanned-value,
html.aft-auto-dropzone-dark .success-step-label,
html.aft-auto-dropzone-dark .success-step-value,
html.aft-auto-dropzone-dark .title-tab,
html.aft-auto-dropzone-dark .menu-item-title,
html.aft-auto-dropzone-dark .modal-header,
html.aft-auto-dropzone-dark .modal-instruction,
html.aft-auto-dropzone-dark .modal-message,
html.aft-auto-dropzone-dark .diversion-modal-action {
  color: #f5efec !important;
}
html.aft-auto-dropzone-dark .modal-container,
html.aft-auto-dropzone-dark .exception-container,
html.aft-auto-dropzone-dark #main-menu-container,
html.aft-auto-dropzone-dark #diversion-with-back-container {
  background: #2B2726 !important;
  color: #f5efec !important;
  border-color: #77615A !important;
  border-radius: 16px !important;
  box-shadow: 0 18px 42px rgba(0,0,0,0.58) !important;
}
html.aft-auto-dropzone-dark .menu-bg {
  background: rgba(17,17,17,0.76) !important;
}
html.aft-auto-dropzone-dark .menu-options li {
  background: #47403D !important;
  border-color: #77615A !important;
  color: #f5efec !important;
}
html.aft-auto-dropzone-dark .hot-key,
html.aft-auto-dropzone-dark .continue-btn,
html.aft-auto-dropzone-dark .warning-msg,
html.aft-auto-dropzone-dark .non-recoverable {
  color: #E07B5B !important;
}
html.aft-auto-dropzone-dark .continue-btn {
  background: linear-gradient(180deg, #E07B5B 0%, #B95F46 100%) !important;
  color: #ffffff !important;
  border-color: #E07B5B !important;
}
html.aft-auto-dropzone-dark input,
html.aft-auto-dropzone-dark select,
html.aft-auto-dropzone-dark textarea {
  background: #1A1919 !important;
  color: #f5efec !important;
  border-color: #77615A !important;
}
html.aft-auto-dropzone-dark img.arrow {
  filter: sepia(0.35) saturate(1.2) hue-rotate(320deg) brightness(0.82) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel {
  background: rgba(26,25,25,0.98) !important;
  color: #f5efec !important;
  border-color: #47403D !important;
  box-shadow: 0 18px 42px rgba(0,0,0,0.60) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button {
  background: #2B2726 !important;
  color: #f5efec !important;
  border-color: #47403D !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button:hover {
  background: #47403D !important;
  border-color: #77615A !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel input,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel select {
  background: #111111 !important;
  color: #f5efec !important;
  border-color: #77615A !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel ::placeholder {
  color: #bfaea8 !important;
}
html.aft-auto-dropzone-dark #aft-scan-quick-buttons {
  border-color: #47403D !important;
  scrollbar-color: #77615A transparent;
}
html.aft-auto-dropzone-dark #aft-scan-quick-buttons::-webkit-scrollbar-thumb {
  background: #77615A !important;
}
html.aft-auto-dropzone-dark .aft-scan-group-wrap {
  background: #2B2726 !important;
  border-color: #47403D !important;
  box-shadow: 0 10px 24px rgba(0,0,0,0.34) !important;
}
html.aft-auto-dropzone-dark .aft-scan-group-name {
  color: #f5efec !important;
}
html.aft-auto-dropzone-dark .aft-scan-button-row {
  background: #47403D !important;
  border-color: #77615A !important;
  box-shadow: 0 3px 10px rgba(0,0,0,0.28) !important;
}
html.aft-auto-dropzone-dark .aft-scan-button-row button[data-aft-custom-bg="transparent"] {
  color: #E07B5B !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-dropzone-action-button {
  background: #47403D !important;
  border-color: #77615A !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.28) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-group-color-button {
  background: var(--aft-group-swatch, #E07B5B) !important;
  border-color: var(--aft-group-swatch, #E07B5B) !important;
  color: #ffffff !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-group-color-button:hover {
  background: var(--aft-group-swatch, #E07B5B) !important;
  border-color: var(--aft-group-swatch, #E07B5B) !important;
}
html.aft-auto-dropzone-dark .aft-scan-empty-group,
html.aft-auto-dropzone-dark #aft-scan-add-controls {
  background: #1A1919 !important;
  color: #cdbcb5 !important;
  border-color: #77615A !important;
}
html.aft-auto-dropzone-dark #aft-scan-reset-session {
  color: #ffffff !important;
  background: #77615A !important;
  border-color: #77615A !important;
}
html.aft-auto-dropzone-dark,
html.aft-auto-dropzone-dark body {
  background: #05070A !important;
  color: #EFF4F8 !important;
  color-scheme: dark;
}
html.aft-auto-dropzone-dark body div,
html.aft-auto-dropzone-dark body span,
html.aft-auto-dropzone-dark body h1,
html.aft-auto-dropzone-dark body h2,
html.aft-auto-dropzone-dark body h3,
html.aft-auto-dropzone-dark body h4,
html.aft-auto-dropzone-dark body p,
html.aft-auto-dropzone-dark body label,
html.aft-auto-dropzone-dark body li,
html.aft-auto-dropzone-dark body table,
html.aft-auto-dropzone-dark body td,
html.aft-auto-dropzone-dark body th,
html.aft-auto-dropzone-dark .center-inner h3,
html.aft-auto-dropzone-dark .secondary-instruction,
html.aft-auto-dropzone-dark .handling-scan,
html.aft-auto-dropzone-dark .scanned-label,
html.aft-auto-dropzone-dark .scanned-value,
html.aft-auto-dropzone-dark .success-step-label,
html.aft-auto-dropzone-dark .success-step-value,
html.aft-auto-dropzone-dark .title-tab,
html.aft-auto-dropzone-dark .menu-item-title,
html.aft-auto-dropzone-dark .modal-header,
html.aft-auto-dropzone-dark .modal-instruction,
html.aft-auto-dropzone-dark .modal-message,
html.aft-auto-dropzone-dark .diversion-modal-action,
html.aft-auto-dropzone-dark .aft-scan-group-name {
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark body table,
html.aft-auto-dropzone-dark body td,
html.aft-auto-dropzone-dark body th {
  background: #0B0F14 !important;
  border-color: #2A3440 !important;
}
html.aft-auto-dropzone-dark #wrapper,
html.aft-auto-dropzone-dark .steps-container,
html.aft-auto-dropzone-dark .step-container,
html.aft-auto-dropzone-dark .scan,
html.aft-auto-dropzone-dark .scanned,
html.aft-auto-dropzone-dark .success-step {
  background: #0B0F14 !important;
  color: #EFF4F8 !important;
  border-color: #2A3440 !important;
  box-shadow: 0 18px 42px rgba(0,0,0,0.52) !important;
}
html.aft-auto-dropzone-dark .step-container,
html.aft-auto-dropzone-dark .center-inner,
html.aft-auto-dropzone-dark .success-step {
  background: #11161D !important;
}
html.aft-auto-dropzone-dark #scan-source-container,
html.aft-auto-dropzone-dark #scan-destination-container,
html.aft-auto-dropzone-dark #scan-container,
html.aft-auto-dropzone-dark #scan-source-container .scan,
html.aft-auto-dropzone-dark #scan-destination-container .scan,
html.aft-auto-dropzone-dark #scan-container .scan,
html.aft-auto-dropzone-dark #scan-source-container .scanned,
html.aft-auto-dropzone-dark #scan-destination-container .scanned,
html.aft-auto-dropzone-dark #scan-container .scanned,
html.aft-auto-dropzone-dark #scan-source-container .success-step,
html.aft-auto-dropzone-dark #scan-destination-container .success-step,
html.aft-auto-dropzone-dark #scan-container .success-step,
html.aft-auto-dropzone-dark #scan-source-container .center-outer,
html.aft-auto-dropzone-dark #scan-destination-container .center-outer,
html.aft-auto-dropzone-dark #scan-container .center-outer,
html.aft-auto-dropzone-dark #scan-source-container .center-inner,
html.aft-auto-dropzone-dark #scan-destination-container .center-inner,
html.aft-auto-dropzone-dark #scan-container .center-inner {
  background: #11161D !important;
}
html.aft-auto-dropzone-dark #header {
  background: #05070A !important;
  color: #EFF4F8 !important;
  border-color: #2A3440 !important;
}
html.aft-auto-dropzone-dark .modal-container,
html.aft-auto-dropzone-dark .exception-container,
html.aft-auto-dropzone-dark #main-menu-container,
html.aft-auto-dropzone-dark #diversion-with-back-container {
  background: #11161D !important;
  color: #EFF4F8 !important;
  border-color: #364351 !important;
  box-shadow: 0 18px 42px rgba(0,0,0,0.64) !important;
}
html.aft-auto-dropzone-dark .menu-bg {
  background: rgba(5,7,10,0.82) !important;
}
html.aft-auto-dropzone-dark .title-tab,
html.aft-auto-dropzone-dark #main-menu-container .title-tab,
html.aft-auto-dropzone-dark .modal-container .title-tab {
  background: #11161D !important;
  color: #EFF4F8 !important;
  border-color: #364351 !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark .title-tab .hot-key {
  color: #E07B5B !important;
}
html.aft-auto-dropzone-dark .menu-options li {
  background: #18202A !important;
  border-color: #364351 !important;
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark input,
html.aft-auto-dropzone-dark select,
html.aft-auto-dropzone-dark textarea,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel input,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel select {
  background: #080B10 !important;
  color: #EFF4F8 !important;
  border-color: #364351 !important;
}
html.aft-auto-dropzone-dark img.arrow {
  filter: brightness(0.82) saturate(0.86) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel {
  background: rgba(11,15,20,0.98) !important;
  color: #EFF4F8 !important;
  border-color: #2A3440 !important;
  box-shadow: 0 18px 42px rgba(0,0,0,0.66) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button {
  background: #11161D !important;
  color: #EFF4F8 !important;
  border-color: #2A3440 !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button:hover {
  background: #18202A !important;
  border-color: #465564 !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel ::placeholder {
  color: #8B98A5 !important;
}
html.aft-auto-dropzone-dark #aft-scan-quick-buttons {
  border-color: #2A3440 !important;
  scrollbar-color: #465564 transparent;
}
html.aft-auto-dropzone-dark #aft-scan-quick-buttons::-webkit-scrollbar-thumb {
  background: #465564 !important;
}
html.aft-auto-dropzone-dark .aft-scan-group-wrap {
  background: #11161D !important;
  border-color: #2A3440 !important;
  box-shadow: 0 10px 24px rgba(0,0,0,0.42) !important;
}
html.aft-auto-dropzone-dark .aft-scan-button-row {
  background: #18202A !important;
  border-color: #364351 !important;
  box-shadow: 0 3px 10px rgba(0,0,0,0.34) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-dropzone-action-button {
  background: #18202A !important;
  border-color: #364351 !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.34) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-group-color-button {
  background: var(--aft-group-swatch, #E07B5B) !important;
  border-color: #364351 !important;
  color: #ffffff !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.34), inset 0 0 0 2px rgba(255,255,255,0.18) !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel .aft-scan-group-color-button:hover {
  background: var(--aft-group-swatch, #E07B5B) !important;
  border-color: #465564 !important;
}
html.aft-auto-dropzone-dark .aft-scan-empty-group,
html.aft-auto-dropzone-dark #aft-scan-add-controls {
  background: #0B0F14 !important;
  color: #AEB8C2 !important;
  border-color: #364351 !important;
}
html.aft-auto-dropzone-dark #aft-scan-reset-session {
  color: #E07B5B !important;
  background: #11161D !important;
  border-color: #364351 !important;
}
html.aft-auto-dropzone-dark #aft-scan-new-dropzone-wrap button,
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button[data-aft-custom-bg="#1f683a"] {
  background: linear-gradient(180deg, #E07B5B 0%, #B95F46 100%) !important;
  color: #ffffff !important;
  border-color: #E07B5B !important;
  box-shadow: 0 10px 22px rgba(224,123,91,0.24) !important;
}
html.aft-auto-dropzone-dark #aft-scan-dark-mode-toggle {
  color: #E07B5B !important;
}
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button[title^="Delete"],
html.aft-auto-dropzone-dark #aft-scan-buttons-panel button[title="Anuluj"] {
  color: #FFB29A !important;
}`;
        document.head.appendChild(style);
        cachedElements[style.id] = style;
    }

    function installCompactAftLayoutStyle() {
        if (getCachedElement('aft-compact-move-layout-style')) {
            return;
        }

        var style = document.createElement('style');
        style.id = 'aft-compact-move-layout-style';
        style.textContent = `html.aft-compact-move-layout #wrapper {
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout,
html.aft-compact-move-layout body {
  overflow: hidden !important;
}
html.aft-compact-move-layout ::selection {
  background: #E07B5B !important;
  color: #FFFFFF !important;
}
html.aft-compact-move-layout ::-moz-selection {
  background: #E07B5B !important;
  color: #FFFFFF !important;
}
html.aft-compact-move-layout #aft-scan-buttons-panel {
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: #FFFFFF !important;
  backdrop-filter: none !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel {
  background: #0B0F14 !important;
}
html.aft-compact-move-layout #aft-window-focus-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  cursor: pointer;
  background: linear-gradient(135deg, rgba(38,34,31,0.48), rgba(18,17,16,0.62));
  backdrop-filter: none;
}
html.aft-compact-move-layout.aft-window-inactive:not(.aft-window-focus-indicator-disabled) #aft-window-focus-overlay {
  display: flex;
}
html.aft-compact-move-layout.aft-window-focus-indicator-disabled #aft-window-focus-overlay {
  display: none !important;
}
html.aft-compact-move-layout.aft-window-inactive .aft-scan-waiting-pulse,
html.aft-compact-move-layout.aft-window-inactive .aft-scan-waiting::before,
html.aft-compact-move-layout.aft-window-inactive .aft-scan-waiting .center-inner h3,
html.aft-compact-move-layout.aft-window-inactive .aft-scan-waiting .scanned-value,
html.aft-compact-move-layout.aft-window-inactive .aft-scan-waiting .success-step-label,
html.aft-compact-move-layout.aft-window-inactive .aft-scan-waiting .success-step-value {
  animation-play-state: paused !important;
}
html.aft-compact-move-layout #aft-window-focus-overlay .aft-window-focus-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: min(420px, calc(100vw - 48px));
  padding: 22px 28px;
  border: 1px solid rgba(224,123,91,0.78);
  border-radius: 16px;
  background: rgba(248,245,240,0.94);
  color: #292C30;
  box-shadow: 0 18px 48px rgba(25,22,20,0.26);
  text-align: center;
}
html.aft-compact-move-layout #aft-window-focus-overlay .aft-window-focus-message strong {
  font: 800 clamp(20px, 4vw, 30px)/1.05 Arial, sans-serif;
  letter-spacing: 0.04em;
}
html.aft-compact-move-layout #aft-window-focus-overlay .aft-window-focus-message span {
  color: #665E58;
  font: 600 14px/1.25 Arial, sans-serif;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-window-focus-overlay {
  background: rgba(3,6,9,0.58);
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-window-focus-overlay .aft-window-focus-message {
  background: rgba(17,22,29,0.96);
  color: #EFF4F8;
  border-color: rgba(224,123,91,0.82);
  box-shadow: 0 20px 54px rgba(0,0,0,0.46);
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-window-focus-overlay .aft-window-focus-message span {
  color: #B8C2CC;
}
html.aft-compact-move-layout #header {
  display: none !important;
}
html.aft-compact-move-layout #username {
  display: none !important;
}
html.aft-compact-move-layout .steps-container {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  gap: 10px;
  width: 100%;
  padding: 8px 12px 0;
  box-sizing: border-box;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout #aft-scan-buttons-panel .aft-unified-scan-statuses {
  flex: 0 0 auto;
  width: auto;
  margin: 0;
  padding: 0 6px 14px;
}
html.aft-compact-move-layout #scan-source-container {
  display: none !important;
}
html.aft-compact-move-layout #aft-compact-source-badge,
html.aft-compact-move-layout #scan-destination-container,
html.aft-compact-move-layout #scan-container,
html.aft-compact-move-layout #aft-latest-age-box,
html.aft-compact-move-layout #aft-latest-quantity-box {
  position: relative !important;
  height: 74px !important;
  min-height: 74px !important;
  max-height: 74px !important;
  margin: 0 !important;
  overflow: hidden !important;
  border: 1px solid #D8E4D8 !important;
  border-radius: 16px !important;
  background: #FFFFFF !important;
  box-shadow: 0 4px 14px rgba(20,45,25,0.08) !important;
  line-height: 74px !important;
  box-sizing: border-box !important;
}
html.aft-compact-move-layout #scan-destination-container {
  order: 2;
}
html.aft-compact-move-layout #scan-container {
  order: 3;
}
html.aft-compact-move-layout #aft-latest-age-box {
  order: 4;
  grid-column: 1 / 3;
}
html.aft-compact-move-layout #aft-latest-quantity-box {
  order: 5;
  grid-column: 3 / 4;
}
html.aft-compact-move-layout #aft-latest-age-box,
html.aft-compact-move-layout #aft-latest-quantity-box {
  height: 108px !important;
  min-height: 108px !important;
  max-height: 108px !important;
  line-height: 108px !important;
  display: flex !important;
  align-items: center;
  justify-content: center;
  padding: 14px 22px 0;
}
html.aft-compact-move-layout #scan-destination-container::before,
html.aft-compact-move-layout #scan-container::before,
html.aft-compact-move-layout #aft-latest-age-box::before,
html.aft-compact-move-layout #aft-latest-quantity-box::before {
  position: absolute;
  top: 8px;
  left: 14px;
  z-index: 30;
  color: #718078;
  font: 700 11px/1 Arial, sans-serif;
  letter-spacing: 0.04em;
  pointer-events: none;
}
html.aft-compact-move-layout #scan-destination-container::before {
  content: "DROP-ZONE";
}
html.aft-compact-move-layout #scan-container::before {
  content: "KONTENER";
}
html.aft-compact-move-layout #aft-latest-age-box::before {
  content: "WIEK";
}
html.aft-compact-move-layout #aft-latest-quantity-box::before {
  content: "ILO\\015A\\0106";
}
html.aft-compact-move-layout #scan-destination-container::after,
html.aft-compact-move-layout #scan-container::after,
html.aft-compact-move-layout #aft-latest-age-box::after,
html.aft-compact-move-layout #aft-latest-quantity-box::after,
html.aft-compact-move-layout #aft-compact-source-badge::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 31;
  height: 3px;
  background: #E07B5B;
  pointer-events: none;
}
html.aft-compact-move-layout .aft-scan-waiting-pulse {
  position: absolute;
  inset: 0;
  z-index: 32;
  border: 2px solid transparent;
  border-radius: inherit;
  box-sizing: border-box;
  opacity: 0;
  pointer-events: none;
}
html.aft-compact-move-layout .aft-scan-waiting .aft-scan-waiting-pulse {
  border-color: rgba(224,123,91,0.92);
  box-shadow: inset 0 0 0 1px rgba(224,123,91,0.42), inset 0 0 18px rgba(224,123,91,0.16);
  will-change: opacity;
  animation: aft-scan-waiting-breathe 1900ms ease-in-out infinite;
}
html.aft-compact-move-layout .aft-scan-success .aft-scan-waiting-pulse {
  border-color: rgba(57,196,106,1);
  box-shadow: inset 0 0 0 2px rgba(57,196,106,0.58), inset 0 0 24px rgba(57,196,106,0.26);
  animation: aft-scan-success-breathe 1900ms ease-in-out 1 forwards;
}
html.aft-compact-move-layout .aft-scan-error .aft-scan-waiting-pulse {
  border-color: rgba(216,84,84,1);
  box-shadow: inset 0 0 0 2px rgba(216,84,84,0.58), inset 0 0 24px rgba(216,84,84,0.24);
  animation: aft-scan-error-breathe 1900ms ease-in-out 1 forwards;
}
html.aft-compact-move-layout #scan-destination-container .center-inner h3,
html.aft-compact-move-layout #scan-container .center-inner h3,
html.aft-compact-move-layout #scan-destination-container .scanned-value,
html.aft-compact-move-layout #scan-container .scanned-value,
html.aft-compact-move-layout #scan-destination-container .success-step-label,
html.aft-compact-move-layout #scan-container .success-step-label,
html.aft-compact-move-layout #scan-destination-container .success-step-value,
html.aft-compact-move-layout #scan-container .success-step-value {
  transition: color 500ms ease-in-out;
}
html.aft-compact-move-layout #scan-destination-container .scanned-value,
html.aft-compact-move-layout #scan-destination-container .success-step-label,
html.aft-compact-move-layout #scan-destination-container .success-step-value,
html.aft-compact-move-layout #scan-container .scanned-value,
html.aft-compact-move-layout #scan-container .success-step-label,
html.aft-compact-move-layout #scan-container .success-step-value,
html.aft-compact-move-layout #aft-latest-container-age .aft-latest-container-id,
html.aft-compact-move-layout #aft-compact-source-value {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
}
html.aft-compact-move-layout .aft-scan-text-show-end {
  overflow: hidden !important;
  direction: rtl;
  text-align: left !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
html.aft-compact-move-layout .aft-scan-waiting::before,
html.aft-compact-move-layout .aft-scan-waiting .center-inner h3,
html.aft-compact-move-layout .aft-scan-waiting .scanned-value,
html.aft-compact-move-layout .aft-scan-waiting .success-step-label,
html.aft-compact-move-layout .aft-scan-waiting .success-step-value {
  color: #E07B5B !important;
  will-change: opacity;
  animation: aft-scan-waiting-text-breathe 1900ms ease-in-out infinite;
}
html.aft-compact-move-layout .aft-scan-error::before,
html.aft-compact-move-layout .aft-scan-error .center-inner h3,
html.aft-compact-move-layout .aft-scan-error .scanned-value,
html.aft-compact-move-layout .aft-scan-error .success-step-label,
html.aft-compact-move-layout .aft-scan-error .success-step-value {
  color: #D85454 !important;
  animation: aft-scan-error-text-breathe 1900ms ease-in-out 1 forwards;
}
html.aft-compact-move-layout .aft-scan-error.aft-scan-error-returning::before,
html.aft-compact-move-layout .aft-scan-error.aft-scan-error-returning .center-inner h3,
html.aft-compact-move-layout .aft-scan-error.aft-scan-error-returning .scanned-value,
html.aft-compact-move-layout .aft-scan-error.aft-scan-error-returning .success-step-label,
html.aft-compact-move-layout .aft-scan-error.aft-scan-error-returning .success-step-value {
  color: #E07B5B !important;
}
@keyframes aft-scan-waiting-breathe {
  0%, 100% {
    opacity: 0.38;
  }
  50% {
    opacity: 1;
  }
}
@keyframes aft-scan-success-breathe {
  0% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes aft-scan-error-breathe {
  0% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.72;
  }
}
@keyframes aft-scan-waiting-text-breathe {
  0%, 100% {
    opacity: 0.62;
  }
  50% {
    opacity: 1;
  }
}
@keyframes aft-scan-error-text-breathe {
  0% {
    opacity: 0.48;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.62;
  }
}
html.aft-compact-move-layout #scan-destination-container.aft-direct-scan-ready,
html.aft-compact-move-layout #scan-container.aft-direct-scan-ready {
  cursor: pointer !important;
}
html.aft-compact-move-layout .aft-direct-scan-input {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 27px;
  z-index: 40;
  width: calc(100% - 24px);
  height: 34px;
  box-sizing: border-box;
  margin: 0;
  padding: 0 12px;
  border: 1px solid #E07B5B;
  border-radius: 9px;
  outline: none;
  background: #FFFFFF;
  color: #253528;
  box-shadow: 0 0 0 2px rgba(224,123,91,0.18);
  font: 700 15px/32px Arial, sans-serif;
  text-align: center;
}
html.aft-compact-move-layout .aft-direct-scan-input::placeholder {
  color: #8B756E;
  opacity: 0.82;
}
html.aft-compact-move-layout .aft-direct-scan-input.aft-direct-scan-input-error {
  border-color: #D85454;
  box-shadow: 0 0 0 3px rgba(216,84,84,0.20);
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-direct-scan-input {
  background: #0B0F14 !important;
  color: #EFF4F8 !important;
  border-color: #E07B5B !important;
  box-shadow: 0 0 0 2px rgba(224,123,91,0.24) !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-direct-scan-input::placeholder {
  color: #9EABB8;
}
html.aft-compact-move-layout #scan-destination-container .scan,
html.aft-compact-move-layout #scan-destination-container .scanned,
html.aft-compact-move-layout #scan-container .scan,
html.aft-compact-move-layout #scan-container .scanned,
html.aft-compact-move-layout #scan-container .success-step {
  height: 100% !important;
  line-height: inherit !important;
  box-sizing: border-box;
}
html.aft-compact-move-layout #scan-destination-container .center-inner h3,
html.aft-compact-move-layout #scan-container .center-inner h3 {
  margin: 0;
  width: 100%;
  max-width: 100%;
  font-size: clamp(7px, 2.5vw, 16px) !important;
  line-height: 1.05 !important;
  overflow-wrap: normal;
  text-align: center;
  text-wrap: balance;
}
html.aft-compact-move-layout #scan-destination-container .scan,
html.aft-compact-move-layout #scan-container .scan {
  position: static !important;
}
html.aft-compact-move-layout #scan-destination-container .scan .center-outer,
html.aft-compact-move-layout #scan-container .scan .center-outer {
  position: absolute !important;
  inset: 23px 6px 5px !important;
  width: auto !important;
  height: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  line-height: normal !important;
}
html.aft-compact-move-layout #scan-destination-container .scan .center-inner,
html.aft-compact-move-layout #scan-container .scan .center-inner {
  position: static !important;
  top: auto !important;
  left: auto !important;
  width: 100% !important;
  height: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  line-height: normal !important;
  box-sizing: border-box;
}
html.aft-compact-move-layout #scan-destination-container .scanned-label,
html.aft-compact-move-layout #scan-container .scanned-label {
  display: none !important;
}
html.aft-compact-move-layout #scan-destination-container .scanned-value,
html.aft-compact-move-layout #scan-container .scanned-value {
  margin: 0 !important;
  font-size: 20px !important;
  font-weight: 700 !important;
}
html.aft-compact-move-layout #scan-destination-container .secondary-instruction,
html.aft-compact-move-layout #scan-container .secondary-instruction,
html.aft-compact-move-layout #scan-destination-container .handling-scan,
html.aft-compact-move-layout #scan-container .handling-scan,
html.aft-compact-move-layout #scan-destination-container .arrow,
html.aft-compact-move-layout #scan-container .arrow {
  display: none !important;
}
html.aft-compact-move-layout #aft-latest-container-age {
  padding: 14px 22px 0 !important;
  border: 0 !important;
  border-radius: inherit !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout #aft-latest-age-box .aft-latest-container-age-value,
html.aft-compact-move-layout #aft-latest-quantity-box .aft-latest-container-quantity-value {
  position: relative;
  z-index: 2;
  overflow: hidden;
  text-overflow: clip;
}
#aft-compact-source-badge {
  order: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: none;
  min-width: 0;
  padding: 14px 22px 0;
  color: #253528;
  font: 700 20px/1 Arial, sans-serif;
  pointer-events: none;
}
#aft-compact-source-label {
  position: absolute;
  top: 8px;
  left: 14px;
  color: #718078;
  font: 700 11px/1 Arial, sans-serif;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
#aft-scan-buttons-panel #aft-scan-panel-header-center {
  display: flex;
  align-items: center;
  justify-content: center;
}
#aft-scan-buttons-panel #aft-compact-source-badge {
  max-width: 100%;
}
#aft-compact-source-value {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: #253528;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-compact-source-badge,
html.aft-auto-dropzone-dark.aft-compact-move-layout #scan-destination-container,
html.aft-auto-dropzone-dark.aft-compact-move-layout #scan-container,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-latest-age-box,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-latest-quantity-box {
  background: #11161D !important;
  border-color: #364351 !important;
  box-shadow: 0 7px 18px rgba(0,0,0,0.34) !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #scan-destination-container::before,
html.aft-auto-dropzone-dark.aft-compact-move-layout #scan-container::before,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-latest-age-box::before,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-latest-quantity-box::before {
  color: #C9D2D8 !important;
}
html.aft-auto-dropzone-dark #aft-compact-source-badge {
  color: #9EABB8 !important;
}
html.aft-auto-dropzone-dark #aft-compact-source-label {
  color: #9EABB8 !important;
}
html.aft-auto-dropzone-dark #aft-compact-source-value {
  background: #11161D !important;
  color: #EFF4F8 !important;
  border-color: #364351 !important;
}
@media (prefers-reduced-motion: reduce) {
  html.aft-compact-move-layout .aft-scan-waiting .aft-scan-waiting-pulse {
    animation: none;
    border-color: rgba(224,123,91,0.72);
    box-shadow: inset 0 0 12px rgba(224,123,91,0.10);
    opacity: 1;
  }
  html.aft-compact-move-layout .aft-scan-success .aft-scan-waiting-pulse {
    animation: none;
    border-color: rgba(57,196,106,0.92);
    box-shadow: inset 0 0 16px rgba(57,196,106,0.18);
    opacity: 1;
  }
  html.aft-compact-move-layout .aft-scan-error .aft-scan-waiting-pulse {
    animation: none;
    border-color: rgba(216,84,84,0.92);
    box-shadow: inset 0 0 16px rgba(216,84,84,0.18);
    opacity: 1;
  }
  html.aft-compact-move-layout .aft-scan-waiting::before,
  html.aft-compact-move-layout .aft-scan-waiting .center-inner h3,
  html.aft-compact-move-layout .aft-scan-waiting .scanned-value,
  html.aft-compact-move-layout .aft-scan-waiting .success-step-label,
  html.aft-compact-move-layout .aft-scan-waiting .success-step-value,
  html.aft-compact-move-layout .aft-scan-error::before,
  html.aft-compact-move-layout .aft-scan-error .center-inner h3,
  html.aft-compact-move-layout .aft-scan-error .scanned-value,
  html.aft-compact-move-layout .aft-scan-error .success-step-label,
  html.aft-compact-move-layout .aft-scan-error .success-step-value {
    animation: none;
    opacity: 1;
    text-shadow: none;
  }
}
@media (max-width: 720px) {
  html.aft-compact-move-layout .steps-container {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  html.aft-compact-move-layout #scan-destination-container,
  html.aft-compact-move-layout #scan-container,
  html.aft-compact-move-layout #aft-compact-source-badge {
    height: 66px !important;
    min-height: 66px !important;
    max-height: 66px !important;
    line-height: 66px !important;
  }
  html.aft-compact-move-layout #aft-latest-age-box,
  html.aft-compact-move-layout #aft-latest-quantity-box {
    height: 92px !important;
    min-height: 92px !important;
    max-height: 92px !important;
    line-height: 92px !important;
  }
  html.aft-compact-move-layout .aft-direct-scan-input {
    top: 25px;
    height: 32px;
    font-size: 14px;
    line-height: 30px;
  }
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  width: auto !important;
  height: auto !important;
  pointer-events: none !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-bg {
  display: block !important;
  position: absolute !important;
  inset: 0 !important;
  width: auto !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu #main-menu-container {
  position: absolute !important;
  top: 52px !important;
  right: 42px !important;
  left: auto !important;
  width: min(300px, calc(100% - 24px)) !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  border: 1px solid #D8E4D8 !important;
  border-radius: 14px !important;
  background: #FFFFFF !important;
  color: #253528 !important;
  box-shadow: 0 18px 48px rgba(20,40,24,0.22) !important;
  pointer-events: auto !important;
  animation: aft-compact-menu-enter 180ms cubic-bezier(0.22,0.84,0.29,1);
  transform-origin: top right;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .title-tab {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 10px !important;
  width: auto !important;
  height: auto !important;
  min-height: 54px !important;
  padding: 10px 12px !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-bottom: 1px solid #D8E4D8 !important;
  border-radius: 0 !important;
  background: #F7FAF7 !important;
  color: #253528 !important;
  box-shadow: none !important;
  cursor: pointer !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options .hot-key {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex: 0 0 24px !important;
  width: 24px !important;
  height: 24px !important;
  margin: 0 !important;
  padding: 0 !important;
  box-sizing: border-box !important;
  border: 1px solid #D8E4D8 !important;
  border-radius: 7px !important;
  background: #FFFFFF !important;
  color: #9EABB8 !important;
  font: 700 11px/1 Arial, sans-serif !important;
  text-transform: uppercase !important;
  text-decoration: none !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options {
  display: block !important;
  clear: none !important;
  width: auto !important;
  margin: 0 !important;
  padding: 6px !important;
  box-sizing: border-box !important;
  background: transparent !important;
  list-style: none !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options li {
  float: none !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  height: auto !important;
  min-height: 42px !important;
  margin: 0 !important;
  padding: 6px 8px !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-radius: 9px !important;
  background: transparent !important;
  color: #253528 !important;
  line-height: normal !important;
  cursor: pointer !important;
  transition: background 120ms ease, color 120ms ease !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options li:not([style*="display: none"]) {
  display: flex !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options li[style*="display: none"] {
  display: none !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options li:hover {
  background: #F2F6F2 !important;
}
html.aft-compact-move-layout:not(.aft-scan-drag-active) #aft-scan-buttons-panel .aft-scan-button-row:hover:not(.aft-scan-action-hover) {
  background: #F2F6F2 !important;
}
html.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-dropzone-main-button,
html.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-dropzone-main-button:hover {
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-dropzone-action-button,
html.aft-compact-move-layout:not(.aft-scan-drag-active) #aft-scan-buttons-panel .aft-scan-dropzone-action-button:hover {
  background: transparent !important;
  border-color: #D8E4D8 !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout:not(.aft-scan-drag-active) #aft-scan-buttons-panel .aft-scan-dropzone-action-button:hover {
  background: #F2F6F2 !important;
  border-color: #9FC59F !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-item-title {
  float: none !important;
  flex: 1 1 auto !important;
  width: auto !important;
  min-width: 0 !important;
  padding: 0 !important;
  color: #253528 !important;
  font: 600 13px/1.2 Arial, sans-serif !important;
  text-decoration: none !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-item-title u,
html.aft-compact-move-layout #main-menu.aft-compact-main-menu u {
  text-decoration: none !important;
}
html.aft-compact-move-layout .aft-compact-menu-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex: 0 0 28px !important;
  width: 28px !important;
  height: 28px !important;
  border-radius: 8px !important;
  background: #F2F6F2 !important;
  color: #315C31 !important;
}
html.aft-compact-move-layout .aft-compact-menu-icon svg {
  width: 16px !important;
  height: 16px !important;
}
html.aft-compact-move-layout .aft-compact-menu-icon path {
  fill: none !important;
  stroke: currentColor !important;
  stroke-width: 2 !important;
  stroke-linecap: round !important;
  stroke-linejoin: round !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu #main-menu-container {
  border-color: #364351 !important;
  background: #11161D !important;
  color: #EFF4F8 !important;
  box-shadow: 0 20px 52px rgba(0,0,0,0.68) !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .title-tab {
  border-bottom-color: #2A3440 !important;
  background: #11161D !important;
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-item-title,
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options li {
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options .hot-key {
  border-color: #364351 !important;
  background: #0B0F14 !important;
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .menu-options li:hover {
  background: #18202A !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout:not(.aft-scan-drag-active) #aft-scan-buttons-panel .aft-scan-button-row:hover:not(.aft-scan-action-hover) {
  background: #25303C !important;
  border-color: #465564 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-dropzone-action-button {
  background: transparent !important;
  border-color: #364351 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout:not(.aft-scan-drag-active) #aft-scan-buttons-panel .aft-scan-dropzone-action-button:hover {
  background: #25303C !important;
  border-color: #465564 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-menu-icon {
  background: #18202A !important;
  color: #EFF4F8 !important;
}
@keyframes aft-compact-menu-enter {
  from {
    opacity: 0;
    transform: translateY(-5px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  html.aft-compact-move-layout #main-menu.aft-compact-main-menu #main-menu-container {
    animation: none;
  }
}

html.aft-compact-move-layout #main-menu.aft-compact-main-menu .title-tab {
  display: none !important;
}
html.aft-compact-move-layout .aft-compact-panel-actions {
  display: grid !important;
  gap: 4px !important;
  padding: 6px !important;
  border: 0 !important;
}
html.aft-compact-move-layout .aft-compact-panel-actions button {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  min-width: 0 !important;
  height: auto !important;
  min-height: 42px !important;
  margin: 0 !important;
  padding: 6px 8px !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-radius: 9px !important;
  background: transparent !important;
  color: #253528 !important;
  box-shadow: none !important;
  font: 600 13px/1.2 Arial, sans-serif !important;
  text-align: left !important;
}
html.aft-compact-move-layout .aft-compact-panel-actions button:hover {
  background: #F2F6F2 !important;
}
html.aft-compact-move-layout .aft-compact-menu-action-label {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  color: inherit !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-panel-actions button {
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .aft-compact-panel-actions button,
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .aft-compact-panel-actions button .aft-compact-menu-action-label,
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .aft-compact-panel-actions button .hot-key {
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-panel-actions button:hover {
  background: #18202A !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu #menu-item-w {
  display: flex !important;
}
html.aft-compact-move-layout #main-menu.aft-compact-main-menu .aft-compact-panel-actions #aft-scan-reset-session:hover {
  background: #F2F6F2 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #main-menu.aft-compact-main-menu .aft-compact-panel-actions #aft-scan-reset-session:hover {
  background: #18202A !important;
}
html.aft-compact-move-layout .aft-compact-window-focus-control {
  display: grid !important;
  grid-template-columns: 28px minmax(0, 1fr) !important;
  align-items: center !important;
  gap: 10px !important;
  min-width: 0 !important;
  min-height: 42px !important;
  padding: 7px 8px !important;
  box-sizing: border-box !important;
  border-top: 1px solid #C8D1C9 !important;
  color: #253528 !important;
  font: 600 13px/1.25 Arial, sans-serif !important;
  cursor: pointer !important;
}
html.aft-compact-move-layout .aft-compact-window-focus-label {
  min-width: 0 !important;
}
html.aft-compact-move-layout .aft-compact-window-focus-checkbox {
  position: relative !important;
  justify-self: center !important;
  width: 21px !important;
  height: 21px !important;
  margin: 0 !important;
  border: 1px solid #B7C2B9 !important;
  border-radius: 6px !important;
  appearance: none !important;
  background: #FFFFFF !important;
  box-shadow: 0 1px 3px rgba(37,53,40,0.10) !important;
  cursor: pointer !important;
  transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease !important;
}
html.aft-compact-move-layout .aft-compact-window-focus-checkbox::after {
  content: "" !important;
  position: absolute !important;
  top: 3px !important;
  left: 7px !important;
  width: 5px !important;
  height: 10px !important;
  border: solid #FFFFFF !important;
  border-width: 0 2px 2px 0 !important;
  opacity: 0 !important;
  transform: rotate(45deg) scale(0.7) !important;
  transition: opacity 120ms ease, transform 120ms ease !important;
}
html.aft-compact-move-layout .aft-compact-window-focus-checkbox:checked {
  border-color: #E07B5B !important;
  background: #E07B5B !important;
  box-shadow: 0 2px 6px rgba(224,123,91,0.28) !important;
}
html.aft-compact-move-layout .aft-compact-window-focus-checkbox:checked::after {
  opacity: 1 !important;
  transform: rotate(45deg) scale(1) !important;
}
html.aft-compact-move-layout .aft-compact-window-focus-checkbox:focus-visible {
  outline: 2px solid rgba(224,123,91,0.42) !important;
  outline-offset: 2px !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-window-focus-control {
  border-top-color: #364351 !important;
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-window-focus-checkbox {
  border-color: #465564 !important;
  background: #18202A !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-window-focus-checkbox:checked {
  border-color: #E07B5B !important;
  background: #E07B5B !important;
  box-shadow: 0 2px 7px rgba(224,123,91,0.24) !important;
}
html.aft-compact-move-layout .aft-compact-volume-control {
  display: flex !important;
  align-items: flex-start !important;
  gap: 10px !important;
  min-width: 0 !important;
  min-height: 54px !important;
  padding: 7px 8px 9px !important;
  box-sizing: border-box !important;
  color: #253528 !important;
  font: 600 13px/1.2 Arial, sans-serif !important;
}
html.aft-compact-move-layout .aft-compact-volume-content {
  display: flex !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  flex-direction: column !important;
  gap: 8px !important;
}
html.aft-compact-move-layout .aft-compact-panel-actions .aft-compact-volume-mute {
  display: inline-flex !important;
  flex: 0 0 28px !important;
  width: 28px !important;
  min-width: 28px !important;
  height: 28px !important;
  min-height: 28px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 8px !important;
  color: #315C31 !important;
  cursor: pointer !important;
}
html.aft-compact-move-layout .aft-compact-panel-actions .aft-compact-volume-mute.aft-compact-volume-muted {
  color: #68746C !important;
}
html.aft-compact-move-layout .aft-compact-volume-heading {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 10px !important;
  min-width: 0 !important;
}
html.aft-compact-move-layout .aft-compact-volume-heading label {
  min-width: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
html.aft-compact-move-layout .aft-compact-volume-heading output {
  flex: 0 0 auto !important;
  color: inherit !important;
  font-variant-numeric: tabular-nums !important;
}
html.aft-compact-move-layout .aft-compact-volume-slider {
  width: 100% !important;
  height: 5px !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 999px !important;
  appearance: none !important;
  background: #D8E4D8 !important;
  accent-color: #E07B5B !important;
  cursor: pointer !important;
}
html.aft-compact-move-layout .aft-compact-volume-slider::-webkit-slider-thumb {
  width: 16px !important;
  height: 16px !important;
  border: 2px solid #FFFFFF !important;
  border-radius: 50% !important;
  appearance: none !important;
  background: #E07B5B !important;
  box-shadow: 0 1px 4px rgba(37,53,40,0.28) !important;
}
html.aft-compact-move-layout .aft-compact-volume-slider::-moz-range-thumb {
  width: 12px !important;
  height: 12px !important;
  border: 2px solid #FFFFFF !important;
  border-radius: 50% !important;
  background: #E07B5B !important;
  box-shadow: 0 1px 4px rgba(37,53,40,0.28) !important;
}
html.aft-compact-move-layout .aft-compact-sound-toggles {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 0 !important;
  padding: 2px 0 4px !important;
}
html.aft-compact-move-layout .aft-compact-sound-toggle {
  display: flex !important;
  position: relative !important;
  align-items: center !important;
  justify-content: flex-start !important;
  flex-direction: column !important;
  gap: 7px !important;
  min-width: 0 !important;
  min-height: 48px !important;
  padding: 0 8px !important;
  box-sizing: border-box !important;
  color: inherit !important;
  text-align: center !important;
  cursor: pointer !important;
}
html.aft-compact-move-layout .aft-compact-sound-toggle + .aft-compact-sound-toggle {
  border-left: 1px solid #C8D1C9 !important;
}
html.aft-compact-move-layout .aft-compact-sound-switch {
  position: relative !important;
  flex: 0 0 16px !important;
  width: 28px !important;
  height: 16px !important;
  margin: 0 !important;
  border: 1px solid #B7C2B9 !important;
  border-radius: 999px !important;
  appearance: none !important;
  background: #D8E0D9 !important;
  cursor: pointer !important;
  transition: background 140ms ease, border-color 140ms ease !important;
}
html.aft-compact-move-layout .aft-compact-sound-switch::after {
  content: "" !important;
  position: absolute !important;
  top: 2px !important;
  left: 2px !important;
  width: 10px !important;
  height: 10px !important;
  border-radius: 50% !important;
  background: #FFFFFF !important;
  box-shadow: 0 1px 3px rgba(37,53,40,0.30) !important;
  transition: transform 140ms ease !important;
}
html.aft-compact-move-layout .aft-compact-sound-switch:checked {
  border-color: #E07B5B !important;
  background: #E07B5B !important;
}
html.aft-compact-move-layout .aft-compact-sound-switch:checked::after {
  transform: translateX(12px) !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-volume-control {
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-panel-actions .aft-compact-volume-mute,
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-panel-actions .aft-compact-volume-mute.aft-compact-volume-muted {
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-volume-slider {
  background: #364351 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-sound-switch {
  border-color: #465564 !important;
  background: #25303C !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-sound-toggle + .aft-compact-sound-toggle {
  border-left-color: #364351 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-sound-switch:checked {
  border-color: #E07B5B !important;
  background: #E07B5B !important;
}
html.aft-compact-move-layout .aft-compact-undo-redo {
  display: grid !important;
  position: relative !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 6px !important;
  min-width: 0 !important;
  padding: 6px 0 4px !important;
  box-sizing: border-box !important;
  color: #253528 !important;
}
html.aft-compact-move-layout .aft-compact-volume-control,
html.aft-compact-move-layout .aft-compact-undo-redo {
  border-top: 1px solid #C8D1C9 !important;
}
html.aft-compact-move-layout .aft-compact-undo-redo::after {
  content: "" !important;
  position: absolute !important;
  top: 8px !important;
  bottom: 6px !important;
  left: 50% !important;
  width: 1px !important;
  background: #C8D1C9 !important;
  pointer-events: none !important;
}
html.aft-compact-move-layout .aft-compact-panel-actions .aft-compact-undo-redo-button {
  justify-content: center !important;
  flex-direction: column !important;
  gap: 7px !important;
  min-height: 66px !important;
  padding: 8px !important;
  border-radius: 8px !important;
  background: #F2F6F2 !important;
  color: inherit !important;
  text-align: center !important;
}
html.aft-compact-move-layout .aft-compact-undo-redo-shortcut {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  justify-self: center !important;
  width: auto !important;
  min-width: 24px !important;
  height: 24px !important;
  padding: 0 7px !important;
  box-sizing: border-box !important;
  border: 1px solid #D8E4D8 !important;
  border-radius: 7px !important;
  background: #FFFFFF !important;
  color: #68746C !important;
  font: 700 11px/1 Arial, sans-serif !important;
  text-align: center !important;
  white-space: nowrap !important;
  pointer-events: none !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-undo-redo {
  color: #EFF4F8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-volume-control,
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-undo-redo {
  border-top-color: #364351 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-undo-redo::after {
  background: #364351 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-panel-actions .aft-compact-undo-redo-button {
  background: #18202A !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-panel-actions .aft-compact-undo-redo-button:hover {
  background: #25303C !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout .aft-compact-undo-redo-shortcut {
  border-color: #364351 !important;
  background: #0B0F14 !important;
  color: #EFF4F8 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) {
  --aft-light-canvas: #E9E6E1;
  --aft-light-panel: #EFEBE5;
  --aft-light-surface: #F8F5F0;
  --aft-light-surface-raised: #FCFAF6;
  --aft-light-surface-muted: #EEE9E2;
  --aft-light-surface-hover: #E6E0D8;
  --aft-light-border: #D4CCC2;
  --aft-light-border-strong: #BEB3A7;
  --aft-light-text: #292C30;
  --aft-light-text-soft: #555A60;
  --aft-light-text-muted: #77736E;
  --aft-light-icon: #3E4247;
  --aft-light-peach: #E07B5B;
  --aft-light-peach-dark: #B95F46;
  background: var(--aft-light-canvas) !important;
  color: var(--aft-light-text) !important;
  color-scheme: light;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) body {
  background: var(--aft-light-canvas) !important;
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #wrapper,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel {
  background: var(--aft-light-panel) !important;
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .steps-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .step-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .scan,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .scanned,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .success-step,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .center-outer,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .center-inner {
  background: transparent !important;
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-compact-source-badge,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-destination-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box {
  background: var(--aft-light-surface) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: 0 7px 18px rgba(71,61,51,0.10) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-destination-container::before,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-container::before,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box::before,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box::before,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-compact-source-badge,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-compact-source-label {
  color: var(--aft-light-text-muted) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-destination-container .center-inner h3,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-container .center-inner h3,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-destination-container .scanned-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-container .scanned-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-destination-container .success-step-label,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-container .success-step-label,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-destination-container .success-step-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #scan-container .success-step-value {
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-compact-source-value {
  background: transparent !important;
  color: var(--aft-light-text) !important;
  border-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-container-age {
  background: transparent !important;
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-container-age .aft-latest-container-id {
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box .aft-latest-container-age-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box .aft-latest-container-quantity-value {
  color: var(--aft-light-peach-dark) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-direct-scan-input,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel input,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel select,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel textarea {
  background: var(--aft-light-surface-raised) !important;
  color: var(--aft-light-text) !important;
  border-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel input:focus,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel select:focus,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel textarea:focus,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-direct-scan-input:focus {
  border-color: var(--aft-light-peach) !important;
  box-shadow: 0 0 0 3px rgba(224,123,91,0.16) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel ::placeholder,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-direct-scan-input::placeholder {
  color: #8A8178 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-quick-buttons {
  border-color: var(--aft-light-border) !important;
  scrollbar-color: var(--aft-light-border-strong) transparent;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-quick-buttons::-webkit-scrollbar-thumb {
  background: var(--aft-light-border-strong) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-group-wrap {
  background: var(--aft-light-surface) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: 0 8px 20px rgba(71,61,51,0.09) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-group-body {
  background: transparent !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-button-row {
  background: var(--aft-light-surface-muted) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: 0 3px 10px rgba(71,61,51,0.08) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark):not(.aft-scan-drag-active) #aft-scan-buttons-panel .aft-scan-button-row:hover:not(.aft-scan-action-hover) {
  background: var(--aft-light-surface-hover) !important;
  border-color: var(--aft-light-border-strong) !important;
  box-shadow: 0 5px 13px rgba(71,61,51,0.12) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel button {
  background: var(--aft-light-surface-raised) !important;
  color: var(--aft-light-icon) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel button:hover {
  background: var(--aft-light-surface-hover) !important;
  border-color: var(--aft-light-border-strong) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-script-dialog-primary,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-script-dialog-primary:hover {
  background: var(--aft-light-peach) !important;
  color: #FFFFFF !important;
  border-color: var(--aft-light-peach) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-script-dialog-danger,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-script-dialog-danger:hover {
  background: #C95151 !important;
  color: #FFFFFF !important;
  border-color: #C95151 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-script-dialog-cancel,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-script-dialog-cancel:hover {
  background: #18202A !important;
  color: #EFF4F8 !important;
  border-color: #364351 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-script-dialog-primary,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-script-dialog-primary:hover {
  background: #E07B5B !important;
  color: #FFFFFF !important;
  border-color: #E07B5B !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-script-dialog-danger,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-script-dialog-danger:hover {
  background: #C95151 !important;
  color: #FFFFFF !important;
  border-color: #C95151 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-dropzone-main-button,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-dropzone-main-button:hover {
  background: transparent !important;
  color: var(--aft-light-text) !important;
  border-color: transparent !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-dropzone-action-button {
  background: transparent !important;
  color: var(--aft-light-icon) !important;
  border-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark):not(.aft-scan-drag-active) #aft-scan-buttons-panel .aft-scan-dropzone-action-button:hover {
  background: #DDD6CE !important;
  border-color: var(--aft-light-border-strong) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-group-color-button,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-group-color-button:hover {
  background: var(--aft-group-swatch, var(--aft-light-peach)) !important;
  color: #FFFFFF !important;
  border-color: var(--aft-light-border-strong) !important;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,0.42) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel button[title^="Usu\\0144"],
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel button[title="Anuluj"] {
  color: var(--aft-light-icon) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-empty-group,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-add-controls {
  background: var(--aft-light-surface-muted) !important;
  color: var(--aft-light-text-muted) !important;
  border-color: var(--aft-light-border-strong) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-new-dropzone-wrap button,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel button[data-aft-custom-bg="#1f683a"] {
  background: linear-gradient(180deg, var(--aft-light-peach) 0%, var(--aft-light-peach-dark) 100%) !important;
  color: #FFFFFF !important;
  border-color: var(--aft-light-peach) !important;
  box-shadow: 0 9px 20px rgba(185,95,70,0.22) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-new-dropzone-wrap button:hover,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel button[data-aft-custom-bg="#1f683a"]:hover {
  background: linear-gradient(180deg, #E78667 0%, #C5664C 100%) !important;
  border-color: #C5664C !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-box {
  background: var(--aft-light-surface) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: 0 7px 18px rgba(71,61,51,0.09) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-header {
  background: var(--aft-light-surface) !important;
  color: var(--aft-light-text) !important;
  border-bottom-color: var(--aft-light-peach) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-columns {
  background: var(--aft-light-surface-muted) !important;
  color: var(--aft-light-text-muted) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-row {
  background: var(--aft-light-surface) !important;
  color: var(--aft-light-text) !important;
  border-color: #DED7CF !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-count,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-age {
  color: var(--aft-light-peach-dark) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-empty {
  color: var(--aft-light-text-muted) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu #main-menu-container {
  background: var(--aft-light-surface) !important;
  color: var(--aft-light-text) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: 0 20px 50px rgba(71,61,51,0.22) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .menu-options li,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .menu-item-title,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-panel-actions button,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-menu-action-label {
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .menu-options li:hover,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-panel-actions button:hover,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-panel-actions #aft-scan-reset-session:hover {
  background: var(--aft-light-surface-hover) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-menu-icon {
  background: var(--aft-light-surface-muted) !important;
  color: var(--aft-light-icon) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .hot-key {
  background: var(--aft-light-surface-raised) !important;
  color: var(--aft-light-text-soft) !important;
  border-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-volume-control,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-undo-redo {
  border-top-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-window-focus-control {
  border-top-color: var(--aft-light-border) !important;
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-window-focus-checkbox {
  border-color: var(--aft-light-border-strong) !important;
  background: var(--aft-light-surface-raised) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-window-focus-checkbox:checked {
  border-color: var(--aft-light-peach-dark) !important;
  background: var(--aft-light-peach) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-undo-redo-button {
  background: var(--aft-light-surface-muted) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-undo-redo-button:hover {
  background: var(--aft-light-surface-hover) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #main-menu.aft-compact-main-menu .aft-compact-undo-redo-shortcut {
  border-color: var(--aft-light-border) !important;
  background: var(--aft-light-surface-raised) !important;
  color: var(--aft-light-text-soft) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .modal-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .exception-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #diversion-with-back-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-datamatrix-overlay .aft-scan-datamatrix-card {
  background: var(--aft-light-surface) !important;
  color: var(--aft-light-text) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: 0 20px 50px rgba(71,61,51,0.24) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .title-tab,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .modal-header,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .modal-instruction,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .modal-message,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .diversion-modal-action {
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .modal-container .title-tab,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .exception-container .title-tab,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #diversion-with-back-container .title-tab {
  background: var(--aft-light-surface-muted) !important;
  border-color: var(--aft-light-border) !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-datamatrix-overlay {
  background: rgba(55,48,42,0.28) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-datamatrix-overlay .aft-scan-datamatrix-close {
  background: var(--aft-light-surface-muted) !important;
  color: var(--aft-light-icon) !important;
  border-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-datamatrix-overlay .aft-scan-datamatrix-canvas-wrap {
  background: #FFFFFF !important;
  border-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-datamatrix-overlay .aft-scan-datamatrix-value {
  background: var(--aft-light-surface-muted) !important;
  color: var(--aft-light-text-soft) !important;
  border-color: var(--aft-light-border) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-waiting::before,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-waiting .center-inner h3,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-waiting .scanned-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-waiting .success-step-label,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-waiting .success-step-value {
  color: var(--aft-light-peach) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error::before,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error .center-inner h3,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error .scanned-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error .success-step-label,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error .success-step-value {
  color: #D85454 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error.aft-scan-error-returning::before,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error.aft-scan-error-returning .center-inner h3,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error.aft-scan-error-returning .scanned-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error.aft-scan-error-returning .success-step-label,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-error.aft-scan-error-returning .success-step-value {
  color: var(--aft-light-peach) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-loading .aft-latest-container-age-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box.aft-latest-age-loading .aft-latest-container-quantity-value {
  color: #D8886F !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-missing .aft-latest-container-age-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-empty .aft-latest-container-age-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box.aft-latest-age-missing .aft-latest-container-quantity-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box.aft-latest-age-empty .aft-latest-container-quantity-value {
  color: #8A8178 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-error .aft-latest-container-age-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box.aft-latest-age-error .aft-latest-container-quantity-value {
  color: #C84F4F !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel #scan-destination-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel #scan-container,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel #aft-latest-age-box,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel #aft-latest-quantity-box {
  background: var(--aft-light-surface) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) .aft-scan-waiting .aft-scan-waiting-pulse {
  box-shadow: none !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-row:nth-child(odd) {
  background: #F1ECE5 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-row:nth-child(even) {
  background: var(--aft-light-surface) !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-row:nth-child(odd) {
  background: #131A22 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-row:nth-child(even) {
  background: #0D1218 !important;
}

html.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-button-row.aft-scan-button-active {
  border-color: #E07B5B !important;
  box-shadow: 0 0 0 2px rgba(224,123,91,0.22), 0 3px 10px rgba(71,61,51,0.08) !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-button-row.aft-scan-button-active {
  border-color: #E07B5B !important;
  box-shadow: 0 0 0 2px rgba(224,123,91,0.20) !important;
}
html.aft-compact-move-layout #aft-scan-buttons-panel #aft-scan-new-dropzone-header,
html.aft-compact-move-layout #aft-scan-buttons-panel #aft-scan-new-dropzone-header:hover {
  background: linear-gradient(180deg, #E78667 0%, #C5664C 100%) !important;
  color: #FFFFFF !important;
  border-color: #C5664C !important;
  box-shadow: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 32px !important;
  min-height: 32px !important;
  max-height: 32px !important;
  box-sizing: border-box !important;
  line-height: 1 !important;
}
html.aft-compact-move-layout #aft-scan-buttons-panel #aft-scan-menu-toggle {
  height: 32px !important;
  min-height: 32px !important;
  max-height: 32px !important;
  box-sizing: border-box !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-safe {
  border-color: #43B047 !important;
  box-shadow: 0 0 0 1px rgba(67,176,71,0.16) !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-safe::after {
  background: #43B047 !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-safe .aft-latest-container-age-value {
  color: #43B047 !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-overdue {
  border-color: #D85454 !important;
  box-shadow: 0 0 0 1px rgba(216,84,84,0.16) !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-overdue::after {
  background: #D85454 !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-overdue .aft-latest-container-age-value {
  color: #D85454 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-safe {
  border-color: #2F7D32 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-safe::after {
  background-color: #2F7D32 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-safe .aft-latest-container-age-value {
  color: #2F7D32 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-overdue {
  border-color: #C84F4F !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-overdue::after {
  background-color: #C84F4F !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-overdue .aft-latest-container-age-value {
  color: #C84F4F !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-age-safe .aft-scan-history-age {
  color: #43B047 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-age-overdue .aft-scan-history-age {
  color: #D85454 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-age-safe .aft-scan-history-age {
  color: #2F7D32 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-age-overdue .aft-scan-history-age {
  color: #C84F4F !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-missing .aft-scan-history-age,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-missing .aft-scan-history-quantity {
  color: #7A817F !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-missing .aft-scan-history-age,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-missing .aft-scan-history-quantity {
  color: #8B98A5 !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-missing,
html.aft-compact-move-layout #aft-latest-quantity-box.aft-latest-age-missing {
  border-color: #8B98A5 !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-missing::after,
html.aft-compact-move-layout #aft-latest-quantity-box.aft-latest-age-missing::after {
  background: #8B98A5 !important;
}
html.aft-compact-move-layout #aft-latest-age-box.aft-latest-age-missing .aft-latest-container-age-value,
html.aft-compact-move-layout #aft-latest-quantity-box.aft-latest-age-missing .aft-latest-container-quantity-value {
  color: #8B98A5 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-missing,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box.aft-latest-age-missing {
  border-color: #8A8178 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-missing::after,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box.aft-latest-age-missing::after {
  background: #8A8178 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-age-box.aft-latest-age-missing .aft-latest-container-age-value,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-latest-quantity-box.aft-latest-age-missing .aft-latest-container-quantity-value {
  color: #8A8178 !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-columns {
  background: var(--aft-light-surface) !important;
  color: var(--aft-light-text-muted) !important;
  border-top-color: transparent !important;
  border-bottom-color: #CEC3B8 !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-column {
  border-right-color: transparent !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-sort-button {
  background: transparent !important;
  color: #514A44 !important;
  border: 0 !important;
  box-shadow: none !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-sort-button:hover,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-sort-button:focus-visible,
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-sort-active {
  background: transparent !important;
  color: var(--aft-light-text) !important;
}
html.aft-compact-move-layout:not(.aft-auto-dropzone-dark) #aft-scan-buttons-panel .aft-scan-history-filter-panel {
  background: #F0EBE5 !important;
  border-bottom-color: #CEC3B8 !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-columns {
  background: #0D1218 !important;
  color: #9EABB8 !important;
  border-top-color: transparent !important;
  border-bottom-color: #303C49 !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-sort-button {
  background: transparent !important;
  color: #D1DAE3 !important;
  border: 0 !important;
  box-shadow: none !important;
}
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-sort-button:hover,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-sort-button:focus-visible,
html.aft-auto-dropzone-dark.aft-compact-move-layout #aft-scan-buttons-panel .aft-scan-history-sort-active {
  background: transparent !important;
  color: #EFF4F8 !important;
}`;
        document.head.appendChild(style);
        cachedElements[style.id] = style;
    }

    function ensureCompactAftLayout() {
        var root = document.documentElement;
        var header = getCachedElement('header');
        var badge = getCachedElement('aft-compact-source-badge');
        var label;
        var value;

        if (root && root.classList) {
            root.classList.add('aft-compact-move-layout');
        }
        if (!header) {
            return null;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'aft-compact-source-badge';
            label = document.createElement('span');
            label.id = 'aft-compact-source-label';
            label.textContent = '\u0179r\u00f3d\u0142o';
            value = document.createElement('span');
            value.id = 'aft-compact-source-value';
            badge.appendChild(label);
            badge.appendChild(value);
            header.appendChild(badge);
            cachedElements[badge.id] = badge;
            cachedElements[label.id] = label;
            cachedElements[value.id] = value;
        }
        return badge;
    }

    function createCompactMenuIcon(key) {
        var icon = document.createElement('span');
        var svgMarkup;
        icon.className = 'aft-compact-menu-icon';
        icon.setAttribute('aria-hidden', 'true');
        if (key === 'S') {
            svgMarkup = '<svg viewBox="0 0 24 24"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></svg>';
        } else if (key === 'W') {
            svgMarkup = '<svg viewBox="0 0 24 24"><path d="M6 6h5v5H6zM13 13h5v5h-5zM11 8.5h4a3 3 0 0 1 3 3v1.5M13 15.5H9a3 3 0 0 1-3-3V11"/></svg>';
        } else {
            svgMarkup = '<svg viewBox="0 0 24 24"><path d="M5 8V4m0 0h4M5 4l3 3a7 7 0 1 1-2 7"/></svg>';
        }
        icon.innerHTML = svgMarkup;
        return icon;
    }

    function isCompactMenuToggleTarget(target) {
        var key;
        while (target && target !== document) {
            key = target.getAttribute && target.getAttribute('data-key');
            if (key && String(key).toUpperCase() === 'M') {
                return true;
            }
            target = target.parentNode;
        }
        return false;
    }

    function closeCompactAftMenu() {
        var menu = getCachedElement('main-menu');
        var presenter;
        if (!menu || window.getComputedStyle(menu).display === 'none') {
            return;
        }
        try {
            presenter = PAGE_WINDOW.aft && PAGE_WINDOW.aft.register('Menu', 'presenter');
            if (presenter && typeof presenter.hideMenu === 'function') {
                presenter.hideMenu();
                return;
            }
        } catch (e) {}
        menu.style.display = 'none';
    }

    function installCompactAftMenuDismissHandlers() {
        if (document.__aftCompactMenuDismissInstalled) {
            return;
        }
        document.__aftCompactMenuDismissInstalled = true;
        document.addEventListener('mousedown', function (event) {
            var menu = getCachedElement('main-menu');
            var container = getCachedElement('main-menu-container');
            if (!menu || !container || window.getComputedStyle(menu).display === 'none') {
                return;
            }
            if (container.contains(event.target) || isCompactMenuToggleTarget(event.target)) {
                return;
            }
            closeCompactAftMenu();
        }, true);
        document.addEventListener('keydown', function (event) {
            if (event && (event.key === 'Escape' || event.keyCode === 27)) {
                closeCompactAftMenu();
            }
        }, true);
    }

    function ensureCompactAftMenu() {
        var menu = getCachedElement('main-menu');
        var container = getCachedElement('main-menu-container');
        var titleTab;
        var options;
        var items;
        var item;
        var key;
        var label;
        var i;
        if (!menu || !container) {
            return;
        }
        menu.classList.add('aft-compact-main-menu');
        titleTab = container.querySelector('.title-tab');
        if (titleTab && titleTab.parentNode) {
            titleTab.parentNode.removeChild(titleTab);
        }
        options = container.querySelector('.menu-options');
        if (options) {
            options.setAttribute('role', 'menu');
            items = options.querySelectorAll('li');
            for (i = 0; i < items.length; i++) {
                item = items[i];
                key = String(item.getAttribute('data-key') || '').toUpperCase();
                if (key === 'S' || key === 'R') {
                    if (item.parentNode) {
                        item.parentNode.removeChild(item);
                    }
                    continue;
                }
                if (key === 'W') {
                    if (item.style.display !== 'flex') {
                        item.style.display = 'flex';
                    }
                    label = item.querySelector('.menu-item-title');
                    if (label && label.textContent !== 'Wybierz przebieg pracy') {
                        label.textContent = 'Wybierz przebieg pracy';
                    }
                    if (!item.__aftSafeWorkflowClickInstalled) {
                        item.__aftSafeWorkflowClickInstalled = true;
                        item.addEventListener('click', function (event) {
                            stopEvent(event);
                            closeCompactAftMenu();
                            openAftWorkflowSelection();
                        }, true);
                    }
                }
                item.setAttribute('role', 'menuitem');
                if (!item.querySelector('.aft-compact-menu-icon')) {
                    item.insertBefore(createCompactMenuIcon(key), item.firstChild);
                }
            }
        }
        installCompactAftMenuDismissHandlers();
    }

    function movePanelActionsIntoCompactMenu(actionButtons) {
        var container = getCachedElement('main-menu-container');
        var nativeOptions;
        var actionList;
        var button;
        var icon;
        var label;
        var labelText;
        var hotkey;
        var hotkeyText;
        var workflowItem;
        var i;
        if (!container || !actionButtons) {
            return;
        }
        actionList = container.querySelector('.aft-compact-panel-actions');
        if (!actionList) {
            actionList = document.createElement('div');
            actionList.className = 'menu-options aft-compact-panel-actions';
            actionList.setAttribute('role', 'menu');
            nativeOptions = container.querySelector('.menu-options');
            container.insertBefore(actionList, nativeOptions || null);
        }
        for (i = 0; i < actionButtons.length; i++) {
            button = actionButtons[i];
            if (!button || button.getAttribute('data-aft-menu-action') === '1') {
                continue;
            }
            labelText = button.getAttribute('data-aft-menu-label') || button.title || '';
            hotkeyText = button.getAttribute('data-aft-menu-hotkey') || '';
            icon = document.createElement('span');
            icon.className = 'aft-compact-menu-icon';
            icon.setAttribute('aria-hidden', 'true');
            while (button.firstChild) {
                icon.appendChild(button.firstChild);
            }
            label = document.createElement('span');
            label.className = 'aft-compact-menu-action-label';
            label.textContent = labelText;
            button.appendChild(icon);
            button.appendChild(label);
            if (hotkeyText) {
                hotkey = document.createElement('span');
                hotkey.className = 'hot-key';
                hotkey.textContent = hotkeyText;
                button.appendChild(hotkey);
            }
            button.setAttribute('data-aft-menu-action', '1');
            button.setAttribute('role', 'menuitem');
            button.addEventListener('mouseenter', function () {
                this.style.setProperty('background', isDarkModeEnabled() ? '#18202A' : '#F2F6F2', 'important');
            }, false);
            button.addEventListener('mouseleave', function () {
                this.style.removeProperty('background');
            }, false);
            button.addEventListener('click', closeCompactAftMenu, false);
            actionList.appendChild(button);
        }
        nativeOptions = container.querySelector('ul.menu-options');
        if (nativeOptions && nativeOptions !== actionList) {
            while (nativeOptions.firstChild) {
                actionList.appendChild(nativeOptions.firstChild);
            }
            if (nativeOptions.parentNode) {
                nativeOptions.parentNode.removeChild(nativeOptions);
            }
        }
        workflowItem = actionList.querySelector('[data-key="W"]');
        if (workflowItem) {
            actionList.insertBefore(workflowItem, actionList.children[1] || null);
        }
        ensureWindowFocusIndicatorMenuControl(actionList);
        ensureAgeAlarmVolumeMenuControl(actionList);
        ensureGroupUndoRedoMenuControl(actionList);
    }

    function updateWindowFocusIndicatorMenuControl(enabled) {
        var checkbox = getCachedElement('aft-window-focus-indicator-toggle');
        enabled = enabled !== false;
        if (checkbox) {
            checkbox.checked = enabled;
            checkbox.setAttribute('aria-checked', enabled ? 'true' : 'false');
        }
    }

    function ensureWindowFocusIndicatorMenuControl(actionList) {
        var control = getCachedElement('aft-window-focus-indicator-control');
        var label;
        var checkbox;
        if (!actionList) {
            return;
        }
        if (!control) {
            control = document.createElement('label');
            control.id = 'aft-window-focus-indicator-control';
            control.className = 'aft-compact-window-focus-control';

            label = document.createElement('span');
            label.className = 'aft-compact-window-focus-label';
            label.textContent = 'Komunikat \u201eNieaktywne okno\u201d';

            checkbox = document.createElement('input');
            checkbox.id = 'aft-window-focus-indicator-toggle';
            checkbox.className = 'aft-compact-window-focus-checkbox';
            checkbox.type = 'checkbox';
            checkbox.setAttribute('aria-label', 'Komunikat Nieaktywne okno');
            checkbox.addEventListener('change', function () {
                setWindowFocusIndicatorEnabled(checkbox.checked);
            });

            control.appendChild(checkbox);
            control.appendChild(label);
            cachedElements[control.id] = control;
            cachedElements[checkbox.id] = checkbox;
        }
        actionList.appendChild(control);
        updateWindowFocusIndicatorMenuControl(isWindowFocusIndicatorEnabled());
    }

    function updateAgeAlarmVolumeMenuControl(value) {
        var slider = getCachedElement('aft-age-alarm-volume');
        var output = getCachedElement('aft-age-alarm-volume-value');
        var muteButton = getCachedElement('aft-age-alarm-mute');
        var muted;
        value = normalizeAgeAlarmVolumePercent(value);
        muted = value === 0;
        if (slider && slider.value !== String(value)) {
            slider.value = String(value);
        }
        if (output) {
            output.textContent = value + '%';
        }
        if (muteButton) {
            muteButton.innerHTML = muted ?
                '<svg viewBox="0 0 24 24"><path d="M5 10v4h3l4 4V6l-4 4H5M16 9l5 6M21 9l-5 6"/></svg>' :
                '<svg viewBox="0 0 24 24"><path d="M5 10v4h3l4 4V6l-4 4H5M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
            muteButton.classList.toggle('aft-compact-volume-muted', muted);
            muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
            muteButton.setAttribute('aria-label', muted ? 'Przywr\u00f3\u0107 g\u0142o\u015bno\u015b\u0107' : 'Wycisz d\u017awi\u0119ki');
            muteButton.title = muted ? 'Przywr\u00f3\u0107 g\u0142o\u015bno\u015b\u0107' : 'Wycisz d\u017awi\u0119ki';
        }
    }

    function setAgeAlarmVolumePercent(value) {
        value = normalizeAgeAlarmVolumePercent(value);
        if (value > 0) {
            storageSet(STORAGE_KEY_AGE_ALARM_LAST_VOLUME, String(value));
        }
        storageSet(STORAGE_KEY_AGE_ALARM_VOLUME, String(value));
        updateAgeAlarmVolumeMenuControl(value);
        return value;
    }

    function toggleAgeAlarmMute() {
        var value = getAgeAlarmVolumePercent();
        return setAgeAlarmVolumePercent(value > 0 ? 0 : getLastUnmutedAgeAlarmVolumePercent());
    }

    function createScanSoundToggle(soundType, labelText) {
        var row = document.createElement('label');
        var label = document.createElement('span');
        var toggle = document.createElement('input');
        row.className = 'aft-compact-sound-toggle';
        label.textContent = labelText;
        toggle.type = 'checkbox';
        toggle.className = 'aft-compact-sound-switch';
        toggle.checked = isScanResultSoundEnabled(soundType);
        toggle.setAttribute('role', 'switch');
        toggle.setAttribute('aria-label', 'D\u017awi\u0119k ' + labelText);
        toggle.setAttribute('data-aft-sound-type', soundType);
        toggle.addEventListener('change', function () {
            setScanResultSoundEnabled(soundType, toggle.checked);
        });
        row.appendChild(label);
        row.appendChild(toggle);
        return row;
    }

    function ensureAgeAlarmVolumeMenuControl(actionList) {
        var control = getCachedElement('aft-age-alarm-volume-control');
        var icon;
        var content;
        var heading;
        var label;
        var output;
        var slider;
        var toggles;
        if (!actionList) {
            return;
        }
        if (!control) {
            control = document.createElement('div');
            control.id = 'aft-age-alarm-volume-control';
            control.className = 'aft-compact-volume-control';
            control.setAttribute('role', 'group');
            control.setAttribute('aria-label', 'Ustawienia d\u017awi\u0119k\u00f3w skanowania');

            icon = document.createElement('button');
            icon.id = 'aft-age-alarm-mute';
            icon.type = 'button';
            icon.className = 'aft-compact-menu-icon aft-compact-volume-mute';
            icon.addEventListener('click', function (event) {
                stopEvent(event);
                toggleAgeAlarmMute();
            }, true);

            content = document.createElement('div');
            content.className = 'aft-compact-volume-content';
            heading = document.createElement('div');
            heading.className = 'aft-compact-volume-heading';
            label = document.createElement('label');
            label.setAttribute('for', 'aft-age-alarm-volume');
            label.textContent = 'G\u0142o\u015bno\u015b\u0107 d\u017awi\u0119k\u00f3w';
            output = document.createElement('output');
            output.id = 'aft-age-alarm-volume-value';
            output.setAttribute('for', 'aft-age-alarm-volume');
            slider = document.createElement('input');
            slider.id = 'aft-age-alarm-volume';
            slider.className = 'aft-compact-volume-slider';
            slider.type = 'range';
            slider.min = '0';
            slider.max = '100';
            slider.step = '5';
            slider.setAttribute('aria-label', 'G\u0142o\u015bno\u015b\u0107 d\u017awi\u0119k\u00f3w');
            slider.addEventListener('input', function () {
                setAgeAlarmVolumePercent(slider.value);
            });

            toggles = document.createElement('div');
            toggles.className = 'aft-compact-sound-toggles';
            toggles.appendChild(createScanSoundToggle('iol', 'IOL'));
            toggles.appendChild(createScanSoundToggle('safe', 'Nie IOL'));
            toggles.appendChild(createScanSoundToggle('missing', 'Brak'));
            heading.appendChild(label);
            heading.appendChild(output);
            content.appendChild(toggles);
            content.appendChild(heading);
            content.appendChild(slider);
            control.appendChild(icon);
            control.appendChild(content);
            cachedElements[control.id] = control;
            cachedElements[icon.id] = icon;
            cachedElements[output.id] = output;
            cachedElements[slider.id] = slider;
        }
        actionList.appendChild(control);
        updateAgeAlarmVolumeMenuControl(getAgeAlarmVolumePercent());
    }

    function ensureGroupUndoRedoMenuControl(actionList) {
        var control = getCachedElement('aft-group-undo-redo-control');
        var undoButton;
        var redoButton;
        var undoShortcut;
        var redoShortcut;
        if (!actionList) {
            return;
        }
        if (!control) {
            control = document.createElement('div');
            control.id = 'aft-group-undo-redo-control';
            control.className = 'aft-compact-undo-redo';
            control.setAttribute('role', 'group');
            control.setAttribute('aria-label', 'Historia zmian');

            undoButton = document.createElement('button');
            undoButton.type = 'button';
            undoButton.className = 'aft-compact-undo-redo-button';
            undoButton.textContent = 'Cofnij';
            undoButton.setAttribute('role', 'menuitem');
            undoButton.addEventListener('click', function (event) {
                stopEvent(event);
                undoLatestChange();
            }, true);

            redoButton = document.createElement('button');
            redoButton.type = 'button';
            redoButton.className = 'aft-compact-undo-redo-button';
            redoButton.textContent = 'Pon\u00f3w';
            redoButton.setAttribute('role', 'menuitem');
            redoButton.addEventListener('click', function (event) {
                stopEvent(event);
                redoLatestChange();
            }, true);

            undoShortcut = document.createElement('span');
            undoShortcut.className = 'aft-compact-undo-redo-shortcut';
            undoShortcut.textContent = 'Ctrl+Z';
            undoShortcut.setAttribute('aria-hidden', 'true');

            redoShortcut = document.createElement('span');
            redoShortcut.className = 'aft-compact-undo-redo-shortcut';
            redoShortcut.textContent = 'Ctrl+Shift+Z';
            redoShortcut.setAttribute('aria-hidden', 'true');

            undoButton.appendChild(undoShortcut);
            redoButton.appendChild(redoShortcut);
            control.appendChild(undoButton);
            control.appendChild(redoButton);
            cachedElements[control.id] = control;
        }
        actionList.appendChild(control);
    }

    function blockAftSignOutHotkey() {
        var delegator;
        var blockedKeys = ['S', 'T', 'R', 'W', 'M'];
        var i;
        installLayoutIndependentAftHotkeys();
        try {
            if (PAGE_WINDOW.aft && PAGE_WINDOW.aft.bus && typeof PAGE_WINDOW.aft.bus.unbind === 'function') {
                for (i = 0; i < blockedKeys.length; i++) {
                    PAGE_WINDOW.aft.bus.unbind('hot-key-' + blockedKeys[i]);
                }
            }
        } catch (e) {}
        try {
            delegator = PAGE_WINDOW.aft && PAGE_WINDOW.aft.registry && PAGE_WINDOW.aft.registry.eventDelegator;
            if (delegator && (!isFinite(Number(delegator.delay)) || Number(delegator.delay) < 650)) {
                delegator.delay = 650;
            }
        } catch (e2) {}
    }

    function isEditableHotkeyTarget(target) {
        var tagName = String(target && target.tagName || '').toLowerCase();
        return !!(target && (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'));
    }

    function installLayoutIndependentAftHotkeys() {
        var pendingHotkeyTimer = null;
        var lastPrintableKeyAt = 0;
        var scannerBurstGapMs = 450;
        if (layoutIndependentHotkeysInstalled) {
            return;
        }
        layoutIndependentHotkeysInstalled = true;
        document.addEventListener('keydown', function (event) {
            var key;
            var code;
            var nowAt;
            var isPrintableKey;
            var isScannerBurst;
            var hotkey = '';
            if (!event || event.ctrlKey || event.altKey || event.metaKey || event.repeat || isEditableHotkeyTarget(event.target)) {
                return;
            }
            key = String(event.key || '').toUpperCase();
            code = String(event.code || '');
            if (key === 'ENTER' || code === 'Enter' || key === 'TAB' || code === 'Tab') {
                if (pendingHotkeyTimer) {
                    window.clearTimeout(pendingHotkeyTimer);
                    pendingHotkeyTimer = null;
                }
                lastPrintableKeyAt = 0;
                return;
            }
            isPrintableKey = key.length === 1 || /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code);
            if (!isPrintableKey) {
                return;
            }
            nowAt = now();
            isScannerBurst = !!(lastPrintableKeyAt && nowAt - lastPrintableKeyAt < scannerBurstGapMs);
            lastPrintableKeyAt = nowAt;
            if (pendingHotkeyTimer) {
                window.clearTimeout(pendingHotkeyTimer);
                pendingHotkeyTimer = null;
            }
            if (key === 'R' || code === 'KeyR') {
                hotkey = 'R';
            } else if (key === 'W' || code === 'KeyW') {
                hotkey = 'W';
            } else if (key === 'M' || code === 'KeyM') {
                hotkey = 'M';
            }
            if (!hotkey || isScannerBurst) {
                return;
            }
            pendingHotkeyTimer = window.setTimeout(function () {
                var resetBtn;
                pendingHotkeyTimer = null;
                if (now() - lastPrintableKeyAt < scannerBurstGapMs) {
                    return;
                }
                if (hotkey === 'R') {
                    resetBtn = getCachedElement('aft-scan-reset-session');
                    if (resetBtn && !resetBtn.disabled) {
                        resetBtn.click();
                    }
                } else if (hotkey === 'W') {
                    openAftWorkflowSelection();
                } else if (hotkey === 'M') {
                    toggleCompactAftMenu();
                }
            }, scannerBurstGapMs);
        }, true);
    }

    function openAftWorkflowSelection() {
        var handler;
        try {
            handler = PAGE_WINDOW.aft && PAGE_WINDOW.aft.register('SelectWorkflow', 'handler');
            if (handler && typeof handler.handleHotKeyW === 'function') {
                handler.handleHotKeyW();
                return true;
            }
        } catch (e) {}
        return triggerAftHotKey('W');
    }

    function toggleCompactAftMenu() {
        var presenter;
        try {
            presenter = PAGE_WINDOW.aft && PAGE_WINDOW.aft.register('Menu', 'presenter');
            if (presenter && typeof presenter.handleHotKeyM === 'function') {
                presenter.handleHotKeyM();
            }
        } catch (e) {}
    }

    function ensureScanWaitingPulse(box) {
        var pulse;
        if (!box || !box.querySelector) {
            return null;
        }
        pulse = box.querySelector('.aft-scan-waiting-pulse');
        if (!pulse) {
            pulse = document.createElement('span');
            pulse.className = 'aft-scan-waiting-pulse';
            pulse.setAttribute('aria-hidden', 'true');
            box.appendChild(pulse);
        }
        return pulse;
    }

    function setScanWaitingState(box, waiting) {
        if (!box || !box.classList) {
            return;
        }
        if (waiting) {
            ensureScanWaitingPulse(box);
            box.classList.add('aft-scan-waiting');
        } else {
            box.classList.remove('aft-scan-waiting');
        }
    }

    function triggerScanSuccessPulse(boxId) {
        var box = getCachedElement(boxId);
        var pulse;
        if (!box || !box.classList) {
            return;
        }
        pulse = ensureScanWaitingPulse(box);
        if (!pulse) {
            return;
        }
        if (box.__aftScanSuccessTimer) {
            window.clearTimeout(box.__aftScanSuccessTimer);
        }
        box.classList.remove('aft-scan-success');
        try {
            void pulse.offsetWidth;
        } catch (e) {}
        box.classList.add('aft-scan-success');
        box.__aftScanSuccessTimer = window.setTimeout(function () {
            box.classList.remove('aft-scan-success');
            box.__aftScanSuccessTimer = null;
        }, 1950);
    }

    function triggerScanErrorPulse(boxId) {
        var box = getCachedElement(boxId);
        var pulse;
        if (!box || !box.classList) {
            return;
        }
        pulse = ensureScanWaitingPulse(box);
        if (!pulse) {
            return;
        }
        if (box.__aftScanErrorTimer) {
            window.clearTimeout(box.__aftScanErrorTimer);
        }
        if (box.__aftScanErrorReturnTimer) {
            window.clearTimeout(box.__aftScanErrorReturnTimer);
        }
        box.classList.remove('aft-scan-error');
        box.classList.remove('aft-scan-error-returning');
        try {
            void pulse.offsetWidth;
        } catch (e) {}
        box.classList.add('aft-scan-error');
        box.__aftScanErrorReturnTimer = window.setTimeout(function () {
            box.classList.add('aft-scan-error-returning');
            box.__aftScanErrorReturnTimer = null;
        }, 1400);
        box.__aftScanErrorTimer = window.setTimeout(function () {
            box.classList.remove('aft-scan-error');
            box.classList.remove('aft-scan-error-returning');
            if (box.classList.contains('aft-scan-waiting')) {
                box.classList.remove('aft-scan-waiting');
                try {
                    void pulse.offsetWidth;
                } catch (e) {}
                box.classList.add('aft-scan-waiting');
            }
            box.__aftScanErrorTimer = null;
        }, 1950);
    }

    function installAftStepSuccessHook(stepId, boxId) {
        var step;
        var originalHandleScan;
        var wrappedHandleScan;
        try {
            if (!PAGE_WINDOW.aft || typeof PAGE_WINDOW.aft.register !== 'function') {
                return false;
            }
            step = PAGE_WINDOW.aft.register(stepId, 'step');
            if (!step || typeof step.handleScan !== 'function') {
                return false;
            }
            if (step.handleScan === step.__aftAutoDropZoneSuccessWrappedScan) {
                return true;
            }
            originalHandleScan = step.handleScan;
            wrappedHandleScan = function () {
                var result = originalHandleScan.apply(this, arguments);
                var errorTriggered = false;
                if (result && typeof result.done === 'function') {
                    result.done(function (response) {
                        if (response && response.success === true) {
                            triggerScanSuccessPulse(boxId);
                        } else if (response && response.success === false) {
                            if (boxId === 'scan-container' && now() < autoConfirmScanActiveUntil) {
                                triggerScanSuccessPulse(boxId);
                            } else {
                                errorTriggered = true;
                                triggerScanErrorPulse(boxId);
                            }
                        }
                    });
                }
                if (result && typeof result.fail === 'function') {
                    result.fail(function () {
                        if (boxId === 'scan-container' && now() < autoConfirmScanActiveUntil) {
                            triggerScanSuccessPulse(boxId);
                        } else if (!errorTriggered) {
                            triggerScanErrorPulse(boxId);
                        }
                    });
                }
                return result;
            };
            step.__aftAutoDropZoneSuccessWrappedScan = wrappedHandleScan;
            step.handleScan = wrappedHandleScan;
            return true;
        } catch (e) {}
        return false;
    }

    function installAftScanSuccessHooks() {
        installAftStepSuccessHook(AFT_STEP_DESTINATION, 'scan-destination-container');
        installAftStepSuccessHook(AFT_STEP_CONTAINER, 'scan-container');
    }

    function updateCompactScanInstructions() {
        var instructions;
        var instruction;
        var i;
        try {
            instructions = document.querySelectorAll(
                '#scan-destination-container .scan .center-inner h3,' +
                '#scan-container .scan .center-inner h3'
            );
        } catch (e) {
            return;
        }
        for (i = 0; i < instructions.length; i++) {
            instruction = instructions[i];
            if (instruction.textContent !== COMPACT_SCAN_INSTRUCTION_TEXT) {
                instruction.textContent = COMPACT_SCAN_INSTRUCTION_TEXT;
            }
        }
    }

    function updateScanWaitingAnimation() {
        var activeStepId = getActiveAftStepId();
        var canAcceptScan = !isAftInputDisabled() && !hasBlockingAftModal();
        updateCompactScanInstructions();
        setScanWaitingState(
            getCachedElement('scan-destination-container'),
            canAcceptScan && activeStepId === AFT_STEP_DESTINATION
        );
        setScanWaitingState(
            getCachedElement('scan-container'),
            canAcceptScan && activeStepId === AFT_STEP_CONTAINER
        );
    }

    function updateScanTextEndVisibility() {
        var selectors = [
            '#aft-compact-source-value',
            '#scan-destination-container .scanned-value',
            '#scan-destination-container .success-step-label',
            '#scan-destination-container .success-step-value',
            '#scan-container .scanned-value',
            '#scan-container .success-step-label',
            '#scan-container .success-step-value',
            '#aft-latest-container-age .aft-latest-container-id'
        ];
        var elements;
        var element;
        var context;
        var style;
        var text;
        var textWidth;
        var letterSpacing;
        var overflowed;
        var i;
        try {
            elements = document.querySelectorAll(selectors.join(','));
        } catch (e) {
            return;
        }
        try {
            if (!updateScanTextEndVisibility.__measureCanvas) {
                updateScanTextEndVisibility.__measureCanvas = document.createElement('canvas');
            }
            context = updateScanTextEndVisibility.__measureCanvas.getContext('2d');
        } catch (e2) {
            context = null;
        }
        for (i = 0; i < elements.length; i++) {
            element = elements[i];
            text = element ? trimText(element.textContent) : '';
            if (!element || !element.classList || !text || element.clientWidth <= 0 || !context) {
                if (element && element.classList) {
                    element.classList.remove('aft-scan-text-show-end');
                }
                continue;
            }
            try {
                style = window.getComputedStyle(element);
                context.font = style.font || [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
                textWidth = context.measureText(text).width;
                letterSpacing = parseFloat(style.letterSpacing);
                if (isFinite(letterSpacing) && text.length > 1) {
                    textWidth += letterSpacing * (text.length - 1);
                }
                overflowed = textWidth > element.clientWidth + 1;
            } catch (e3) {
                overflowed = false;
            }
            element.classList.toggle('aft-scan-text-show-end', overflowed);
        }
    }

    function updateCompactSourceBadge() {
        var session;
        var sourceText;
        var value;
        ensureCompactAftLayout();
        ensureCompactAftMenu();
        session = getAftSession();
        sourceText = trimText(session && session.sourceScannableId) || DEFAULT_SOURCE_SCAN;
        value = getCachedElement('aft-compact-source-value');
        if (value && value.textContent !== sourceText) {
            value.textContent = sourceText;
        }
    }

    function isDarkModeEnabled() {
        var root = document.documentElement;
        return !!(root && root.className && String(root.className).indexOf('aft-auto-dropzone-dark') !== -1);
    }

    function setDarkModeToggleIcon(button, enabled) {
        var iconMarkup;
        var iconHost;
        if (!button) {
            return;
        }
        iconMarkup = enabled
            ? '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14.7A8.2 8.2 0 0 1 9.3 3a7.4 7.4 0 1 0 11.7 11.7z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        iconHost = button.querySelector && button.querySelector('.aft-compact-menu-icon');
        if (iconHost) {
            iconHost.innerHTML = iconMarkup;
        } else {
            button.innerHTML = iconMarkup;
        }
        button.title = enabled ? 'W\u0142\u0105cz tryb jasny' : 'W\u0142\u0105cz tryb ciemny';
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.setAttribute('data-aft-dark-toggle', '1');
    }

    function setDarkModeClass(enabled) {
        var root = document.documentElement;
        if (!root) {
            return;
        }
        if (root.classList) {
            root.classList[enabled ? 'add' : 'remove']('aft-auto-dropzone-dark');
        } else if (enabled && String(root.className || '').indexOf('aft-auto-dropzone-dark') === -1) {
            root.className = trimText((root.className || '') + ' aft-auto-dropzone-dark');
        } else if (!enabled) {
            root.className = trimText(String(root.className || '').replace(/\baft-auto-dropzone-dark\b/g, ''));
        }
    }

    function applyDarkMode(enabled) {
        var button;
        setDarkModeClass(enabled);
        storageSet(STORAGE_KEY_DARK_MODE, enabled ? '1' : '0');
        button = getCachedElement('aft-scan-dark-mode-toggle');
        setDarkModeToggleIcon(button, enabled);
    }

    function toggleDarkMode() {
        applyDarkMode(!isDarkModeEnabled());
    }


    function installPanelEventShield(panel) {
        var keyboardEvents = ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'change', 'paste', 'copy', 'cut'];
        var mouseEvents = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend'];
        var i;

        function stopOnly(e) {
            if (e && e.stopPropagation) {
                e.stopPropagation();
            }
            if (e) {
                e.cancelBubble = true;
            }
        }

        function stopEventFromPanel(e) {
            var stepsContainer = document.querySelector('.steps-container');
            if (e && e.target && panel.contains(e.target)) {
                if (stepsContainer && (e.target === stepsContainer || stepsContainer.contains(e.target))) {
                    return;
                }
                stopOnly(e);
            }
        }

        for (i = 0; i < keyboardEvents.length; i++) {
            panel.addEventListener(keyboardEvents[i], stopEventFromPanel, false);
        }

        for (i = 0; i < mouseEvents.length; i++) {
            panel.addEventListener(mouseEvents[i], stopEventFromPanel, false);
        }
    }
    function updateGroupSelect() {
        var select = getCachedElement('aft-scan-group-select');
        if (!select) {
            return;
        }

        select.innerHTML = '';

        var noGroupOption = document.createElement('option');
        noGroupOption.value = UNGROUPED_GROUP_ID;
        noGroupOption.textContent = 'Bez grupy';
        if (activeGroupId === UNGROUPED_GROUP_ID) {
            noGroupOption.selected = true;
        }
        select.appendChild(noGroupOption);

        for (var i = 0; i < scanGroups.length; i++) {
            if (isUngroupedGroup(scanGroups[i])) {
                continue;
            }
            var option = document.createElement('option');
            option.value = scanGroups[i].id;
            option.textContent = scanGroups[i].name;
            if (scanGroups[i].id === activeGroupId) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    }

    function moveButton(sourceGroupId, sourceButtonId, targetGroupId, targetButtonId, insertAfterTarget, skipRender) {
        var sourceGroupIndex = findGroupIndex(sourceGroupId);
        var targetGroupIndex = findGroupIndex(targetGroupId);
        var sourceButtonIndex;
        var targetButtonIndex;
        var movingButton;
        var targetButtons;
        var insertIndex;

        if (targetGroupId === UNGROUPED_GROUP_ID && targetGroupIndex < 0) {
            ensureUngroupedGroup();
            targetGroupIndex = findGroupIndex(UNGROUPED_GROUP_ID);
        }

        if (sourceGroupIndex < 0 || targetGroupIndex < 0 || !sourceButtonId) {
            return;
        }

        if (sourceGroupId === targetGroupId && sourceButtonId === targetButtonId) {
            return;
        }

        sourceButtonIndex = findButtonIndex(scanGroups[sourceGroupIndex], sourceButtonId);
        if (sourceButtonIndex < 0) {
            return;
        }

        movingButton = scanGroups[sourceGroupIndex].buttons.splice(sourceButtonIndex, 1)[0];
        targetGroupIndex = findGroupIndex(targetGroupId);
        if (targetGroupIndex < 0) {
            scanGroups[sourceGroupIndex].buttons.splice(sourceButtonIndex, 0, movingButton);
            return;
        }

        targetButtons = scanGroups[targetGroupIndex].buttons;
        if (targetButtonId) {
            targetButtonIndex = findButtonIndex(scanGroups[targetGroupIndex], targetButtonId);
            if (targetButtonIndex < 0) {
                insertIndex = targetButtons.length;
            } else {
                insertIndex = targetButtonIndex + (insertAfterTarget ? 1 : 0);
            }
        } else {
            insertIndex = targetButtons.length;
        }

        if (insertIndex < 0) {
            insertIndex = 0;
        }
        if (insertIndex > targetButtons.length) {
            insertIndex = targetButtons.length;
        }

        targetButtons.splice(insertIndex, 0, movingButton);
        activeGroupId = targetGroupId;
        saveActiveGroup();
        saveGroups();
        if (!skipRender) {
            renderGroups();
            updateGroupSelect();
        }
    }

    function moveGroup(sourceGroupId, targetGroupId, insertAfterTarget, skipRender) {
        var sourceIndex = findGroupIndex(sourceGroupId);
        var targetIndex = findGroupIndex(targetGroupId);
        var movingGroup;
        var insertIndex;

        if (sourceIndex < 0 || targetIndex < 0 || sourceGroupId === targetGroupId || sourceGroupId === UNGROUPED_GROUP_ID || targetGroupId === UNGROUPED_GROUP_ID) {
            return;
        }

        movingGroup = scanGroups.splice(sourceIndex, 1)[0];
        targetIndex = findGroupIndex(targetGroupId);
        if (targetIndex < 0) {
            scanGroups.push(movingGroup);
        } else {
            insertIndex = targetIndex + (insertAfterTarget ? 1 : 0);
            if (insertIndex < 0) {
                insertIndex = 0;
            }
            if (insertIndex > scanGroups.length) {
                insertIndex = scanGroups.length;
            }
            scanGroups.splice(insertIndex, 0, movingGroup);
        }

        saveGroups();
        if (!skipRender) {
            updateGroupSelect();
            renderGroups();
        }
    }

    function onGroupDragStart(e, groupId) {
        dragData = null;
        clearDropMarker();
        groupDragData = {
            groupId: groupId
        };

        try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'group|' + groupId);
        } catch (ex) {}
    }

    function shouldInsertAfterGroup(e, groupWrap) {
        var rect;
        var ratio;
        try {
            rect = groupWrap.getBoundingClientRect();
            ratio = rect.height ? ((e.clientY - rect.top) / rect.height) : 1;

            if (dropTarget && dropTarget.type === 'group' &&
                    dropTarget.groupId === groupWrap.getAttribute('data-group-id') &&
                    ratio > 0.42 && ratio < 0.58) {
                return dropTarget.after === true;
            }

            return ratio > 0.55;
        } catch (ex) {
            return true;
        }
    }

    function findNearestGroupDropAnchor(quickBox, e) {
        var groups;
        var candidates = [];
        var group;
        var groupId;
        var rect;
        var i;

        if (!quickBox || !quickBox.querySelectorAll || !e) {
            return null;
        }

        try {
            groups = quickBox.querySelectorAll('.aft-scan-group-wrap');
            for (i = 0; groups && i < groups.length; i++) {
                group = groups[i];
                groupId = group && group.getAttribute ? group.getAttribute('data-group-id') : '';
                if (!groupId || groupId === UNGROUPED_GROUP_ID || (groupDragData && groupDragData.groupId === groupId)) {
                    continue;
                }
                rect = group.getBoundingClientRect();
                candidates.push({
                    element: group,
                    groupId: groupId,
                    centerY: rect.top + (rect.height / 2)
                });
            }

            if (!candidates.length) {
                return null;
            }

            if (e.clientY < candidates[0].centerY) {
                return {
                    element: candidates[0].element,
                    groupId: candidates[0].groupId,
                    after: false
                };
            }

            for (i = 1; i < candidates.length; i++) {
                if (e.clientY < candidates[i].centerY) {
                    return {
                        element: candidates[i - 1].element,
                        groupId: candidates[i - 1].groupId,
                        after: true
                    };
                }
            }

            return {
                element: candidates[candidates.length - 1].element,
                groupId: candidates[candidates.length - 1].groupId,
                after: true
            };
        } catch (ex) {}

        return null;
    }

    var flipIdCounter = 1;

    function getFlipId(element) {
        var buttonId;
        var groupId;
        var groupBodyId;
        if (!element) {
            return '';
        }
        try {
            buttonId = element.getAttribute ? element.getAttribute('data-button-id') : '';
            if (buttonId) {
                return 'btn_' + buttonId;
            }
            groupId = element.getAttribute ? element.getAttribute('data-group-id') : '';
            if (groupId) {
                return 'grp_' + groupId;
            }
            groupBodyId = element.getAttribute ? element.getAttribute('data-group-body-id') : '';
            if (groupBodyId) {
                return 'grp_body_' + groupBodyId;
            }
        } catch (e) {}
        if (!element.__aftScanFlipId) {
            element.__aftScanFlipId = 'flip_' + (flipIdCounter++);
        }
        return element.__aftScanFlipId;
    }

    function isAnimatableDirectChild(element) {
        var cls;
        if (!element || element.id === 'aft-scan-drop-marker' || element.id === 'aft-scan-drop-placeholder') {
            return false;
        }
        cls = String(element.className || '');
        return cls.indexOf('aft-scan-button-row') !== -1 || cls.indexOf('aft-scan-group-wrap') !== -1 || cls.indexOf('aft-scan-ungrouped-grid') !== -1;
    }

    function resolveDropAnimationContainer(containerInfo) {
        if (!containerInfo) {
            return null;
        }
        if (containerInfo.type === 'quick') {
            return getCachedElement('aft-scan-quick-buttons');
        }
        if (containerInfo.type === 'groupBody') {
            try {
                return document.querySelector('[data-group-body-id="' + containerInfo.groupId + '"]');
            } catch (e) {}
        }
        return containerInfo.element || null;
    }

    function captureDirectChildPositions(containers) {
        var map = {};
        var used = {};
        var i;
        var c;
        var key;
        var children;
        var child;
        var rect;
        var id;

        for (i = 0; i < containers.length; i++) {
            key = containers[i] && containers[i].key ? containers[i].key : getFlipId(containers[i]);
            if (!key || used[key]) {
                continue;
            }
            used[key] = true;
            c = resolveDropAnimationContainer(containers[i]);
            if (!c) {
                continue;
            }
            children = c.children || [];
            for (var j = 0; j < children.length; j++) {
                child = children[j];
                if (!isAnimatableDirectChild(child)) {
                    continue;
                }
                try {
                    rect = child.getBoundingClientRect();
                    id = getFlipId(child);
                    map[id] = { el: child, top: rect.top, left: rect.left };
                } catch (ex) {}
            }
        }
        return map;
    }

    function animateDirectChildLayout(containers, changeFn) {
        var before = captureDirectChildPositions(containers);
        var after;
        var id;
        var beforeItem;
        var afterItem;
        var newRect;
        var dx;
        var dy;
        var element;
        var animated = [];

        changeFn();

        after = captureDirectChildPositions(containers);

        for (id in before) {
            if (!before.hasOwnProperty(id) || !after[id]) {
                continue;
            }
            beforeItem = before[id];
            afterItem = after[id];
            newRect = afterItem;
            dx = beforeItem.left - newRect.left;
            dy = beforeItem.top - newRect.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                continue;
            }
            try {
                element = afterItem.el;
                element.__aftOldTransition = element.style.transition || '';
                element.style.transition = 'none';
                element.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
                element.style.willChange = 'transform';
                animated.push(element);
            } catch (ex2) {}
        }

        if (!animated.length) {
            return;
        }

        window.setTimeout(function () {
            for (var i = 0; i < animated.length; i++) {
                try {
                    animated[i].style.transition = 'transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 120ms ease';
                    animated[i].style.transform = '';
                } catch (ex3) {}
            }
        }, 0);

        window.setTimeout(function () {
            for (var i = 0; i < animated.length; i++) {
                try {
                    animated[i].style.transition = animated[i].__aftOldTransition || '';
                    animated[i].style.willChange = '';
                    animated[i].__aftOldTransition = '';
                } catch (ex4) {}
            }
        }, 210);
    }

    function isSameDropTarget(nextTarget) {
        if (!dropTarget || !nextTarget) {
            return false;
        }
        return dropTarget.type === nextTarget.type &&
            dropTarget.groupId === nextTarget.groupId &&
            dropTarget.buttonId === nextTarget.buttonId &&
            dropTarget.after === nextTarget.after &&
            dropTarget.anchorGroupId === nextTarget.anchorGroupId &&
            dropTarget.anchorAfter === nextTarget.anchorAfter;
    }

    function onDragStart(e, groupId, buttonId) {
        groupDragData = null;
        clearDropMarker();
        dragData = {
            groupId: groupId,
            buttonId: buttonId
        };

        try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', groupId + '|' + buttonId);
        } catch (ex) {}
    }

    function enableDropZonePointerDrag(scanBtn, row, groupId, buttonId) {
        var startX = 0;
        var startY = 0;
        var tracking = false;
        var dragging = false;
        var suppressClickUntil = 0;

        if (!scanBtn || !row) {
            return;
        }

        row.setAttribute('draggable', 'false');
        scanBtn.setAttribute('draggable', 'false');
        row.style.userSelect = 'none';
        scanBtn.style.userSelect = 'none';

        function removeTrackingListeners() {
            document.removeEventListener('mousemove', handleMouseMove, true);
            document.removeEventListener('mouseup', handleMouseUp, true);
            window.removeEventListener('blur', cancelPointerDrag, false);
        }

        function finishTracking() {
            removeTrackingListeners();
            tracking = false;
            dragging = false;
            row.style.opacity = '1';
            if (document.documentElement && document.documentElement.classList) {
                document.documentElement.classList.remove('aft-scan-drag-active');
            }
        }

        function updatePointerDropTarget(e) {
            var target;
            var targetRow;
            var targetContainer;
            var targetGroupId;
            var targetGroupWrap;
            var targetGroupBody;
            var quickBox;

            try {
                target = document.elementFromPoint(e.clientX, e.clientY) || e.target;
            } catch (ex) {
                target = e.target;
            }

            targetRow = getClosestWithClass(target, 'aft-scan-button-row');
            if (targetRow) {
                targetContainer = targetRow.parentNode;
                targetGroupId = targetContainer && targetContainer.getAttribute ?
                    (targetContainer.getAttribute('data-group-body-id') || '') : '';
                if (targetGroupId) {
                    showButtonDropMarker(e, targetRow, targetGroupId, targetRow.getAttribute('data-button-id') || null);
                    return true;
                }
            }

            targetGroupWrap = getClosestWithClass(target, 'aft-scan-group-wrap');
            if (targetGroupWrap) {
                targetGroupId = targetGroupWrap.getAttribute('data-group-id') || '';
                targetGroupBody = targetGroupWrap.querySelector ? targetGroupWrap.querySelector('.aft-scan-group-body') : null;
                if (targetGroupId) {
                    showAppendButtonDropMarker(e, targetGroupId, targetGroupWrap, targetGroupBody);
                    return true;
                }
            }

            quickBox = getCachedElement('aft-scan-quick-buttons');
            if (quickBox && target && (target === quickBox || (quickBox.contains && quickBox.contains(target)))) {
                showUngroupedDropMarker(e, quickBox);
                return true;
            }

            if (showForgivingEdgeDropMarker(e) === false) {
                return true;
            }

            clearDropMarker();
            return false;
        }

        function handleMouseMove(e) {
            var dx;
            var dy;
            if (!tracking) {
                return;
            }

            dx = e.clientX - startX;
            dy = e.clientY - startY;
            if (!dragging && ((dx * dx) + (dy * dy)) < 36) {
                return;
            }

            if (!dragging) {
                dragging = true;
                if (document.documentElement && document.documentElement.classList) {
                    document.documentElement.classList.add('aft-scan-drag-active');
                }
                onDragStart(e, groupId, buttonId);
                row.style.opacity = '0.45';
            }
            updatePointerDropTarget(e);
        }

        function handleMouseUp(e) {
            var shouldDrop;
            if (!tracking) {
                return;
            }

            shouldDrop = dragging;
            if (shouldDrop) {
                updatePointerDropTarget(e);
                suppressClickUntil = now() + 350;
            }
            finishTracking();

            if (shouldDrop && dropTarget) {
                performDropTarget(e);
            } else if (shouldDrop) {
                dragData = null;
                groupDragData = null;
                clearDropMarker();
                stopEvent(e);
            }
        }

        function cancelPointerDrag() {
            if (!tracking) {
                return;
            }
            if (dragging) {
                suppressClickUntil = now() + 350;
            }
            dragData = null;
            groupDragData = null;
            clearDropMarker();
            finishTracking();
        }

        row.addEventListener('mousedown', function (e) {
            if (!e || e.button !== 0 || getClosestWithClass(e.target, 'aft-scan-dropzone-actions')) {
                return;
            }
            startX = e.clientX;
            startY = e.clientY;
            tracking = true;
            dragging = false;
            removeTrackingListeners();
            document.addEventListener('mousemove', handleMouseMove, true);
            document.addEventListener('mouseup', handleMouseUp, true);
            window.addEventListener('blur', cancelPointerDrag, false);
        }, false);

        row.addEventListener('click', function (e) {
            if (now() < suppressClickUntil) {
                stopEvent(e);
            }
        }, true);
    }

    function getDropMarker() {
        var marker = getCachedElement('aft-scan-drop-marker');
        if (!marker) {
            marker = document.createElement('div');
            marker.id = 'aft-scan-drop-marker';
            marker.style.position = 'fixed';
            marker.style.left = '0px';
            marker.style.top = '0px';
            marker.style.width = '0px';
            marker.style.height = '8px';
            marker.style.margin = '0';
            marker.style.borderRadius = '999px';
            marker.style.background = 'rgba(224,123,91,0.96)';
            marker.style.boxShadow = '0 0 0 1px rgba(185,95,70,0.42), 0 0 12px rgba(224,123,91,0.58)';
            marker.style.pointerEvents = 'none';
            marker.style.zIndex = '2147483647';
            marker.style.opacity = '0';
            marker.style.transition = 'opacity 60ms ease';
            cachedElements[marker.id] = marker;
        }
        return marker;
    }

    function removeDropMarkerElement() {
        var marker = getCachedElement('aft-scan-drop-marker');
        if (dropMarkerFrame) {
            try {
                if (window.cancelAnimationFrame) {
                    window.cancelAnimationFrame(dropMarkerFrame);
                } else {
                    window.clearTimeout(dropMarkerFrame);
                }
            } catch (e) {}
        }
        dropMarkerFrame = null;
        pendingDropMarker = null;
        if (marker && marker.parentNode) {
            marker.parentNode.removeChild(marker);
        }
        if (cachedElements['aft-scan-drop-marker']) {
            delete cachedElements['aft-scan-drop-marker'];
        }
    }

    function clearDropPlaceholder() {
        var placeholder = getCachedElement('aft-scan-drop-placeholder');
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
        if (cachedElements['aft-scan-drop-placeholder']) {
            delete cachedElements['aft-scan-drop-placeholder'];
        }
    }

    function clearDropMarker() {
        removeDropMarkerElement();
        clearDropPlaceholder();
        dropTarget = null;
    }

    function getClosestWithClass(el, className) {
        while (el && el !== document) {
            if (el.className && String(el.className).indexOf(className) !== -1) {
                return el;
            }
            el = el.parentNode;
        }
        return null;
    }

    function setDropEffect(e) {
        if (!dragData && !groupDragData) {
            return false;
        }
        stopEvent(e);
        try {
            e.dataTransfer.dropEffect = 'move';
        } catch (ex) {}
        return true;
    }

    function shouldInsertAfter(e, row) {
        var rect;
        var ratio;
        var buttonId;
        var horizontalLayout;
        var lowerDeadZone;
        var upperDeadZone;
        try {
            rect = row.getBoundingClientRect();
            horizontalLayout = isHorizontalButtonLayout(row.parentNode);
            ratio = horizontalLayout && rect.width ? ((e.clientX - rect.left) / rect.width) : (rect.height ? ((e.clientY - rect.top) / rect.height) : 1);
            buttonId = row.getAttribute('data-button-id') || '';
            lowerDeadZone = horizontalLayout ? 0.44 : 0.30;
            upperDeadZone = horizontalLayout ? 0.56 : 0.70;

            if (dropTarget && dropTarget.type === 'button' &&
                    dropTarget.buttonId === buttonId &&
                    ratio > lowerDeadZone && ratio < upperDeadZone) {
                return dropTarget.after === true;
            }

            return ratio > (horizontalLayout ? 0.50 : 0.62);
        } catch (ex) {
            return true;
        }
    }

    function isHorizontalButtonLayout(container) {
        var style;
        if (!container || !window.getComputedStyle) {
            return false;
        }
        try {
            style = window.getComputedStyle(container);
            return !!(style && (/grid|flex/i).test(String(style.display || '')));
        } catch (e) {}
        return false;
    }

    function buildBalancedDropZoneRows(desiredWidths, rowCount, containerWidth) {
        var gap = 10;
        var count = desiredWidths ? desiredWidths.length : 0;
        var baseSize;
        var extraRows;
        var prefixWidths = [0];
        var memo = {};
        var i;

        if (!count || rowCount < 1 || rowCount > count) {
            return null;
        }

        baseSize = Math.floor(count / rowCount);
        extraRows = count % rowCount;

        for (i = 0; i < count; i++) {
            prefixWidths.push(prefixWidths[i] + desiredWidths[i]);
        }

        function solve(rowIndex, itemIndex, extrasLeft) {
            var rowsLeft = rowCount - rowIndex;
            var key = rowIndex + ':' + itemIndex + ':' + extrasLeft;
            var sizes = [];
            var size;
            var requiredWidth;
            var overflow;
            var next;
            var candidate;
            var best = null;
            var s;

            if (!rowsLeft) {
                return itemIndex === count ? { rows: [], maxOverflow: 0 } : null;
            }
            if (memo.hasOwnProperty(key)) {
                return memo[key];
            }

            if (extrasLeft > 0) {
                sizes.push(baseSize + 1);
            }
            if (rowsLeft > extrasLeft) {
                sizes.push(baseSize);
            }

            for (s = 0; s < sizes.length; s++) {
                size = sizes[s];
                if (size < 1 || itemIndex + size > count) {
                    continue;
                }

                next = solve(rowIndex + 1, itemIndex + size, extrasLeft - (size > baseSize ? 1 : 0));
                if (!next) {
                    continue;
                }

                requiredWidth = prefixWidths[itemIndex + size] - prefixWidths[itemIndex] + (gap * (size - 1));
                overflow = Math.max(0, requiredWidth - containerWidth);
                candidate = {
                    rows: [{ start: itemIndex, end: itemIndex + size }].concat(next.rows),
                    maxOverflow: Math.max(overflow, next.maxOverflow)
                };

                if (!best || candidate.maxOverflow < best.maxOverflow - 0.01) {
                    best = candidate;
                }
            }

            memo[key] = best;
            return best;
        }

        return solve(0, 0, extraRows);
    }

    function chooseBalancedDropZoneRows(desiredWidths, containerWidth) {
        var gap = 10;
        var minimumWidth = 260;
        var count = desiredWidths ? desiredWidths.length : 0;
        var maxItemsPerRow;
        var minimumRows;
        var fallback = null;
        var candidate;
        var rowCount;

        if (!count) {
            return [];
        }

        maxItemsPerRow = Math.max(1, Math.min(count, Math.floor((containerWidth + gap) / (minimumWidth + gap))));
        minimumRows = Math.max(1, Math.ceil(count / maxItemsPerRow));

        for (rowCount = minimumRows; rowCount <= count; rowCount++) {
            candidate = buildBalancedDropZoneRows(desiredWidths, rowCount, containerWidth);
            if (!candidate) {
                continue;
            }
            fallback = candidate;
            if (candidate.maxOverflow <= 0.5) {
                return candidate.rows;
            }
        }

        return fallback ? fallback.rows : [];
    }

    function updateDropZoneGridLayouts() {
        var containers;
        var container;
        var rows;
        var width;
        var columns;
        var desiredWidths;
        var desiredWidth;
        var balancedRows;
        var balancedRow;
        var itemIndex;
        var itemCount;
        var missingSlots;
        var span;
        var i;
        var r;

        function getContainerContentWidth(el) {
            var measuredWidth;
            var style;

            try {
                measuredWidth = el.clientWidth || (el.getBoundingClientRect ? el.getBoundingClientRect().width : 0);
            } catch (e) {
                measuredWidth = 0;
            }

            try {
                style = window.getComputedStyle ? window.getComputedStyle(el) : null;
                if (style) {
                    measuredWidth -= parseFloat(style.paddingLeft) || 0;
                    measuredWidth -= parseFloat(style.paddingRight) || 0;
                }
            } catch (e2) {}

            return Math.max(0, measuredWidth || 0);
        }

        try {
            containers = document.querySelectorAll('.aft-scan-group-body, .aft-scan-ungrouped-grid');
        } catch (e) {
            return;
        }

        for (i = 0; containers && i < containers.length; i++) {
            container = containers[i];
            rows = container.querySelectorAll ? container.querySelectorAll('.aft-scan-button-row') : [];
            if (!rows || !rows.length) {
                continue;
            }

            width = getContainerContentWidth(container);

            desiredWidths = [];
            for (r = 0; rows && r < rows.length; r++) {
                desiredWidth = parseInt(rows[r].getAttribute('data-aft-desired-width') || '260', 10);
                desiredWidths.push(Math.max(260, Math.min(520, desiredWidth || 260)));
            }

            balancedRows = chooseBalancedDropZoneRows(desiredWidths, width);
            columns = 1;
            for (r = 0; r < balancedRows.length; r++) {
                columns = Math.max(columns, balancedRows[r].end - balancedRows[r].start);
            }

            container.style.display = 'grid';
            container.style.flexWrap = '';
            container.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0, 1fr))';
            container.style.gridAutoFlow = 'row';
            container.style.alignItems = 'stretch';
            container.style.justifyItems = 'stretch';

            for (r = 0; r < balancedRows.length; r++) {
                balancedRow = balancedRows[r];
                itemCount = balancedRow.end - balancedRow.start;
                missingSlots = Math.max(0, columns - itemCount);
                for (itemIndex = balancedRow.start; itemIndex < balancedRow.end; itemIndex++) {
                    span = 1;
                    if (itemIndex === balancedRow.end - 1) {
                        span += missingSlots;
                    }
                    rows[itemIndex].style.gridColumn = 'span ' + span;
                    rows[itemIndex].style.flex = 'none';
                    rows[itemIndex].style.width = 'auto';
                    rows[itemIndex].style.minWidth = '0';
                    rows[itemIndex].style.maxWidth = 'none';
                }
            }
        }
    }

    function showOverlayMarkerAt(left, top, width, height) {
        clearDropPlaceholder();
        pendingDropMarker = {
            left: Math.max(6, left),
            top: Math.max(4, top),
            width: Math.max(4, width),
            height: Math.max(4, height)
        };

        if (dropMarkerFrame) {
            return;
        }

        dropMarkerFrame = (window.requestAnimationFrame || function (fn) {
            return window.setTimeout(fn, 16);
        })(function () {
            var marker;
            var next = pendingDropMarker;
            dropMarkerFrame = null;
            pendingDropMarker = null;
            if (!next) {
                return;
            }
            marker = getDropMarker();
            if (!marker.parentNode) {
                document.body.appendChild(marker);
            }
            marker.style.left = next.left + 'px';
            marker.style.top = next.top + 'px';
            marker.style.width = next.width + 'px';
            marker.style.height = next.height + 'px';
            marker.style.opacity = '1';
        });
    }

    function showOverlayMarkerForRect(rect, top) {
        if (!rect) {
            return;
        }

        showOverlayMarkerAt(rect.left + 6, top, Math.max(42, rect.width - 12), 8);
    }

    function showVerticalMarkerForRow(container, targetRow, after) {
        var rect;
        var neighbor;
        var neighborRect;
        var lineWidth = 8;
        var left;
        var top;
        var height;

        if (!targetRow) {
            return;
        }

        try {
            rect = targetRow.getBoundingClientRect();
            neighbor = findVisualNeighborButtonRow(container, targetRow, after);
            left = after ? (rect.right - (lineWidth / 2)) : (rect.left - (lineWidth / 2));
            if (neighbor) {
                neighborRect = neighbor.getBoundingClientRect();
                left = after ? ((rect.right + neighborRect.left - lineWidth) / 2) : ((neighborRect.right + rect.left - lineWidth) / 2);
            }
            top = rect.top + 4;
            height = Math.max(22, rect.height - 8);
            showOverlayMarkerAt(left, top, lineWidth, height);
        } catch (e) {}
    }

    function findButtonRowInContainer(container, buttonId) {
        var children;
        var i;
        var child;
        if (!container || !buttonId) {
            return null;
        }
        children = container.children || [];
        for (i = 0; i < children.length; i++) {
            child = children[i];
            if (!child || child.id === 'aft-scan-drop-placeholder') {
                continue;
            }
            if (child.getAttribute && child.getAttribute('data-button-id') === buttonId) {
                return child;
            }
        }
        return null;
    }

    function isButtonRowElement(element) {
        return !!(element &&
            element.id !== 'aft-scan-drop-marker' &&
            element.id !== 'aft-scan-drop-placeholder' &&
            element.getAttribute &&
            element.getAttribute('data-button-id'));
    }

    function findVisualNeighborButtonRow(container, targetRow, after) {
        var children;
        var targetRect;
        var child;
        var rect;
        var i;
        var targetIndex = -1;
        var direction = after ? 1 : -1;

        if (!container || !targetRow) {
            return null;
        }

        try {
            children = container.children || [];
            targetRect = targetRow.getBoundingClientRect();
            for (i = 0; i < children.length; i++) {
                if (children[i] === targetRow) {
                    targetIndex = i;
                    break;
                }
            }
            if (targetIndex < 0) {
                return null;
            }
            for (i = targetIndex + direction; i >= 0 && i < children.length; i += direction) {
                child = children[i];
                if (!isButtonRowElement(child)) {
                    continue;
                }
                rect = child.getBoundingClientRect();
                if (Math.abs(rect.top - targetRect.top) <= Math.max(8, targetRect.height * 0.35)) {
                    return child;
                }
                return null;
            }
        } catch (e) {}
        return null;
    }

    function findNearestButtonDropAnchor(container, e) {
        var children;
        var child;
        var rect;
        var centerX;
        var centerY;
        var dx;
        var dy;
        var distance;
        var best = null;
        var bestDistance = Infinity;
        var horizontalLayout = isHorizontalButtonLayout(container);
        var i;

        if (!container || !e) {
            return null;
        }

        try {
            children = container.children || [];
            for (i = 0; i < children.length; i++) {
                child = children[i];
                if (!isButtonRowElement(child)) {
                    continue;
                }
                rect = child.getBoundingClientRect();
                centerX = rect.left + (rect.width / 2);
                centerY = rect.top + (rect.height / 2);
                dx = Math.abs(e.clientX - centerX);
                dy = Math.abs(e.clientY - centerY);
                distance = horizontalLayout ? (dy * 3 + dx) : (dx + dy * 3);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = {
                        row: child,
                        buttonId: child.getAttribute('data-button-id') || null,
                        after: horizontalLayout ? (e.clientX > centerX) : (e.clientY > centerY)
                    };
                }
            }
        } catch (ex) {}
        return best;
    }

    function showButtonInsertionMarker(container, targetButtonId, after) {
        var targetRow;

        if (!container) {
            return;
        }

        targetRow = targetButtonId ? findButtonRowInContainer(container, targetButtonId) : null;
        if (targetRow) {
            if (isHorizontalButtonLayout(container)) {
                showVerticalMarkerForRow(container, targetRow, after);
            } else {
                placeMarkerNearElement(targetRow, after);
            }
            return;
        }

        placeButtonMarkerAtEnd(container);
    }

    function addUniqueContainer(containers, containerInfo) {
        var i;
        if (!containerInfo || !containerInfo.key) {
            return;
        }
        for (i = 0; i < containers.length; i++) {
            if (containers[i].key === containerInfo.key) {
                return;
            }
        }
        containers.push(containerInfo);
    }

    function makeQuickDropContainer() {
        return {
            type: 'quick',
            key: 'quick'
        };
    }

    function makeGroupBodyDropContainer(groupId) {
        if (!groupId) {
            return null;
        }
        return {
            type: 'groupBody',
            groupId: groupId,
            key: 'groupBody:' + groupId
        };
    }

    function getDropAnimationContainers(target, buttonDrag, groupDrag) {
        var containers = [];
        addUniqueContainer(containers, makeQuickDropContainer());
        if (target && target.type === 'button' && buttonDrag) {
            addUniqueContainer(containers, makeGroupBodyDropContainer(buttonDrag.groupId));
            addUniqueContainer(containers, makeGroupBodyDropContainer(target.groupId));
        }
        if (target && target.type === 'group' && groupDrag) {
            addUniqueContainer(containers, makeQuickDropContainer());
        }
        return containers;
    }

    function renderWithDropAnimation(target, buttonDrag, groupDrag, changeFn) {
        var containers = getDropAnimationContainers(target, buttonDrag, groupDrag);
        if (!containers.length) {
            changeFn();
            return;
        }
        animateDirectChildLayout(containers, changeFn);
    }

    function placeMarkerNearElement(element, after) {
        var rect;
        if (!element) {
            return;
        }
        try {
            rect = element.getBoundingClientRect();
            showOverlayMarkerForRect(rect, after ? (rect.bottom - 4) : (rect.top - 4));
        } catch (ex) {}
    }

    function placeMarkerAtEnd(container) {
        var rect;
        var children;
        var child;
        var i;
        if (!container) {
            return;
        }
        try {
            children = container.children || [];
            for (i = children.length - 1; i >= 0; i--) {
                child = children[i];
                if (!child || child.id === 'aft-scan-drop-marker' || child.id === 'aft-scan-drop-placeholder') {
                    continue;
                }
                rect = child.getBoundingClientRect();
                showOverlayMarkerForRect(rect, rect.bottom - 4);
                return;
            }
            rect = container.getBoundingClientRect();
            showOverlayMarkerForRect(rect, rect.top + 6);
        } catch (ex) {}
    }

    function placeButtonMarkerAtEnd(container) {
        var children;
        var child;
        var i;
        if (!container) {
            return;
        }
        if (!isHorizontalButtonLayout(container)) {
            placeMarkerAtEnd(container);
            return;
        }
        try {
            children = container.children || [];
            for (i = children.length - 1; i >= 0; i--) {
                child = children[i];
                if (!isButtonRowElement(child)) {
                    continue;
                }
                showVerticalMarkerForRow(container, child, true);
                return;
            }
            placeMarkerAtEnd(container);
        } catch (e) {
            placeMarkerAtEnd(container);
        }
    }

    function showButtonDropMarker(e, row, targetGroupId, targetButtonId) {
        var after;
        var nextTarget;
        if (!dragData || groupDragData) {
            return true;
        }
        setDropEffect(e);
        after = shouldInsertAfter(e, row);
        nextTarget = {
            type: 'button',
            groupId: targetGroupId,
            buttonId: targetButtonId,
            after: after
        };
        if (isSameDropTarget(nextTarget)) {
            return false;
        }
        showButtonInsertionMarker(row.parentNode, targetButtonId, after);
        dropTarget = nextTarget;
        return false;
    }

    function showAppendButtonDropMarker(e, groupId, groupWrap, groupBody) {
        var nextTarget;
        var nearest;
        if (!dragData || groupDragData) {
            return true;
        }
        setDropEffect(e);

        if (groupBody && groupBody.style.pointerEvents !== 'none') {
            nearest = findNearestButtonDropAnchor(groupBody, e);
        }

        nextTarget = {
            type: 'button',
            groupId: groupId,
            buttonId: nearest ? nearest.buttonId : null,
            after: nearest ? nearest.after : true
        };
        if (isSameDropTarget(nextTarget)) {
            return false;
        }
        if (nearest && nearest.buttonId) {
            showButtonInsertionMarker(groupBody, nearest.buttonId, nearest.after);
        } else if (groupBody && groupBody.style.pointerEvents !== 'none') {
            showButtonInsertionMarker(groupBody, null, true);
        } else if (groupWrap) {
            placeMarkerAtEnd(groupWrap);
        }
        dropTarget = nextTarget;
        return false;
    }

    function getUngroupedGrid(quickBox) {
        var grid = getCachedElement('aft-scan-ungrouped-grid');
        if (grid && (!quickBox || (quickBox.contains && quickBox.contains(grid)))) {
            return grid;
        }
        try {
            return quickBox && quickBox.querySelector ? quickBox.querySelector('.aft-scan-ungrouped-grid') : null;
        } catch (e) {}
        return null;
    }

    function findTopLevelDropAnchor(e, quickBox) {
        var children = quickBox ? quickBox.children : [];
        var child;
        var cls;
        var rect;
        var lastEligible = null;
        var i;

        for (i = 0; i < children.length; i++) {
            child = children[i];
            if (!child || child.id === 'aft-scan-drop-marker' || child.id === 'aft-scan-drop-placeholder') {
                continue;
            }
            cls = String(child.className || '');
            if (cls.indexOf('aft-scan-group-wrap') === -1 && cls.indexOf('aft-scan-ungrouped-grid') === -1 && cls.indexOf('aft-scan-ungrouped-button-row') === -1) {
                continue;
            }
            lastEligible = child;
            try {
                rect = child.getBoundingClientRect();
                if (e.clientY < rect.top + (rect.height / 2)) {
                    return { element: child, after: false };
                }
            } catch (ex) {}
        }

        return { element: lastEligible, after: true };
    }

    function placeUngroupedGroupNear(anchorGroupId, insertAfterTarget) {
        var ungroupedIndex;
        var targetIndex;
        var movingGroup;
        var insertIndex;

        if (!anchorGroupId || anchorGroupId === UNGROUPED_GROUP_ID) {
            return;
        }

        ensureUngroupedGroup();
        ungroupedIndex = findGroupIndex(UNGROUPED_GROUP_ID);
        targetIndex = findGroupIndex(anchorGroupId);
        if (ungroupedIndex < 0 || targetIndex < 0) {
            return;
        }

        movingGroup = scanGroups.splice(ungroupedIndex, 1)[0];
        targetIndex = findGroupIndex(anchorGroupId);
        insertIndex = targetIndex + (insertAfterTarget ? 1 : 0);
        if (insertIndex < 0) {
            insertIndex = 0;
        }
        if (insertIndex > scanGroups.length) {
            insertIndex = scanGroups.length;
        }
        scanGroups.splice(insertIndex, 0, movingGroup);
    }

    function showUngroupedDropMarker(e, quickBox) {
        var anchor;
        var anchorGroupId = '';
        var nextTarget;
        var grid;
        var nearest;
        var anchorClass;
        if (!dragData || groupDragData || !quickBox) {
            return true;
        }
        setDropEffect(e);
        grid = getUngroupedGrid(quickBox);

        if (grid && (grid === e.target || (grid.contains && grid.contains(e.target)))) {
            nearest = findNearestButtonDropAnchor(grid, e);
            nextTarget = {
                type: 'button',
                groupId: UNGROUPED_GROUP_ID,
                buttonId: nearest ? nearest.buttonId : null,
                after: nearest ? nearest.after : true,
                anchorGroupId: '',
                anchorAfter: true
            };
            if (isSameDropTarget(nextTarget)) {
                return false;
            }
            showButtonInsertionMarker(grid, nextTarget.buttonId, nextTarget.after);
            dropTarget = nextTarget;
            return false;
        }

        anchor = findTopLevelDropAnchor(e, quickBox);
        anchorClass = String(anchor.element ? anchor.element.className || '' : '');

        if (anchor.element && anchorClass.indexOf('aft-scan-group-wrap') !== -1) {
            anchorGroupId = anchor.element.getAttribute('data-group-id') || '';
        } else if (anchor.element && anchorClass.indexOf('aft-scan-ungrouped-grid') !== -1) {
            nearest = findNearestButtonDropAnchor(anchor.element, e);
        }

        nextTarget = {
            type: 'button',
            groupId: UNGROUPED_GROUP_ID,
            buttonId: nearest ? nearest.buttonId : null,
            after: nearest ? nearest.after : true,
            anchorGroupId: anchorGroupId,
            anchorAfter: anchor.after === true
        };
        if (isSameDropTarget(nextTarget)) {
            return false;
        }

        if (anchor.element && anchorClass.indexOf('aft-scan-ungrouped-grid') !== -1) {
            showButtonInsertionMarker(anchor.element, nextTarget.buttonId, nextTarget.after);
        } else if (anchor.element && anchorClass.indexOf('aft-scan-ungrouped-button-row') !== -1) {
            showButtonInsertionMarker(quickBox, anchor.element.getAttribute('data-button-id') || null, anchor.after);
        } else if (anchor.element) {
            placeMarkerNearElement(anchor.element, anchor.after);
        } else {
            showButtonInsertionMarker(quickBox, null, true);
        }

        dropTarget = nextTarget;
        return false;
    }

    function showGroupDropMarker(e, groupWrap, targetGroupId) {
        var anchor;
        var after;
        var nextTarget;
        var quickBox;
        if (!groupDragData || dragData) {
            return true;
        }
        setDropEffect(e);
        quickBox = getCachedElement('aft-scan-quick-buttons') || (groupWrap ? groupWrap.parentNode : null);
        anchor = findNearestGroupDropAnchor(quickBox, e);
        if (anchor) {
            groupWrap = anchor.element;
            targetGroupId = anchor.groupId;
            after = anchor.after;
        } else {
            after = shouldInsertAfterGroup(e, groupWrap);
        }
        nextTarget = {
            type: 'group',
            groupId: targetGroupId,
            after: after
        };
        if (isSameDropTarget(nextTarget)) {
            return false;
        }
        placeMarkerNearElement(groupWrap, after);
        dropTarget = nextTarget;
        return false;
    }

    function findEdgeGroupWrap(quickBox, after) {
        var groups;
        var i;
        var index;
        var groupId;

        if (!quickBox || !quickBox.querySelectorAll) {
            return null;
        }

        groups = quickBox.querySelectorAll('.aft-scan-group-wrap');
        if (!groups || !groups.length) {
            return null;
        }

        for (i = 0; i < groups.length; i++) {
            index = after ? (groups.length - 1 - i) : i;
            groupId = groups[index].getAttribute ? groups[index].getAttribute('data-group-id') : '';
            if (groupId && groupId !== UNGROUPED_GROUP_ID) {
                return groups[index];
            }
        }
        return null;
    }

    function findEdgeButtonRow(container, after) {
        var children;
        var i;
        var index;

        if (!container) {
            return null;
        }

        children = container.children || [];
        for (i = 0; i < children.length; i++) {
            index = after ? (children.length - 1 - i) : i;
            if (isButtonRowElement(children[index])) {
                return children[index];
            }
        }
        return null;
    }

    function getButtonEdgeContainer(groupId) {
        var quickBox;
        if (groupId === UNGROUPED_GROUP_ID) {
            quickBox = getCachedElement('aft-scan-quick-buttons');
            return getUngroupedGrid(quickBox);
        }
        try {
            return document.querySelector('[data-group-body-id="' + groupId + '"]');
        } catch (e) {}
        return null;
    }

    function showEdgeGroupDropMarker(e, quickBox, after) {
        var groupWrap;
        var targetGroupId;
        var nextTarget;

        if (!groupDragData || dragData) {
            return true;
        }

        groupWrap = findEdgeGroupWrap(quickBox, after);
        if (!groupWrap) {
            return true;
        }

        targetGroupId = groupWrap.getAttribute('data-group-id') || '';
        nextTarget = {
            type: 'group',
            groupId: targetGroupId,
            after: after
        };
        if (isSameDropTarget(nextTarget)) {
            setDropEffect(e);
            return false;
        }

        setDropEffect(e);
        placeMarkerNearElement(groupWrap, after);
        dropTarget = nextTarget;
        return false;
    }

    function showEdgeButtonDropMarker(e, after) {
        var container;
        var row;
        var nextTarget;

        if (!dragData || groupDragData) {
            return true;
        }

        container = getButtonEdgeContainer(dragData.groupId);
        if (!container) {
            return true;
        }

        row = findEdgeButtonRow(container, after);
        nextTarget = {
            type: 'button',
            groupId: dragData.groupId,
            buttonId: row ? (row.getAttribute('data-button-id') || null) : null,
            after: after
        };
        if (isSameDropTarget(nextTarget)) {
            setDropEffect(e);
            return false;
        }

        setDropEffect(e);
        showButtonInsertionMarker(container, nextTarget.buttonId, after);
        dropTarget = nextTarget;
        return false;
    }

    function showForgivingEdgeDropMarker(e) {
        var quickBox;
        var rect;
        var after;
        var edgeSize;
        var nearTop;
        var nearBottom;

        if ((!dragData && !groupDragData) || !e) {
            return true;
        }

        quickBox = getCachedElement('aft-scan-quick-buttons');
        if (!quickBox) {
            return true;
        }

        try {
            rect = quickBox.getBoundingClientRect();
        } catch (ex) {
            rect = null;
        }
        if (!rect) {
            return true;
        }

        edgeSize = Math.min(110, Math.max(56, rect.height * 0.18));
        nearTop = e.clientY <= rect.top + edgeSize || e.clientY <= 28;
        nearBottom = e.clientY >= rect.bottom - edgeSize || e.clientY >= window.innerHeight - 28;

        if (!nearTop && !nearBottom) {
            return true;
        }

        after = nearBottom && !nearTop;
        try {
            quickBox.scrollTop = after ? quickBox.scrollHeight : 0;
        } catch (e1) {}

        if (groupDragData && !dragData) {
            return showEdgeGroupDropMarker(e, quickBox, after);
        }
        if (dragData && !groupDragData) {
            return showEdgeButtonDropMarker(e, after);
        }
        return true;
    }

    function handleDocumentDragOver(e) {
        if (!dragData && !groupDragData) {
            return true;
        }
        if (getClosestWithClass(e.target, 'aft-scan-group-wrap') ||
                getClosestWithClass(e.target, 'aft-scan-ungrouped-grid')) {
            return true;
        }
        return showForgivingEdgeDropMarker(e);
    }

    function handleDocumentDrop(e) {
        if (!dragData && !groupDragData) {
            return true;
        }
        if (getClosestWithClass(e.target, 'aft-scan-group-wrap') ||
                getClosestWithClass(e.target, 'aft-scan-ungrouped-grid')) {
            return true;
        }
        showForgivingEdgeDropMarker(e);
        if (dropTarget) {
            return performDropTarget(e);
        }
        return true;
    }

    function performDropTarget(e) {
        var currentTarget = dropTarget;
        var currentDragData = dragData;
        var currentGroupDragData = groupDragData;

        if (e) {
            stopEvent(e);
        }

        if (currentTarget && currentTarget.type === 'group' && currentGroupDragData) {
            renderWithDropAnimation(currentTarget, null, currentGroupDragData, function () {
                moveGroup(currentGroupDragData.groupId, currentTarget.groupId, currentTarget.after, true);
                updateGroupSelect();
                renderGroups();
            });
        } else if (currentTarget && currentTarget.type === 'button' && currentDragData) {
            renderWithDropAnimation(currentTarget, currentDragData, null, function () {
                var anchorGroupId = currentTarget.anchorGroupId;
                var anchorAfter = currentTarget.anchorAfter;
                moveButton(currentDragData.groupId, currentDragData.buttonId, currentTarget.groupId, currentTarget.buttonId, currentTarget.after, true);
                if (currentTarget.groupId === UNGROUPED_GROUP_ID && anchorGroupId) {
                    placeUngroupedGroupNear(anchorGroupId, anchorAfter);
                    saveGroups();
                }
                updateGroupSelect();
                renderGroups();
            });
        } else {
            dragData = null;
            groupDragData = null;
            clearDropMarker();
            return false;
        }

        window.setTimeout(function () {
            if (currentDragData === dragData) {
                dragData = null;
            }
            if (currentGroupDragData === groupDragData) {
                groupDragData = null;
            }
        }, 0);

        clearDropMarker();
        return false;
    }

    function toggleGroupCollapsed(groupId) {
        var groupIndex = findGroupIndex(groupId);
        var group;
        var body;
        var toggleBtn;
        var willCollapse;

        if (groupIndex < 0) {
            return;
        }

        group = scanGroups[groupIndex];
        body = document.querySelector('[data-group-body-id="' + groupId + '"]');
        if (body && body.__aftAnimating) {
            return;
        }

        willCollapse = !group.collapsed;
        group.collapsed = willCollapse;
        saveGroups();

        toggleBtn = document.querySelector('[data-group-toggle-id="' + groupId + '"]');
        setGroupToggleIcon(toggleBtn, willCollapse);

        if (!body) {
            renderGroups();
            return;
        }

        animateGroupBodyVisibility(body, willCollapse);
    }

    function animateGroupBodyVisibility(body, collapsed) {
        var fullHeight;
        if (!body) {
            return;
        }

        body.style.overflow = 'hidden';
        body.style.willChange = 'max-height, opacity, padding';
        body.style.transition = 'max-height ' + UI_ANIMATION_MS + 'ms ' + UI_ANIMATION_EASING + ', opacity 240ms ease, padding 260ms ease';

        if (collapsed) {
            fullHeight = getAnimatedHeight(body);
            body.style.maxHeight = fullHeight + 'px';
            body.style.opacity = '1';
            body.style.padding = '12px';
            body.style.pointerEvents = 'auto';
            body.offsetHeight;
            body.style.maxHeight = '0px';
            body.style.opacity = '0';
            body.style.padding = '0 12px';
            lockAnimation(body, true, function () {
                if (body) {
                    body.style.pointerEvents = 'none';
                    body.style.willChange = '';
                }
            });
        } else {
            body.style.maxHeight = '0px';
            body.style.opacity = '0';
            body.style.padding = '0 12px';
            body.style.pointerEvents = 'auto';
            body.offsetHeight;
            fullHeight = measureExpandedHeight(body, '12px') || 800;
            body.style.padding = '12px';
            body.style.maxHeight = fullHeight + 'px';
            body.style.opacity = '1';
            lockAnimation(body, false, function () {
                if (body && body.style.pointerEvents !== 'none') {
                    body.style.maxHeight = 'none';
                    body.style.willChange = '';
                }
            });
        }
    }
    function closeAftEditDialog() {
        var overlay = getCachedElement('aft-script-dialog-overlay');
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        delete cachedElements['aft-script-dialog-overlay'];
    }

    function createAftEditDialog(titleText, messageText) {
        var overlay;
        var card;
        var title;
        var message;
        var fields;
        var actions;
        var host = getCachedElement('aft-scan-buttons-panel') || document.body;
        closeAftEditDialog();
        overlay = document.createElement('div');
        overlay.id = 'aft-script-dialog-overlay';
        overlay.className = 'aft-script-dialog-overlay';
        overlay.setAttribute('role', 'presentation');
        card = document.createElement('div');
        card.className = 'aft-script-dialog';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        title = document.createElement('div');
        title.className = 'aft-script-dialog-title';
        title.textContent = titleText;
        card.setAttribute('aria-label', titleText);
        card.appendChild(title);
        if (messageText) {
            message = document.createElement('div');
            message.className = 'aft-script-dialog-message';
            message.textContent = messageText;
            card.appendChild(message);
        }
        fields = document.createElement('div');
        fields.className = 'aft-script-dialog-fields';
        actions = document.createElement('div');
        actions.className = 'aft-script-dialog-actions';
        card.appendChild(fields);
        card.appendChild(actions);
        overlay.appendChild(card);
        overlay.addEventListener('mousedown', function (event) {
            if (event.target === overlay) {
                closeAftEditDialog();
            }
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                stopEvent(event);
                closeAftEditDialog();
            }
        });
        overlay.addEventListener('keypress', function (event) {
            event.stopPropagation();
        });
        overlay.addEventListener('keyup', function (event) {
            event.stopPropagation();
        });
        host.appendChild(overlay);
        cachedElements[overlay.id] = overlay;
        return { overlay: overlay, card: card, fields: fields, actions: actions };
    }

    function addAftDialogButton(actions, label, className, handler) {
        var button = makeButton(label, label, handler);
        button.className += ' aft-script-dialog-button ' + className;
        actions.appendChild(button);
        return button;
    }

    function openAftRenameDialog(titleText, fieldDefinitions, onSave) {
        var dialog = createAftEditDialog(titleText, '');
        var inputs = [];
        var form = document.createElement('form');
        var field;
        var label;
        var input;
        var i;

        form.className = 'aft-script-dialog-form';
        for (i = 0; i < fieldDefinitions.length; i++) {
            field = document.createElement('label');
            field.className = 'aft-script-dialog-field';
            label = document.createElement('span');
            label.textContent = fieldDefinitions[i].label;
            input = document.createElement('input');
            input.type = 'text';
            input.value = fieldDefinitions[i].value;
            input.autocomplete = 'off';
            input.setAttribute('aria-label', fieldDefinitions[i].label);
            field.appendChild(label);
            field.appendChild(input);
            form.appendChild(field);
            inputs.push(input);
        }
        dialog.fields.appendChild(form);

        function saveDialog(event) {
            var values = [];
            if (event) {
                stopEvent(event);
            }
            for (var index = 0; index < inputs.length; index++) {
                values.push(trimText(inputs[index].value));
            }
            if (onSave(values) === false) {
                return false;
            }
            closeAftEditDialog();
            return false;
        }

        form.addEventListener('submit', saveDialog);
        addAftDialogButton(dialog.actions, 'Anuluj', 'aft-script-dialog-cancel', closeAftEditDialog);
        addAftDialogButton(dialog.actions, 'Zapisz', 'aft-script-dialog-primary', saveDialog);
        window.setTimeout(function () {
            if (inputs[0]) {
                inputs[0].focus();
                inputs[0].select();
            }
        }, 0);
    }

    function closeDropZoneContextMenu() {
        var menu = getCachedElement('aft-dropzone-context-menu');
        if (!menu) {
            return;
        }
        document.removeEventListener('mousedown', menu.__aftOutsidePointerHandler, true);
        document.removeEventListener('keydown', menu.__aftEscapeHandler, true);
        window.removeEventListener('resize', menu.__aftViewportHandler, false);
        window.removeEventListener('scroll', menu.__aftViewportHandler, true);
        if (menu.parentNode) {
            menu.parentNode.removeChild(menu);
        }
        delete cachedElements['aft-dropzone-context-menu'];
    }

    function findRenderedDropZoneRow(buttonId) {
        var rows = document.querySelectorAll('.aft-scan-button-row[data-button-id]');
        var i;
        for (i = 0; i < rows.length; i++) {
            if (rows[i].getAttribute('data-button-id') === buttonId) {
                return rows[i];
            }
        }
        return null;
    }

    function animateDuplicatedDropZone(sourceButtonId, duplicateButtonId) {
        var sourceRow = findRenderedDropZoneRow(sourceButtonId);
        var duplicateRow = findRenderedDropZoneRow(duplicateButtonId);
        if (!sourceRow || !duplicateRow) {
            return;
        }
        sourceRow.classList.add('aft-dropzone-duplicate-source');
        duplicateRow.classList.add('aft-dropzone-duplicate-copy');
        window.setTimeout(function () {
            sourceRow.classList.remove('aft-dropzone-duplicate-source');
            duplicateRow.classList.remove('aft-dropzone-duplicate-copy');
        }, 760);
    }

    function duplicateDropZone(groupId, buttonId) {
        var groupIndex = findGroupIndex(groupId);
        var group;
        var buttonIndex;
        var original;
        var duplicateButtonId;
        if (groupIndex < 0) {
            return false;
        }
        group = scanGroups[groupIndex];
        buttonIndex = findButtonIndex(group, buttonId);
        if (buttonIndex < 0) {
            return false;
        }
        original = group.buttons[buttonIndex];
        duplicateButtonId = makeId('btn');
        group.buttons.splice(buttonIndex + 1, 0, {
            id: duplicateButtonId,
            label: trimText(original.label || original.text),
            text: trimText(original.text || original.label)
        });
        activeGroupId = groupId;
        saveActiveGroup();
        saveGroups();
        updateGroupSelect();
        renderGroups();
        animateDuplicatedDropZone(buttonId, duplicateButtonId);
        return true;
    }

    function openDropZoneContextMenu(event, groupId, buttonId) {
        var menu;
        var action;
        var icon;
        var label;
        var rect;
        var viewportWidth;
        var viewportHeight;
        var left;
        var top;
        stopEvent(event);
        closeDropZoneContextMenu();
        menu = document.createElement('div');
        menu.id = 'aft-dropzone-context-menu';
        menu.className = 'aft-dropzone-context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Menu Drop-Zone');
        action = document.createElement('button');
        action.type = 'button';
        action.className = 'aft-dropzone-context-menu-action';
        action.setAttribute('role', 'menuitem');
        action.title = 'Duplikuj Drop-Zone';
        icon = document.createElement('span');
        icon.className = 'aft-dropzone-context-menu-icon';
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg>';
        label = document.createElement('span');
        label.textContent = 'Duplikuj Drop-Zone';
        action.appendChild(icon);
        action.appendChild(label);
        action.addEventListener('click', function (clickEvent) {
            stopEvent(clickEvent);
            closeDropZoneContextMenu();
            duplicateDropZone(groupId, buttonId);
        });
        menu.appendChild(action);
        menu.addEventListener('contextmenu', stopEvent);
        menu.__aftOutsidePointerHandler = function (pointerEvent) {
            if (!menu.contains(pointerEvent.target)) {
                closeDropZoneContextMenu();
            }
        };
        menu.__aftEscapeHandler = function (keyEvent) {
            if (keyEvent.key === 'Escape' || keyEvent.keyCode === 27) {
                stopEvent(keyEvent);
                closeDropZoneContextMenu();
            }
        };
        menu.__aftViewportHandler = closeDropZoneContextMenu;
        document.body.appendChild(menu);
        cachedElements[menu.id] = menu;
        rect = menu.getBoundingClientRect();
        viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.width + 16;
        viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.height + 16;
        left = Math.max(8, Math.min(Number(event.clientX) || 0, viewportWidth - rect.width - 8));
        top = Math.max(8, Math.min(Number(event.clientY) || 0, viewportHeight - rect.height - 8));
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        document.addEventListener('mousedown', menu.__aftOutsidePointerHandler, true);
        document.addEventListener('keydown', menu.__aftEscapeHandler, true);
        window.addEventListener('resize', menu.__aftViewportHandler, false);
        window.addEventListener('scroll', menu.__aftViewportHandler, true);
        window.setTimeout(function () {
            if (menu.parentNode) {
                action.focus();
            }
        }, 0);
    }

    function installDropZoneContextMenu(button, groupId, buttonId) {
        button.addEventListener('contextmenu', function (event) {
            openDropZoneContextMenu(event, groupId, buttonId);
        });
    }

    function renderUngroupedButtons(box, group) {
        var grid;

        if (!group) {
            group = ensureUngroupedGroup();
        }
        if (!group.buttons) {
            group.buttons = [];
        }
        if (!group.buttons.length) {
            return;
        }

        grid = document.createElement('div');
        grid.id = 'aft-scan-ungrouped-grid';
        cachedElements[grid.id] = grid;
        grid.className = 'aft-scan-ungrouped-grid';
        grid.setAttribute('data-group-body-id', UNGROUPED_GROUP_ID);
        grid.style.display = 'flex';
        grid.style.flexWrap = 'wrap';
        grid.style.gap = '10px';
        grid.style.boxSizing = 'border-box';
        grid.style.margin = '14px 0 14px 0';
        grid.style.padding = '0 12px';

        for (var b = 0; b < group.buttons.length; b++) {
            (function (buttonIndex) {
                var item = group.buttons[buttonIndex];
                var scanText = trimText(item.text || item.label || '');
                var buttonLabel = trimText(item.label || item.text || '');
                var row = document.createElement('div');
                row.className = 'aft-scan-button-row aft-scan-ungrouped-button-row' +
                    (item.id === activeAgeButtonId ? ' aft-scan-button-active' : '');
                row.setAttribute('data-button-id', item.id);
                row.setAttribute('data-drop-zone-text', scanText);
                row.draggable = true;
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '3px';
                row.style.marginTop = '3px';
                row.style.borderRadius = '5px';
                row.style.transition = 'transform 120ms ease, opacity 120ms ease';

                row.addEventListener('dragstart', function (e) {
                    onDragStart(e, UNGROUPED_GROUP_ID, item.id);
                    row.style.opacity = '0.45';
                });
                row.addEventListener('dragend', function () {
                    row.style.opacity = '1';
                    dragData = null;
                    groupDragData = null;
                    clearDropMarker();
                });
                row.addEventListener('dragover', function (e) {
                    showButtonDropMarker(e, row, UNGROUPED_GROUP_ID, item.id);
                    return false;
                });
                row.addEventListener('drop', function (e) {
                    showButtonDropMarker(e, row, UNGROUPED_GROUP_ID, item.id);
                    return performDropTarget(e);
                });

                var dragHandle = document.createElement('div');
                dragHandle.textContent = '\u2630';
                dragHandle.title = 'Przeci\u0105gnij, aby zmieni\u0107 kolejno\u015b\u0107 lub przenie\u015b\u0107 do innej grupy';
                dragHandle.style.flex = '0 0 auto';
                dragHandle.style.width = '18px';
                dragHandle.style.textAlign = 'center';
                dragHandle.style.color = '#aaa';
                dragHandle.style.cursor = 'default';
                dragHandle.style.userSelect = 'none';

                var scanBtn = makeButton(buttonLabel, 'Skanuj: ' + scanText, function () {
                    animateDropZoneButtonClick(row);
                    activateAgeDropZone(item.id, scanText, buttonLabel);
                    submitScanSilently(scanText);
                });
                scanBtn.draggable = true;
                scanBtn.style.flex = '1';
                scanBtn.style.overflow = 'hidden';
                scanBtn.style.textOverflow = 'ellipsis';
                scanBtn.style.whiteSpace = 'nowrap';
                scanBtn.style.minHeight = '24px';
                enableDropZonePointerDrag(scanBtn, row, UNGROUPED_GROUP_ID, item.id);
                installDropZoneContextMenu(scanBtn, UNGROUPED_GROUP_ID, item.id);

                var editBtn = makeButton('\u270E', 'Edytuj nazw\u0119 Drop-Zone i tekst skanu', function () {
                    editButton(UNGROUPED_GROUP_ID, item.id);
                });
                styleSmallIconButton(editBtn);

                var matrixBtn = makeButton('', 'Poka\u017c kod DataMatrix', function () {
                    showDataMatrixModal(scanText, buttonLabel);
                });
                matrixBtn.draggable = false;
                styleSmallIconButton(matrixBtn);
                setDataMatrixButtonIcon(matrixBtn);

                var delBtn = makeButton('\u00D7', 'Usu\u0144 Drop-Zone', function () {
                    confirmDeleteDropZoneButton(UNGROUPED_GROUP_ID, item.id, delBtn, row);
                });
                styleSmallIconButton(delBtn);
                delBtn.style.color = '#b45a5a';
                dragHandle.style.display = 'none';
                styleDropZoneRow(row, null, scanBtn, editBtn, matrixBtn, delBtn, true);
                applyDropZoneRowLength(row, scanBtn, buttonLabel);

                row.appendChild(scanBtn);
                row.appendChild(createDropZoneActionArea(row, [matrixBtn, editBtn, delBtn]));
                grid.appendChild(row);
            }(b));
        }

        box.appendChild(grid);
    }

    function renderGroups() {
        var box = getCachedElement('aft-scan-quick-buttons');
        var fragment;
        if (!box) {
            return;
        }
        closeDropZoneContextMenu();
        resetPendingDropZoneDelete();
        fragment = document.createDocumentFragment();

        if (!scanGroups.length) {
            ensureAtLeastOneGroup();
        }

        ensureUngroupedGroup();

        for (var g = 0; g < scanGroups.length; g++) {
            (function (groupIndex) {
                var group = scanGroups[groupIndex];

                if (isUngroupedGroup(group)) {
                    renderUngroupedButtons(fragment, group);
                    return;
                }

                var groupWrap = document.createElement('div');
                groupWrap.className = 'aft-scan-group-wrap';
                groupWrap.setAttribute('data-group-id', group.id);
                styleGroupCard(groupWrap, group.color);

                groupWrap.addEventListener('dragover', function (e) {
                    if (groupDragData) {
                        return showGroupDropMarker(e, groupWrap, group.id);
                    }
                    if (dragData && !getClosestWithClass(e.target, 'aft-scan-button-row')) {
                        return showAppendButtonDropMarker(e, group.id, groupWrap, body);
                    }
                    return true;
                });
                groupWrap.addEventListener('drop', function (e) {
                    if (dragData && !groupDragData) {
                        showAppendButtonDropMarker(e, group.id, groupWrap, body);
                    }
                    return performDropTarget(e);
                });

                var header = document.createElement('div');
                var headerDragStarted = false;
                styleGroupHeader(header);
                header.title = 'Kliknij, aby zwin\u0105\u0107 lub rozwin\u0105\u0107. Przeci\u0105gnij, aby zmieni\u0107 kolejno\u015b\u0107 grup.';
                header.draggable = true;
                header.style.cursor = 'pointer';
                header.addEventListener('dragstart', function (e) {
                    headerDragStarted = true;
                    onGroupDragStart(e, group.id);
                    groupWrap.style.opacity = '0.55';
                });
                header.addEventListener('dragend', function () {
                    groupWrap.style.opacity = '1';
                    groupDragData = null;
                    clearDropMarker();
                    window.setTimeout(function () {
                        headerDragStarted = false;
                    }, 160);
                });
                header.addEventListener('click', function (e) {
                    if (headerDragStarted) {
                        stopEvent(e);
                        return false;
                    }
                    stopEvent(e);
                    toggleGroupCollapsed(group.id);
                    return false;
                });

                var groupDragHandle = document.createElement('div');
                groupDragHandle.title = 'Przeci\u0105gnij, aby zmieni\u0107 kolejno\u015b\u0107 grup';
                groupDragHandle.draggable = true;
                styleDragHandle(groupDragHandle, true);
                groupDragHandle.style.display = 'none';
                groupDragHandle.addEventListener('dragstart', function (e) {
                    onGroupDragStart(e, group.id);
                    groupWrap.style.opacity = '0.55';
                });
                groupDragHandle.addEventListener('dragend', function () {
                    groupWrap.style.opacity = '1';
                    groupDragData = null;
                    clearDropMarker();
                });

                var name = document.createElement('div');
                name.className = 'aft-scan-group-name';
                name.textContent = group.name;
                name.title = 'Kliknij, aby zwin\u0105\u0107 lub rozwin\u0105\u0107. U\u017cyj \u270E, aby zmieni\u0107 nazw\u0119.';
                name.style.flex = '1';
                name.style.overflow = 'hidden';
                name.style.textOverflow = 'ellipsis';
                name.style.whiteSpace = 'nowrap';
                name.style.fontWeight = '700';
                name.style.fontSize = '23px';
                name.style.setProperty('color', 'var(--aft-group-accent, #E07B5B)', 'important');
                name.style.textShadow = 'none';
                name.style.cursor = 'pointer';

                var editGroupBtn = makeButton('\u270E', 'Zmie\u0144 nazw\u0119 grupy', function () {
                    editGroupName(group.id);
                });
                editGroupBtn.draggable = false;
                styleSmallIconButton(editGroupBtn);

                var colorGroupBtn = makeButton('', 'Kolor grupy', function (e) {
                    openGroupColorPicker(group.id, colorGroupBtn);
                });
                colorGroupBtn.draggable = false;
                styleSmallIconButton(colorGroupBtn);
                styleGroupColorButton(colorGroupBtn, group.color);
                colorGroupBtn.addEventListener('contextmenu', function (e) {
                    stopEvent(e);
                    setGroupColor(group.id, '');
                    return false;
                });

                var delGroupBtn = makeButton('\u00D7', 'Usu\u0144 grup\u0119', function () {
                    deleteGroup(group.id);
                });
                delGroupBtn.draggable = false;
                styleSmallIconButton(delGroupBtn);
                delGroupBtn.style.color = '#ffb4b4';

                header.appendChild(name);
                header.appendChild(colorGroupBtn);
                header.appendChild(editGroupBtn);
                header.appendChild(delGroupBtn);
                groupWrap.appendChild(header);

                var body = document.createElement('div');
                body.className = 'aft-scan-group-body';
                body.setAttribute('data-group-body-id', group.id);
                body.style.overflow = 'hidden';
                body.style.transition = 'max-height ' + UI_ANIMATION_MS + 'ms ' + UI_ANIMATION_EASING + ', opacity 240ms ease, padding 260ms ease';
                body.style.maxHeight = group.collapsed ? '0px' : 'none';
                body.style.opacity = group.collapsed ? '0' : '1';
                body.style.pointerEvents = group.collapsed ? 'none' : 'auto';
                body.style.display = 'flex';
                body.style.flexWrap = 'wrap';
                body.style.gap = '10px';
                body.style.padding = group.collapsed ? '0 12px' : '12px';
                body.style.boxSizing = 'border-box';

                if (!group.buttons.length) {
                    var empty = document.createElement('div');
                    empty.className = 'aft-scan-empty-group';
                    empty.textContent = 'Upu\u015b\u0107 Drop-Zony tutaj';
                    empty.style.color = '#789078';
                    empty.style.fontSize = '13px';
                    empty.style.padding = '14px 12px';
                    empty.style.border = '1px dashed #aac5aa';
                    empty.style.borderRadius = '12px';
                    empty.style.background = '#f7fbf7';
                    body.appendChild(empty);
                }

                for (var b = 0; b < group.buttons.length; b++) {
                    (function (buttonIndex) {
                        var item = group.buttons[buttonIndex];
                        var scanText = trimText(item.text || item.label || '');
                        var buttonLabel = trimText(item.label || item.text || '');
                        var row = document.createElement('div');
                        row.className = 'aft-scan-button-row' +
                            (item.id === activeAgeButtonId ? ' aft-scan-button-active' : '');
                        row.setAttribute('data-button-id', item.id);
                        row.setAttribute('data-drop-zone-text', scanText);
                        row.draggable = true;
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.gap = '3px';
                        row.style.marginTop = '3px';
                        row.style.borderRadius = '5px';
                        row.style.transition = 'transform 120ms ease, opacity 120ms ease';

                        row.addEventListener('dragstart', function (e) {
                            onDragStart(e, group.id, item.id);
                            row.style.opacity = '0.45';
                        });
                        row.addEventListener('dragend', function () {
                            row.style.opacity = '1';
                            dragData = null;
                            groupDragData = null;
                            clearDropMarker();
                        });
                        row.addEventListener('dragover', function (e) {
                            if (groupDragData) {
                                return true;
                            }
                            showButtonDropMarker(e, row, group.id, item.id);
                            return false;
                        });
                        row.addEventListener('drop', function (e) {
                            if (groupDragData) {
                                return true;
                            }
                            showButtonDropMarker(e, row, group.id, item.id);
                            return performDropTarget(e);
                        });

                        var dragHandle = document.createElement('div');
                        dragHandle.textContent = '\u2630';
                        dragHandle.title = 'Przeci\u0105gnij, aby zmieni\u0107 kolejno\u015b\u0107 lub przenie\u015b\u0107 do innej grupy';
                        dragHandle.style.flex = '0 0 auto';
                        dragHandle.style.width = '18px';
                        dragHandle.style.textAlign = 'center';
                        dragHandle.style.color = '#aaa';
                        dragHandle.style.cursor = 'default';
                        dragHandle.style.userSelect = 'none';

                        var scanBtn = makeButton(buttonLabel, 'Skanuj: ' + scanText, function () {
                            animateDropZoneButtonClick(row);
                            activateAgeDropZone(item.id, scanText, buttonLabel);
                            submitScanSilently(scanText);
                        });
                        scanBtn.draggable = true;
                        scanBtn.style.flex = '1';
                        scanBtn.style.overflow = 'hidden';
                        scanBtn.style.textOverflow = 'ellipsis';
                        scanBtn.style.whiteSpace = 'nowrap';
                        scanBtn.style.minHeight = '24px';
                        enableDropZonePointerDrag(scanBtn, row, group.id, item.id);
                        installDropZoneContextMenu(scanBtn, group.id, item.id);

                        var editBtn = makeButton('\u270E', 'Edytuj nazw\u0119 Drop-Zone i tekst skanu', function () {
                            editButton(group.id, item.id);
                        });
                        styleSmallIconButton(editBtn);

                        var matrixBtn = makeButton('', 'Poka\u017c kod DataMatrix', function () {
                            showDataMatrixModal(scanText, buttonLabel);
                        });
                        matrixBtn.draggable = false;
                        styleSmallIconButton(matrixBtn);
                        setDataMatrixButtonIcon(matrixBtn);

                        var delBtn = makeButton('\u00D7', 'Usu\u0144 Drop-Zone', function () {
                            confirmDeleteDropZoneButton(group.id, item.id, delBtn, row);
                        });
                        styleSmallIconButton(delBtn);
                        delBtn.style.color = '#b45a5a';
                        dragHandle.style.display = 'none';
                        styleDropZoneRow(row, null, scanBtn, editBtn, matrixBtn, delBtn, false);
                        applyDropZoneRowLength(row, scanBtn, buttonLabel);

                        row.appendChild(scanBtn);
                        row.appendChild(createDropZoneActionArea(row, [matrixBtn, editBtn, delBtn]));
                        body.appendChild(row);
                    }(b));
                }

                groupWrap.appendChild(body);
                fragment.appendChild(groupWrap);
            }(g));
        }

        box.textContent = '';
        box.appendChild(fragment);
        updateActiveAgeDropZoneRows();
        updateDropZoneGridLayouts();
        queueLayoutUpdate();
    }

    function editGroupName(groupId) {
        var index = findGroupIndex(groupId);
        var currentName;

        if (index < 0 || groupId === UNGROUPED_GROUP_ID) {
            return;
        }

        currentName = scanGroups[index].name || '';
        openAftRenameDialog('Zmie\u0144 nazw\u0119 grupy', [
            { label: 'Nazwa grupy', value: currentName }
        ], function (values) {
            if (!values[0]) {
                return false;
            }
            scanGroups[index].name = values[0];
            saveGroups();
            updateGroupSelect();
            renderGroups();
            return true;
        });
    }

    function editButton(groupId, buttonId) {
        var groupIndex = findGroupIndex(groupId);
        var buttonIndex;
        var item;
        var currentLabel;
        var currentText;

        if (groupIndex < 0) {
            return;
        }

        buttonIndex = findButtonIndex(scanGroups[groupIndex], buttonId);
        if (buttonIndex < 0) {
            return;
        }

        item = scanGroups[groupIndex].buttons[buttonIndex];
        currentLabel = trimText(item.label || item.text || '');
        currentText = trimText(item.text || item.label || '');

        openAftRenameDialog('Edytuj Drop-Zone', [
            { label: 'Nazwa Drop-Zone', value: currentLabel },
            { label: 'Tekst do zeskanowania', value: currentText }
        ], function (values) {
            if (!values[1]) {
                return false;
            }
            item.label = values[0] || values[1];
            item.text = values[1];
            saveGroups();
            renderGroups();
            return true;
        });
    }

    function deleteGroup(groupId) {
        var index = findGroupIndex(groupId);
        var group;
        var dialog;

        if (index < 0 || groupId === UNGROUPED_GROUP_ID) {
            return;
        }
        if (scanGroups.length <= 1) {
            return;
        }

        group = scanGroups[index];
        dialog = createAftEditDialog(
            'Usun\u0105\u0107 grup\u0119?',
            'Grupa "' + group.name + '" zawiera ' + group.buttons.length + ' Drop-Zon. Usuni\u0119cie tylko grupy zachowa Drop-Zony bez grupy.'
        );
        addAftDialogButton(dialog.actions, 'Anuluj', 'aft-script-dialog-cancel', closeAftEditDialog);
        addAftDialogButton(dialog.actions, 'Tylko grup\u0119', 'aft-script-dialog-primary', function () {
            applyGroupDeletion(groupId, false);
        });
        addAftDialogButton(dialog.actions, 'Grup\u0119 i Drop-Zony', 'aft-script-dialog-danger', function () {
            applyGroupDeletion(groupId, true);
        });
    }

    function applyGroupDeletion(groupId, deleteButtons) {
        var index = findGroupIndex(groupId);
        var removed;
        var targetGroup;
        var i;
        if (index < 0 || groupId === UNGROUPED_GROUP_ID) {
            closeAftEditDialog();
            return;
        }
        removed = scanGroups.splice(index, 1)[0];
        if (!deleteButtons) {
            targetGroup = ensureUngroupedGroup();
            for (i = 0; i < removed.buttons.length; i++) {
                targetGroup.buttons.push(removed.buttons[i]);
            }
        } else {
            targetGroup = scanGroups.length ? scanGroups[0] : ensureUngroupedGroup();
        }
        if (activeGroupId === groupId) {
            activeGroupId = targetGroup.id;
            saveActiveGroup();
        }
        closeAftEditDialog();
        saveGroups();
        updateGroupSelect();
        renderGroups();
    }

    function addQuickButton(text, label, groupId) {
        text = trimText(text);
        label = trimText(label);
        groupId = trimText(groupId) || activeGroupId;
        var groupIndex = findGroupIndex(groupId);
        var targetGroup;

        if (!text || isDefaultSourceScan(text)) {
            return false;
        }

        if (groupId === UNGROUPED_GROUP_ID) {
            targetGroup = ensureUngroupedGroup();
            groupIndex = findGroupIndex(UNGROUPED_GROUP_ID);
        } else {
            if (groupIndex < 0) {
                groupIndex = 0;
                groupId = scanGroups[0].id;
            }
            targetGroup = scanGroups[groupIndex];
        }

        targetGroup.buttons.push({
            id: makeId('btn'),
            label: label || text,
            text: text
        });

        activeGroupId = groupId;
        saveActiveGroup();
        saveGroups();
        updateGroupSelect();
        renderGroups();

        return true;
    }

    function addQuickButtonFromInputs() {
        var textInput = getCachedElement('aft-scan-text-input');
        var labelInput = getCachedElement('aft-scan-label-input');
        var groupSelect = getCachedElement('aft-scan-group-select');
        var added = addQuickButton(
            textInput ? textInput.value : '',
            labelInput ? labelInput.value : '',
            groupSelect ? groupSelect.value : activeGroupId
        );

        if (!added) {
            return false;
        }

        if (textInput) {
            textInput.value = '';
        }
        if (labelInput) {
            labelInput.value = '';
        }
        return true;
    }

    function addGroup(name) {
        name = trimText(name);
        var number;

        if (!name) {
            number = scanGroups.length + 1;
            name = 'Grupa ' + number;
        }

        var group = {
            id: makeId('grp'),
            name: name,
            collapsed: false,
            buttons: []
        };

        scanGroups.push(group);
        activeGroupId = group.id;
        saveActiveGroup();
        saveGroups();
        updateGroupSelect();
        renderGroups();

        return group;
    }

    function addGroupFromInput() {
        var input = getCachedElement('aft-scan-new-group-input');
        var group = addGroup(input ? input.value : '');

        if (input) {
            input.value = '';
        }
        return group;
    }

    function cloneGroupsForExport() {
        var result = [];
        var seenGroups = {};
        var i;
        var b;
        var group;
        var outGroup;
        var btn;

        for (i = 0; i < scanGroups.length; i++) {
            group = scanGroups[i];
            if (!group || seenGroups[group.id]) {
                continue;
            }
            seenGroups[group.id] = true;
            outGroup = {
                id: group.id,
                name: isUngroupedGroup(group) ? '' : trimText(group.name || 'Group'),
                ungrouped: isUngroupedGroup(group),
                collapsed: group.collapsed === true,
                color: isUngroupedGroup(group) ? '' : normalizeHexColor(group.color || ''),
                buttons: []
            };
            for (b = 0; group.buttons && b < group.buttons.length; b++) {
                btn = normalizeButton(group.buttons[b]);
                if (btn) {
                    outGroup.buttons.push({
                        id: btn.id,
                        label: btn.label,
                        text: btn.text
                    });
                }
            }
            result.push(outGroup);
        }
        return result;
    }

    function downloadTextFile(filename, text) {
        var blob;
        var url;
        var a;
        try {
            blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            url = URL.createObjectURL(blob);
            a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 500);
        } catch (e) {
            window.alert('Eksport nie powi\u00f3d\u0142 si\u0119');
        }
    }

    function getDropZoneExportFilename() {
        var usernameElement = getCachedElement('username') || document.getElementById('username');
        var login = trimText(usernameElement && usernameElement.textContent);
        var exportDate = new Date();
        var dateText = exportDate.getFullYear() + '-' +
            ('0' + (exportDate.getMonth() + 1)).slice(-2) + '-' +
            ('0' + exportDate.getDate()).slice(-2);
        login = login.replace(/[^A-Za-z0-9._-]+/g, '_');
        login = login.replace(/^[_\-.]+|[_\-.]+$/g, '');
        return (login ? login + '_' : '') + 'dropzones_' + dateText + '.json';
    }

    function exportDropZones() {
        var data = {
            type: 'AFT Move Container Drop-Zones',
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            groups: cloneGroupsForExport()
        };
        downloadTextFile(getDropZoneExportFilename(), JSON.stringify(data, null, 2));
    }

    function normalizeImportedGroup(source, fallbackName, usedIds) {
        var group = normalizeGroup(source, fallbackName);
        var i;
        var btn;
        var buttonIds = {};

        if (!group) {
            return null;
        }

        if (source && (source.ungrouped === true || source.id === UNGROUPED_GROUP_ID)) {
            group.id = UNGROUPED_GROUP_ID;
            group.name = '';
            group.collapsed = false;
        } else if (!group.name) {
            group.name = fallbackName || 'Group';
        }

        if (group.id !== UNGROUPED_GROUP_ID) {
            if (!group.id || usedIds[group.id]) {
                group.id = makeId('grp');
            }
            usedIds[group.id] = true;
        } else {
            usedIds[UNGROUPED_GROUP_ID] = true;
        }

        for (i = 0; i < group.buttons.length; i++) {
            btn = group.buttons[i];
            if (!btn.id || buttonIds[btn.id]) {
                btn.id = makeId('btn');
            }
            buttonIds[btn.id] = true;
        }

        return group;
    }

    function importDropZonesFromText(text) {
        var parsed;
        var sourceGroups;
        var imported = [];
        var usedGroupIds = {};
        var i;
        var group;
        var hasNormalGroup = false;
        var normalGroupCount = 0;
        var importedButtonCount = 0;

        try {
            parsed = JSON.parse(text);
        } catch (e1) {
            window.alert('Import nie powi\u00f3d\u0142 si\u0119: nieprawid\u0142owy plik JSON.');
            return;
        }

        if (isArray(parsed)) {
            sourceGroups = parsed;
        } else if (parsed && isArray(parsed.groups)) {
            sourceGroups = parsed.groups;
        } else if (parsed && parsed.data && isArray(parsed.data.groups)) {
            sourceGroups = parsed.data.groups;
        } else {
            window.alert('Import nie powi\u00f3d\u0142 si\u0119: w pliku nie znaleziono grup.');
            return;
        }

        for (i = 0; i < sourceGroups.length; i++) {
            group = normalizeImportedGroup(sourceGroups[i], 'Grupa ' + (i + 1), usedGroupIds);
            if (group) {
                if (!isUngroupedGroup(group)) {
                    group.collapsed = false;
                    normalGroupCount++;
                }
                importedButtonCount += group.buttons.length;
                imported.push(group);
                if (!isUngroupedGroup(group)) {
                    hasNormalGroup = true;
                }
            }
        }

        if (!imported.length) {
            window.alert('Import nie powi\u00f3d\u0142 si\u0119: plik nie zawiera Drop-Zon.');
            return;
        }

        if (!window.confirm('Zaimportowa\u0107 Drop-Zony z pliku? Obecne grupy i Drop-Zony zostan\u0105 zast\u0105pione.')) {
            return;
        }

        scanGroups = imported;
        if (!hasNormalGroup && !scanGroups.length) {
            ensureAtLeastOneGroup();
        }

        activeGroupId = hasNormalGroup ? scanGroups[findFirstNormalGroupIndex()].id : UNGROUPED_GROUP_ID;
        saveActiveGroup();
        saveGroups();
        updateGroupSelect();
        renderGroups();
        window.alert('Zaimportowano ' + normalGroupCount + ' grup i ' +
            importedButtonCount + ' Drop-Zon.');
    }

    function findFirstNormalGroupIndex() {
        for (var i = 0; i < scanGroups.length; i++) {
            if (!isUngroupedGroup(scanGroups[i])) {
                return i;
            }
        }
        return 0;
    }

    function importDropZonesFromFile(file) {
        var reader;
        if (!file) {
            return;
        }
        reader = new FileReader();
        reader.onload = function () {
            importDropZonesFromText(String(reader.result || ''));
        };
        reader.onerror = function () {
            window.alert('Import nie powi\u00f3d\u0142 si\u0119: nie mo\u017cna odczyta\u0107 pliku.');
        };
        reader.readAsText(file);
    }
    function getAnimatedHeight(el) {
        var rectHeight = 0;
        try {
            rectHeight = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0;
        } catch (e) {}
        return Math.ceil(Math.max(el.scrollHeight || 0, rectHeight || 0));
    }

    function measureExpandedHeight(el, expandedPadding) {
        var oldTransition;
        var oldMaxHeight;
        var oldPadding;
        var oldOpacity;
        var oldPointerEvents;
        var height;

        if (!el) {
            return 0;
        }

        oldTransition = el.style.transition;
        oldMaxHeight = el.style.maxHeight;
        oldPadding = el.style.padding;
        oldOpacity = el.style.opacity;
        oldPointerEvents = el.style.pointerEvents;

        el.style.transition = 'none';
        el.style.maxHeight = 'none';
        if (typeof expandedPadding === 'string') {
            el.style.padding = expandedPadding;
        }
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
        height = getAnimatedHeight(el);

        el.style.maxHeight = oldMaxHeight;
        el.style.padding = oldPadding;
        el.style.opacity = oldOpacity;
        el.style.pointerEvents = oldPointerEvents;
        el.style.transition = oldTransition;
        el.offsetHeight;

        return height;
    }

    function lockAnimation(el, collapsed, onDone) {
        if (!el) {
            return;
        }
        if (el.__aftAnimationTimer) {
            window.clearTimeout(el.__aftAnimationTimer);
        }
        el.__aftAnimating = true;
        el.__aftAnimationTargetCollapsed = collapsed === true;
        el.__aftAnimationTimer = window.setTimeout(function () {
            el.__aftAnimating = false;
            el.__aftAnimationTimer = null;
            if (typeof onDone === 'function') {
                onDone();
            }
        }, UI_ANIMATION_MS + 50);
    }

    function animateBlockVisibility(el, collapsed) {
        var fullHeight;
        if (!el) {
            return;
        }

        el.style.overflow = 'hidden';
        el.style.willChange = 'max-height, opacity';
        el.style.transition = 'max-height ' + UI_ANIMATION_MS + 'ms ' + UI_ANIMATION_EASING + ', opacity 240ms ease, margin 260ms ease, padding 260ms ease';

        if (collapsed) {
            fullHeight = getAnimatedHeight(el);
            el.style.maxHeight = fullHeight + 'px';
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.offsetHeight;
            el.style.maxHeight = '0px';
            el.style.opacity = '0';
            lockAnimation(el, true, function () {
                if (el) {
                    el.style.pointerEvents = 'none';
                    el.style.willChange = '';
                }
            });
        } else {
            el.style.maxHeight = '0px';
            el.style.opacity = '0';
            el.style.pointerEvents = 'auto';
            el.offsetHeight;
            fullHeight = measureExpandedHeight(el, null) || 800;
            el.style.maxHeight = fullHeight + 'px';
            el.style.opacity = '1';
            lockAnimation(el, false, function () {
                if (el && el.style.pointerEvents !== 'none') {
                    el.style.maxHeight = 'none';
                    el.style.willChange = '';
                }
            });
        }
    }

    function clearAddControlsInputs() {
        var textInput = getCachedElement('aft-scan-text-input');
        var labelInput = getCachedElement('aft-scan-label-input');
        if (textInput) {
            textInput.value = '';
        }
        if (labelInput) {
            labelInput.value = '';
        }
    }

    function setAddControlsVisible(visible, clearInputs) {
        var addControls = getCachedElement('aft-scan-add-controls');
        var newButtonWrap = getCachedElement('aft-scan-new-dropzone-wrap');
        if (!addControls) {
            return;
        }
        if (addControls.__aftAnimating) {
            return;
        }

        if (clearInputs) {
            clearAddControlsInputs();
        }

        if (visible) {
            if (newButtonWrap) {
                newButtonWrap.style.opacity = '0';
                newButtonWrap.style.transform = 'translateY(4px)';
                window.setTimeout(function () {
                    if (newButtonWrap) {
                        newButtonWrap.style.display = 'none';
                    }
                }, 170);
            }
            addControls.style.display = 'block';
            animateBlockVisibility(addControls, false);
            window.setTimeout(function () {
                var textInput = getCachedElement('aft-scan-text-input');
                if (textInput) {
                    try { textInput.focus(); } catch (e) {}
                }
            }, UI_ANIMATION_MS);
            queueLayoutUpdate();
        } else {
            animateBlockVisibility(addControls, true);
            window.setTimeout(function () {
                if (addControls && addControls.style.pointerEvents === 'none') {
                    addControls.style.display = 'none';
                }
                if (newButtonWrap) {
                    newButtonWrap.style.display = 'block';
                    newButtonWrap.offsetHeight;
                    newButtonWrap.style.opacity = '1';
                    newButtonWrap.style.transform = 'translateY(0)';
                }
                queueLayoutUpdate();
            }, UI_ANIMATION_MS + 50);
        }
    }

    function attachUnifiedPanelContent(panel, panelBody) {
        var stepsContainer = document.querySelector('.steps-container');
        var quickBox = getCachedElement('aft-scan-quick-buttons');
        var sourceBadge = ensureCompactAftLayout();

        if (stepsContainer && sourceBadge && sourceBadge.parentNode !== stepsContainer) {
            stepsContainer.insertBefore(sourceBadge, stepsContainer.firstChild);
        }
        if (!panelBody || !stepsContainer || stepsContainer.parentNode === panelBody) {
            return;
        }
        stepsContainer.classList.add('aft-unified-scan-statuses');
        if (quickBox && quickBox.parentNode === panelBody) {
            panelBody.insertBefore(stepsContainer, quickBox);
        } else {
            panelBody.insertBefore(stepsContainer, panelBody.firstChild);
        }
    }

    function attachPanelUnderScanSteps(panel) {
        var quickBox;
        var historyList;
        var historyHeight;
        var panelBody;

        if (!panel || !document.body) {
            return;
        }

        if (panel.parentNode !== document.body) {
            try {
                document.body.appendChild(panel);
            } catch (e1) {}
        }

        panelBody = getCachedElement('aft-scan-panel-body');
        attachUnifiedPanelContent(panel, panelBody);

        panel.style.position = 'fixed';
        panel.style.left = '0';
        panel.style.top = '0';
        panel.style.right = '0';
        panel.style.bottom = '0';
        panel.style.transform = 'none';
        panel.style.zIndex = '2147483646';
        panel.style.width = '100vw';
        panel.style.maxWidth = 'none';
        panel.style.minWidth = '0';
        panel.style.maxHeight = 'none';
        panel.style.overflow = 'hidden';
        panel.style.boxSizing = 'border-box';
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.clear = 'none';
        panel.style.margin = '0';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';

        panel.style.height = '100vh';

        if (panelBody) {
            panelBody.style.flex = '1 1 auto';
            panelBody.style.minHeight = '0';
            panelBody.style.display = 'flex';
            panelBody.style.flexDirection = 'column';
            panelBody.style.maxHeight = 'none';
            panelBody.style.opacity = '1';
            panelBody.style.pointerEvents = 'auto';
        }

        quickBox = getCachedElement('aft-scan-quick-buttons');
        if (quickBox) {
            quickBox.style.flex = '1 1 auto';
            quickBox.style.minHeight = SCAN_GROUPS_MIN_VISIBLE_HEIGHT + 'px';
            quickBox.style.maxHeight = 'none';
        }
        historyList = getCachedElement('aft-scan-history-list');
        if (historyList) {
            historyHeight = parseFloat(historyList.style.height);
            if (!isFinite(historyHeight)) {
                historyHeight = getStoredScanHistoryHeight();
            }
            applyScanHistoryHeight(historyHeight, false);
        }
    }

    function keepPanelUnderScanSteps() {
        var panel = getCachedElement('aft-scan-buttons-panel');
        if (panel) {
            attachPanelUnderScanSteps(panel);
        }
    }

    function alignScanHistoryBoxToGroups() {
        var quickBox = getCachedElement('aft-scan-quick-buttons');
        var historyBox = getCachedElement('aft-scan-history-box');
        var scrollbarWidth;
        if (!quickBox || !historyBox) {
            return;
        }
        scrollbarWidth = Math.max(0, (quickBox.offsetWidth || 0) - (quickBox.clientWidth || 0));
        historyBox.style.marginLeft = '6px';
        historyBox.style.marginRight = (6 + scrollbarWidth) + 'px';
    }

    function resetAftPageFromPanel() {
        dropZoneScanSequence++;
        dropZoneSequenceActive = false;
        suppressLatestAgeDisplay = true;
        updateLatestAgeOverlayPosition();
        clearAftMoveSessionValues();
        clearAftMoveSteps();
        triggerAftResetSession();
        queueAftPageFocusRestore();
        window.setTimeout(autoDefaultSourceScan, DROP_ZONE_STEP_WAIT_MS * 2);
    }

    function isAftWindowInactive() {
        var visible = true;
        var focused = true;
        try {
            visible = document.visibilityState !== 'hidden';
        } catch (e0) {}
        try {
            focused = document.hasFocus();
        } catch (e1) {}
        return !visible || !focused || now() < windowFocusActivationGuardUntil;
    }

    function isWindowFocusIndicatorEnabled() {
        return storageGet(STORAGE_KEY_WINDOW_FOCUS_INDICATOR, '1') !== '0';
    }

    function setWindowFocusIndicatorEnabled(enabled) {
        enabled = enabled !== false;
        storageSet(STORAGE_KEY_WINDOW_FOCUS_INDICATOR, enabled ? '1' : '0');
        markWindowFocusIndicatorSyncDirty();
        updateWindowFocusIndicatorMenuControl(enabled);
        updateWindowFocusIndicator();
        return enabled;
    }

    function updateWindowFocusIndicator() {
        var root = document.documentElement;
        var overlay = getCachedElement('aft-window-focus-overlay');
        var inactive = isAftWindowInactive();
        var enabled = isWindowFocusIndicatorEnabled();
        var visible = inactive && enabled;
        if (root && root.classList) {
            root.classList.toggle('aft-window-inactive', inactive);
            root.classList.toggle('aft-window-focus-indicator-disabled', !enabled);
        }
        if (overlay) {
            overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
    }

    function consumeWindowActivationEvent(event) {
        if (!event) {
            return;
        }
        try { event.preventDefault(); } catch (e1) {}
        try { event.stopPropagation(); } catch (e2) {}
        try { event.stopImmediatePropagation(); } catch (e3) {}
    }

    function installWindowFocusIndicator(panel) {
        var overlay;
        var content;
        var title;
        var hint;
        if (!panel) {
            return;
        }
        overlay = getCachedElement('aft-window-focus-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'aft-window-focus-overlay';
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.setAttribute('aria-hidden', 'true');
            cachedElements[overlay.id] = overlay;

            content = document.createElement('div');
            content.className = 'aft-window-focus-message';
            title = document.createElement('strong');
            title.textContent = 'NIEAKTYWNE OKNO';
            hint = document.createElement('span');
            hint.textContent = 'Kliknij, aby aktywowa\u0107';
            content.appendChild(title);
            content.appendChild(hint);
            overlay.appendChild(content);

            overlay.addEventListener('pointerdown', function (event) {
                consumeWindowActivationEvent(event);
                try { window.focus(); } catch (e) {}
            }, true);
            overlay.addEventListener('click', function (event) {
                consumeWindowActivationEvent(event);
                windowFocusActivationGuardUntil = 0;
                updateWindowFocusIndicator();
            }, true);
            panel.appendChild(overlay);
        }

        if (!windowFocusIndicatorInstalled) {
            windowFocusIndicatorInstalled = true;
            window.addEventListener('blur', function () {
                windowFocusActivationGuardUntil = 0;
                updateWindowFocusIndicator();
            }, false);
            window.addEventListener('focus', function () {
                windowFocusActivationGuardUntil = now() + 260;
                updateWindowFocusIndicator();
                window.setTimeout(updateWindowFocusIndicator, 280);
            }, false);
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState !== 'hidden' && document.hasFocus()) {
                    windowFocusActivationGuardUntil = now() + 260;
                    window.setTimeout(updateWindowFocusIndicator, 280);
                }
                updateWindowFocusIndicator();
            }, false);
        }
        updateWindowFocusIndicator();
    }

    function createScanButtonsPanel() {
        if (getCachedElement('aft-scan-buttons-panel')) {
            return;
        }

        installPanelStyle();
        installDarkModeStyle();
        installCompactAftLayoutStyle();
        applyDarkMode(storageGet(STORAGE_KEY_DARK_MODE, '') === '1');
        updateCompactSourceBadge();
        loadGroups();
        loadScanHistory();
        createLatestAgeOverlay();

        var panel = document.createElement('div');
        panel.id = 'aft-scan-buttons-panel';
        cachedElements[panel.id] = panel;
        panel.style.position = 'fixed';
        panel.style.left = '12px';
        panel.style.top = '0';
        panel.style.right = '0';
        panel.style.bottom = '0';
        panel.style.transform = 'none';
        panel.style.zIndex = '2147483646';
        panel.style.width = '100vw';
        panel.style.maxWidth = 'none';
        panel.style.minWidth = '0';
        panel.style.maxHeight = 'none';
        panel.style.overflow = 'hidden';
        panel.style.boxSizing = 'border-box';
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.clear = 'none';
        panel.style.margin = '0';
        panel.style.background = 'rgba(255,255,255,0.97)';
        panel.style.color = '#253528';
        panel.style.border = '1px solid #d7e2d7';
        panel.style.borderRadius = '0';
        panel.style.boxShadow = 'none';
        panel.style.font = '13px Arial, sans-serif';
        panel.style.padding = '16px';
        panel.style.backdropFilter = 'none';

        installPanelEventShield(panel);
        installWindowFocusIndicator(panel);

        var header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.gap = '8px';
        header.style.marginBottom = '12px';
        header.style.padding = '0 26px';
        header.style.boxSizing = 'border-box';
        header.style.position = 'relative';

        var title = document.createElement('div');
        title.id = 'aft-scan-panel-header-center';
        cachedElements[title.id] = title;
        title.textContent = '';
        title.style.position = 'absolute';
        title.style.left = '50%';
        title.style.top = '50%';
        title.style.transform = 'translate(-50%, -50%)';
        title.style.maxWidth = '50%';
        title.style.minWidth = '0';

        var rightHeaderActions = document.createElement('div');
        rightHeaderActions.style.display = 'flex';
        rightHeaderActions.style.alignItems = 'center';
        rightHeaderActions.style.gap = '8px';
        rightHeaderActions.style.flex = '0 0 auto';
        rightHeaderActions.style.marginLeft = 'auto';

        var resetBtn = makeButton('', 'Resetuj sesj\u0119', function () {
            resetAftPageFromPanel();
        });
        resetBtn.id = 'aft-scan-reset-session';
        resetBtn.setAttribute('data-aft-menu-label', 'Resetuj sesj\u0119');
        resetBtn.setAttribute('data-aft-menu-hotkey', 'R');
        cachedElements[resetBtn.id] = resetBtn;
        resetBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8V4m0 0h4M5 4l3 3a7 7 0 1 1-2 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        styleSmallIconButton(resetBtn);
        resetBtn.style.color = '#315c31';

        var exportBtn = makeButton('', 'Eksportuj Drop-Zony', function () {
            exportDropZones();
        });
        exportBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M7.5 10.5L12 15l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
        exportBtn.setAttribute('data-aft-menu-label', 'Eksportuj Drop-Zony');
        styleSmallIconButton(exportBtn);
        exportBtn.style.color = '#315c31';

        var importFileInput = document.createElement('input');
        importFileInput.type = 'file';
        importFileInput.accept = '.json,application/json';
        importFileInput.style.display = 'none';
        importFileInput.addEventListener('change', function () {
            if (importFileInput.files && importFileInput.files[0]) {
                importDropZonesFromFile(importFileInput.files[0]);
            }
            importFileInput.value = '';
        });

        var importBtn = makeButton('', 'Importuj Drop-Zony', function () {
            importFileInput.click();
        });
        importBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M7.5 13.5L12 9l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
        importBtn.setAttribute('data-aft-menu-label', 'Importuj Drop-Zony');
        styleSmallIconButton(importBtn);
        importBtn.style.color = '#315c31';

        var darkModeBtn = makeButton('', 'Tryb ciemny wy\u0142\u0105czony', function () {
            toggleDarkMode();
        });
        darkModeBtn.id = 'aft-scan-dark-mode-toggle';
        darkModeBtn.setAttribute('data-aft-menu-label', 'Motyw');
        cachedElements[darkModeBtn.id] = darkModeBtn;
        styleSmallIconButton(darkModeBtn);
        darkModeBtn.style.color = '#6a5420';
        setDarkModeToggleIcon(darkModeBtn, isDarkModeEnabled());

        var menuBtn = makeButton('', 'Otw\u00f3rz menu AFT', function () {
            toggleCompactAftMenu();
        });
        menuBtn.id = 'aft-scan-menu-toggle';
        cachedElements[menuBtn.id] = menuBtn;
        menuBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span>MENU</span>';
        styleSmallIconButton(menuBtn);
        menuBtn.style.width = '112px';
        menuBtn.style.minWidth = '112px';
        menuBtn.style.gap = '8px';
        menuBtn.style.padding = '0 12px';
        menuBtn.style.fontSize = '12px';
        menuBtn.style.fontWeight = '700';
        menuBtn.style.color = '#315c31';

        var headerNewDropZoneBtn = makeButton('Nowy Drop-Zone', 'Dodaj nowy Drop-Zone', function () {
            openNewDropZoneDialog();
        });
        headerNewDropZoneBtn.id = 'aft-scan-new-dropzone-header';
        cachedElements[headerNewDropZoneBtn.id] = headerNewDropZoneBtn;
        headerNewDropZoneBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span>Nowy Drop-Zone</span>';
        stylePrimaryNewButton(headerNewDropZoneBtn);
        headerNewDropZoneBtn.style.width = '152px';
        headerNewDropZoneBtn.style.minWidth = '152px';
        headerNewDropZoneBtn.style.minHeight = '32px';
        headerNewDropZoneBtn.style.height = '32px';
        headerNewDropZoneBtn.style.borderRadius = '10px';
        headerNewDropZoneBtn.style.fontSize = '12px';
        headerNewDropZoneBtn.style.gap = '8px';
        headerNewDropZoneBtn.style.padding = '0 14px';

        rightHeaderActions.appendChild(headerNewDropZoneBtn);
        rightHeaderActions.appendChild(menuBtn);
        header.appendChild(title);
        header.appendChild(rightHeaderActions);
        panel.appendChild(header);
        panel.appendChild(importFileInput);
        movePanelActionsIntoCompactMenu([resetBtn, exportBtn, importBtn, darkModeBtn]);

        var body = document.createElement('div');
        body.id = 'aft-scan-panel-body';
        cachedElements[body.id] = body;
        body.style.padding = '0 0 2px 0';
        body.style.flex = '1 1 auto';
        body.style.minHeight = '0';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';

        attachUnifiedPanelContent(panel, body);

        var textInput = document.createElement('input');
        textInput.id = 'aft-scan-text-input';
        cachedElements[textInput.id] = textInput;
        textInput.type = 'text';
        textInput.placeholder = 'Drop-Zone';
        styleInput(textInput);

        textInput.addEventListener('keydown', function (e) {
            if (e.keyCode === 13) {
                stopEvent(e);
                return false;
            }
        });

        var labelInput = document.createElement('input');
        labelInput.id = 'aft-scan-label-input';
        cachedElements[labelInput.id] = labelInput;
        labelInput.type = 'text';
        labelInput.placeholder = 'Nazwa DZ, opcjonalnie';
        styleInput(labelInput);
        labelInput.addEventListener('keydown', function (e) {
            if (e.keyCode === 13) {
                stopEvent(e);
                return false;
            }
        });

        var groupSelect = document.createElement('select');
        groupSelect.id = 'aft-scan-group-select';
        cachedElements[groupSelect.id] = groupSelect;
        styleSelectControl(groupSelect);
        groupSelect.addEventListener('change', function () {
            activeGroupId = groupSelect.value;
            saveActiveGroup();
        });

        var saveRow = document.createElement('div');
        saveRow.style.display = 'flex';
        saveRow.style.alignItems = 'center';
        saveRow.style.gap = '8px';
        saveRow.style.marginBottom = '8px';

        var addBtn = makeButton('', 'Zapisz jako Drop-Zone w wybranej grupie', function () {
            var textInputForSave = getCachedElement('aft-scan-text-input');
            if (!textInputForSave || !trimText(textInputForSave.value)) {
                try { textInputForSave.focus(); } catch (e) {}
                return;
            }
            if (addQuickButtonFromInputs() !== false) {
                setAddControlsVisible(false, true);
            }
        });
        addBtn.innerHTML = '<svg width="21" height="21" viewBox="0 0 64 64" aria-hidden="true"><path d="M14 8h36c4.4 0 8 3.6 8 8v38.5c0 4.1-4.9 6.2-7.8 3.3L35.5 43.1c-1.9-1.9-5.1-1.9-7 0L13.8 57.8C10.9 60.7 6 58.6 6 54.5V16c0-4.4 3.6-8 8-8z" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
        addBtn.style.flex = '0 0 auto';
        addBtn.style.width = '46px';
        addBtn.style.height = '40px';
        addBtn.style.padding = '0';
        addBtn.style.display = 'inline-flex';
        addBtn.style.alignItems = 'center';
        addBtn.style.justifyContent = 'center';
        addBtn.style.fontSize = '16px';
        addBtn.style.color = '#ffffff';
        addBtn.style.background = '#1f683a';
        addBtn.style.borderColor = '#1f683a';
        addBtn.setAttribute('data-aft-custom-bg', '#1f683a');
        addBtn.setAttribute('data-aft-custom-border', '#1f683a');

        var cancelAddBtn = makeButton('\u00D7', 'Anuluj', function () {
            setAddControlsVisible(false, true);
        });
        cancelAddBtn.style.flex = '0 0 auto';
        cancelAddBtn.style.width = '40px';
        cancelAddBtn.style.height = '40px';
        cancelAddBtn.style.padding = '0';
        cancelAddBtn.style.display = 'inline-flex';
        cancelAddBtn.style.alignItems = 'center';
        cancelAddBtn.style.justifyContent = 'center';
        cancelAddBtn.style.fontSize = '20px';
        cancelAddBtn.style.color = '#a24c4c';
        enableIconButtonClickAnimation(addBtn);
        enableIconButtonClickAnimation(cancelAddBtn);

        groupSelect.style.flex = '1';
        groupSelect.style.minWidth = '0';
        saveRow.appendChild(cancelAddBtn);
        saveRow.appendChild(addBtn);
        saveRow.appendChild(groupSelect);

        var groupRow = document.createElement('div');
        groupRow.style.display = 'flex';
        groupRow.style.alignItems = 'center';
        groupRow.style.gap = '8px';
        groupRow.style.marginBottom = '0';

        var groupInput = document.createElement('input');
        groupInput.id = 'aft-scan-new-group-input';
        cachedElements[groupInput.id] = groupInput;
        groupInput.type = 'text';
        groupInput.placeholder = 'Nazwa nowej grupy';
        styleInput(groupInput);
        groupInput.style.flex = '1';
        groupInput.style.minWidth = '0';
        groupInput.style.marginBottom = '0';
        groupInput.addEventListener('keydown', function (e) {
            if (e.keyCode === 13) {
                stopEvent(e);
                return false;
            }
        });

        var addGroupBtn = makeButton('+ Grupa', 'Utw\u00f3rz grup\u0119', function () {
            addGroupFromInput();
        });
        addGroupBtn.style.flex = '0 0 auto';
        addGroupBtn.style.minWidth = '96px';

        groupRow.appendChild(addGroupBtn);
        groupRow.appendChild(groupInput);

        function populateModalGroupSelect(select, selectedGroupId) {
            var noGroupOption = document.createElement('option');
            var option;
            var i;
            select.textContent = '';
            noGroupOption.value = UNGROUPED_GROUP_ID;
            noGroupOption.textContent = 'Bez grupy';
            noGroupOption.selected = selectedGroupId === UNGROUPED_GROUP_ID;
            select.appendChild(noGroupOption);
            for (i = 0; i < scanGroups.length; i++) {
                if (isUngroupedGroup(scanGroups[i])) {
                    continue;
                }
                option = document.createElement('option');
                option.value = scanGroups[i].id;
                option.textContent = scanGroups[i].name;
                option.selected = option.value === selectedGroupId;
                select.appendChild(option);
            }
        }

        function openNewDropZoneDialog() {
            var dialog = createAftEditDialog('Nowy Drop-Zone', '');
            var form = document.createElement('form');
            var nameInput = document.createElement('input');
            var scanInput = document.createElement('input');
            var modalGroupSelect = document.createElement('select');
            var newGroupField = document.createElement('label');
            var newGroupLabel = document.createElement('span');
            var newGroupRow = document.createElement('div');
            var newGroupInput = document.createElement('input');
            var createGroupBtn;

            function addField(labelText, control) {
                var field = document.createElement('label');
                var label = document.createElement('span');
                field.className = 'aft-script-dialog-field';
                label.textContent = labelText;
                control.setAttribute('aria-label', labelText);
                field.appendChild(label);
                field.appendChild(control);
                form.appendChild(field);
            }

            function saveNewDropZone(event) {
                if (event) {
                    stopEvent(event);
                }
                if (!trimText(scanInput.value) || isDefaultSourceScan(scanInput.value)) {
                    scanInput.focus();
                    return false;
                }
                if (addQuickButton(scanInput.value, nameInput.value, modalGroupSelect.value) === false) {
                    scanInput.focus();
                    return false;
                }
                closeAftEditDialog();
                return false;
            }

            function createGroupInDialog(event) {
                var name = trimText(newGroupInput.value);
                if (event) {
                    stopEvent(event);
                }
                if (!name) {
                    newGroupInput.focus();
                    return false;
                }
                addGroup(name);
                populateModalGroupSelect(modalGroupSelect, activeGroupId);
                modalGroupSelect.value = activeGroupId;
                newGroupInput.value = '';
                scanInput.focus();
                return false;
            }

            form.className = 'aft-script-dialog-form';
            nameInput.type = 'text';
            nameInput.autocomplete = 'off';
            scanInput.type = 'text';
            scanInput.autocomplete = 'off';
            populateModalGroupSelect(modalGroupSelect, activeGroupId);
            addField('Nazwa Drop-Zone (opcjonalnie)', nameInput);
            addField('Tekst skanu', scanInput);
            addField('Grupa', modalGroupSelect);
            newGroupField.className = 'aft-script-dialog-field aft-script-dialog-new-group-field';
            newGroupLabel.textContent = 'Nowa grupa';
            newGroupRow.className = 'aft-script-dialog-new-group-row';
            newGroupInput.type = 'text';
            newGroupInput.autocomplete = 'off';
            newGroupInput.placeholder = 'Nazwa grupy';
            newGroupInput.setAttribute('aria-label', 'Nazwa nowej grupy');
            newGroupInput.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.keyCode === 13) {
                    createGroupInDialog(event);
                }
            });
            createGroupBtn = makeButton('Utw\u00f3rz grup\u0119', 'Utw\u00f3rz grup\u0119 bez dodawania Drop-Zone', createGroupInDialog);
            createGroupBtn.className += ' aft-script-dialog-create-group';
            newGroupRow.appendChild(newGroupInput);
            newGroupRow.appendChild(createGroupBtn);
            newGroupField.appendChild(newGroupLabel);
            newGroupField.appendChild(newGroupRow);
            form.appendChild(newGroupField);
            dialog.fields.appendChild(form);
            form.addEventListener('submit', saveNewDropZone);
            addAftDialogButton(dialog.actions, 'Anuluj', 'aft-script-dialog-cancel', closeAftEditDialog);
            addAftDialogButton(dialog.actions, 'Zapisz', 'aft-script-dialog-primary', saveNewDropZone);
            window.setTimeout(function () {
                scanInput.focus();
            }, 0);
        }

        var quickBox = document.createElement('div');
        quickBox.id = 'aft-scan-quick-buttons';
        cachedElements[quickBox.id] = quickBox;
        quickBox.style.flex = '1 1 auto';
        quickBox.style.minHeight = SCAN_GROUPS_MIN_VISIBLE_HEIGHT + 'px';
        quickBox.style.maxHeight = 'none';
        quickBox.style.overflowY = 'auto';
        quickBox.style.borderBottom = '1px solid #dce8dc';
        quickBox.style.marginBottom = '14px';
        quickBox.style.padding = '0 6px 14px 6px';

        quickBox.addEventListener('dragover', function (e) {
            if (groupDragData) {
                return showGroupDropMarker(e, null, '');
            }
            if (dragData) {
                if (getClosestWithClass(e.target, 'aft-scan-button-row') || getClosestWithClass(e.target, 'aft-scan-group-wrap')) {
                    return true;
                }
                return showUngroupedDropMarker(e, quickBox);
            }
            return true;
        });
        quickBox.addEventListener('drop', function (e) {
            return performDropTarget(e);
        });
        quickBox.addEventListener('dragleave', function (e) {
            var related = e.relatedTarget;
            if (!related || !quickBox.contains(related)) {
                clearDropMarker();
            }
        });

        var newDropZoneWrap = document.createElement('div');
        newDropZoneWrap.id = 'aft-scan-new-dropzone-wrap';
        cachedElements[newDropZoneWrap.id] = newDropZoneWrap;
        newDropZoneWrap.style.margin = '0';
        newDropZoneWrap.style.flex = '0 0 auto';
        newDropZoneWrap.style.padding = '0 26px';
        newDropZoneWrap.style.boxSizing = 'border-box';

        var newDropZoneBtn = makeButton('Nowy Drop-Zone', 'Dodaj nowy Drop-Zone', function () {
            setAddControlsVisible(true, false);
        });
        stylePrimaryNewButton(newDropZoneBtn);
        newDropZoneWrap.appendChild(newDropZoneBtn);

        var addControls = document.createElement('div');
        addControls.id = 'aft-scan-add-controls';
        cachedElements[addControls.id] = addControls;
        addControls.style.margin = '12px 26px 0 26px';
        addControls.style.padding = '12px';
        addControls.style.border = '1px dashed #a9c9a9';
        addControls.style.borderRadius = '14px';
        addControls.style.background = '#f7fbf7';
        addControls.style.flex = '0 0 auto';
        addControls.appendChild(textInput);
        addControls.appendChild(labelInput);
        addControls.appendChild(saveRow);
        addControls.appendChild(groupRow);

        var scanHistoryBox = createScanHistoryBox();

        body.appendChild(quickBox);
        body.appendChild(scanHistoryBox);
        panel.appendChild(body);
        attachPanelUnderScanSteps(panel);

        updateGroupSelect();
        renderGroups();
        renderScanHistory();
        resumePendingAgeRequests();
        revealTargetPageAfterBoot();
    }
    function autoContinueError() {
        var wrapper = getCachedElement('exception-wrapper');
        if (!isVisible(wrapper)) {
            return;
        }

        var button = getCachedElement('exception-btn');
        if (!button || !isVisible(button)) {
            return;
        }

        var t = now();
        if (t - lastErrorCAt < ERROR_C_COOLDOWN_MS) {
            return;
        }

        lastErrorCAt = t;
        triggerAftHotKey('C');
    }

    function getConfirmationModalText(modal) {
        var message = null;
        var text = '';

        if (!modal) {
            return '';
        }

        try {
            message = modal.querySelector ? modal.querySelector('.modal-message') : null;
        } catch (e1) {}

        if (message) {
            text = trimText(message.textContent || message.innerText || '');
        }
        if (!text) {
            text = trimText(modal.textContent || modal.innerText || '');
        }
        return text;
    }

    function extractContainerFromConfirmation() {
        var modal = getCachedElement('diversion-with-back');
        var text;
        var patterns;
        var i;
        var match;

        if (!isVisible(modal)) {
            return null;
        }

        text = getConfirmationModalText(modal);
        if (!text) {
            return null;
        }

        patterns = [
            /Zeskanowany\s+kontener\s+([A-Za-z0-9_-]+)/i,
            /zeskanuj\s+kontener\s+([A-Za-z0-9_-]+)/i,
            /\b(ts[A-Za-z0-9_-]+)\b/i,
            /\b([A-Za-z]{2,}[0-9][A-Za-z0-9_-]{4,})\b/
        ];

        for (i = 0; i < patterns.length; i++) {
            match = patterns[i].exec(text);
            if (match && match[1]) {
                return match[1];
            }
        }

        return null;
    }

    function scanDirect(container) {
        var activeStepId = getActiveAftStepId();
        try {
            if (PAGE_WINDOW.aft && typeof PAGE_WINDOW.aft.scan === 'function') {
                if (activeStepId === AFT_STEP_DESTINATION) {
                    setScanWaitingState(getCachedElement('scan-destination-container'), true);
                } else if (activeStepId === AFT_STEP_CONTAINER) {
                    setScanWaitingState(getCachedElement('scan-container'), true);
                }
                PAGE_WINDOW.aft.scan(container);
                return true;
            }
        } catch (e) {}
        return false;
    }

    function getActiveAftStepId() {
        try {
            return PAGE_WINDOW.aft && PAGE_WINDOW.aft.activeStep && PAGE_WINDOW.aft.activeStep.id ? String(PAGE_WINDOW.aft.activeStep.id) : '';
        } catch (e) {}
        return '';
    }

    function isActiveAftStep(stepId) {
        return getActiveAftStepId() === stepId;
    }

    function isAftInputDisabled() {
        try {
            return !!(PAGE_WINDOW.aft && PAGE_WINDOW.aft.registry && PAGE_WINDOW.aft.registry.eventDelegator && PAGE_WINDOW.aft.registry.eventDelegator.isInputDisabled);
        } catch (e) {}
        return false;
    }

    function isAftResetAllowed() {
        var keys;
        var i;
        try {
            keys = PAGE_WINDOW.aft && PAGE_WINDOW.aft.activeStep && PAGE_WINDOW.aft.activeStep.activeKeys;
            if (!keys || typeof keys.length !== 'number') {
                return false;
            }
            for (i = 0; i < keys.length; i++) {
                if (String(keys[i]).toUpperCase() === 'R') {
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function hasBlockingAftModal() {
        var ids = ['exception-wrapper', 'diversion-with-back', 'text-entry', 'SignOut'];
        var i;
        var el;
        for (i = 0; i < ids.length; i++) {
            el = getCachedElement(ids[i]);
            if (el && isVisible(el)) {
                return true;
            }
        }
        return false;
    }

    function getAftSession() {
        try {
            return PAGE_WINDOW.aft && PAGE_WINDOW.aft.registry ? PAGE_WINDOW.aft.registry.session : null;
        } catch (e) {}
        return null;
    }

    function clearAftMoveSessionValues() {
        var session = getAftSession();
        if (!session) {
            return;
        }
        try {
            delete session.sourceScannableId;
            delete session.destinationScannableId;
            delete session.containerScannableId;
        } catch (e) {}
    }

    function clearAftMoveStep(stepId) {
        var step;
        try {
            if (!PAGE_WINDOW.aft || !PAGE_WINDOW.aft.register) {
                return;
            }
            step = PAGE_WINDOW.aft.register(stepId, 'step');
            if (step && typeof step.clear === 'function') {
                step.clear();
                step.cleared = true;
            }
        } catch (e) {}
    }

    function clearAftMoveSteps() {
        clearAftMoveStep(AFT_STEP_CONTAINER);
        clearAftMoveStep(AFT_STEP_DESTINATION);
        clearAftMoveStep(AFT_STEP_SOURCE);
    }

    function triggerAftResetSession() {
        var handler;
        try {
            if (PAGE_WINDOW.aft && PAGE_WINDOW.aft.register) {
                handler = PAGE_WINDOW.aft.register('ResetSession', 'handler');
                if (handler && typeof handler.handleHotKeyR === 'function') {
                    handler.handleHotKeyR();
                    return true;
                }
            }
        } catch (e1) {}

        try {
            return triggerAftHotKey('R');
        } catch (e2) {}
        return false;
    }

    function getUkrainianPhysicalKeyFallback(key) {
        var ukrainianToUs = {
            '\u0439': 'q', '\u0446': 'w', '\u0443': 'e', '\u043A': 'r', '\u0435': 't', '\u043D': 'y',
            '\u0433': 'u', '\u0448': 'i', '\u0449': 'o', '\u0437': 'p', '\u0445': '[', '\u0457': ']',
            '\u0444': 'a', '\u0456': 's', '\u0432': 'd', '\u0430': 'f', '\u043F': 'g', '\u0440': 'h',
            '\u043E': 'j', '\u043B': 'k', '\u0434': 'l', '\u0436': ';', '\u0454': "'",
            '\u044F': 'z', '\u0447': 'x', '\u0441': 'c', '\u043C': 'v', '\u0438': 'b', '\u0442': 'n',
            '\u044C': 'm', '\u0431': ',', '\u044E': '.', '\u0491': '`',
            '\u0419': 'Q', '\u0426': 'W', '\u0423': 'E', '\u041A': 'R', '\u0415': 'T', '\u041D': 'Y',
            '\u0413': 'U', '\u0428': 'I', '\u0429': 'O', '\u0417': 'P', '\u0425': '{', '\u0407': '}',
            '\u0424': 'A', '\u0406': 'S', '\u0412': 'D', '\u0410': 'F', '\u041F': 'G', '\u0420': 'H',
            '\u041E': 'J', '\u041B': 'K', '\u0414': 'L', '\u0416': ':', '\u0404': '"',
            '\u042F': 'Z', '\u0427': 'X', '\u0421': 'C', '\u041C': 'V', '\u0418': 'B', '\u0422': 'N',
            '\u042C': 'M', '\u0411': '<', '\u042E': '>', '\u0490': '~'
        };
        key = String(key || '');
        if (Object.prototype.hasOwnProperty.call(ukrainianToUs, key)) {
            return ukrainianToUs[key];
        }
        return '';
    }

    function getUsCharacterFromPhysicalKey(event) {
        var code = String(event && event.code || '');
        var key = String(event && event.key || '');
        var digit;
        var shiftedDigits = ')!@#$%^&*(';
        var punctuation = {
            Minus: ['-', '_'],
            Equal: ['=', '+'],
            BracketLeft: ['[', '{'],
            BracketRight: [']', '}'],
            Backslash: ['\\', '|'],
            Semicolon: [';', ':'],
            Quote: ["'", '"'],
            Comma: [',', '<'],
            Period: ['.', '>'],
            Slash: ['/', '?'],
            Backquote: ['`', '~']
        };
        if (/^Key[A-Z]$/.test(code)) {
            key = code.slice(3);
            return event.shiftKey ? key : key.toLowerCase();
        }
        if (/^Digit[0-9]$/.test(code)) {
            digit = Number(code.slice(5));
            return event.shiftKey ? shiftedDigits.charAt(digit) : String(digit);
        }
        if (/^Numpad[0-9]$/.test(code)) {
            return code.slice(6);
        }
        if (Object.prototype.hasOwnProperty.call(punctuation, code)) {
            return punctuation[code][event.shiftKey ? 1 : 0];
        }
        if (code === 'NumpadDecimal') { return '.'; }
        if (code === 'NumpadAdd') { return '+'; }
        if (code === 'NumpadSubtract') { return '-'; }
        if (code === 'NumpadMultiply') { return '*'; }
        if (code === 'NumpadDivide') { return '/'; }
        if (key.length === 1 && /^[A-Za-z0-9_+\-=\[\]{}\\|;:'",.<>/?`~!@#$%^&*()]$/.test(key)) {
            return key;
        }
        return getUkrainianPhysicalKeyFallback(key);
    }

    function isPhysicalScannerTerminator(event) {
        var key = String(event && event.key || '');
        var code = String(event && event.code || '');
        return key === 'Enter' || key === 'Tab' || code === 'Enter' || code === 'NumpadEnter' || code === 'Tab';
    }

    function consumePhysicalScannerEvent(event) {
        try { event.preventDefault(); } catch (e1) {}
        try { event.stopPropagation(); } catch (e2) {}
        try { event.stopImmediatePropagation(); } catch (e3) {}
    }

    function triggerBufferedPhysicalHotkey(value) {
        var hotkey = String(value || '').toUpperCase();
        var resetBtn;
        if (hotkey === 'R') {
            resetBtn = getCachedElement('aft-scan-reset-session');
            if (resetBtn && !resetBtn.disabled) {
                resetBtn.click();
            }
        } else if (hotkey === 'W') {
            openAftWorkflowSelection();
        } else if (hotkey === 'M') {
            toggleCompactAftMenu();
        }
    }

    function installPhysicalScannerInput() {
        var buffer = '';
        var idleTimer = null;
        var suppressTerminatorUntil = 0;
        var idleMs = 650;

        function clearIdleTimer() {
            if (idleTimer) {
                window.clearTimeout(idleTimer);
                idleTimer = null;
            }
        }

        function clearBuffer() {
            clearIdleTimer();
            buffer = '';
        }

        function scheduleIdleReset() {
            clearIdleTimer();
            idleTimer = window.setTimeout(function () {
                var pending = buffer;
                buffer = '';
                idleTimer = null;
                if (pending.length === 1) {
                    triggerBufferedPhysicalHotkey(pending);
                }
            }, idleMs);
        }

        function handlePhysicalScannerKeydown(event) {
            var character;
            var value;
            if (!event || event.ctrlKey || event.altKey || event.metaKey || event.repeat || isEditableHotkeyTarget(event.target)) {
                return;
            }
            if (isPhysicalScannerTerminator(event)) {
                if (!buffer) {
                    return;
                }
                consumePhysicalScannerEvent(event);
                suppressTerminatorUntil = now() + 300;
                value = buffer;
                clearBuffer();
                if (isActiveAftStep(AFT_STEP_CONTAINER)) {
                    if (!enqueueAftContainerScan(value) && !isAftInputDisabled() && !hasBlockingAftModal()) {
                        scanDirect(value);
                    }
                } else if (!isAftInputDisabled() && !hasBlockingAftModal()) {
                    scanDirect(value);
                }
                return;
            }
            if ((event.key === 'Backspace' || event.code === 'Backspace') && buffer) {
                consumePhysicalScannerEvent(event);
                buffer = buffer.slice(0, -1);
                scheduleIdleReset();
                return;
            }
            if ((event.key === 'Escape' || event.code === 'Escape') && buffer) {
                consumePhysicalScannerEvent(event);
                clearBuffer();
                return;
            }
            character = getUsCharacterFromPhysicalKey(event);
            if (!character) {
                return;
            }
            consumePhysicalScannerEvent(event);
            buffer += character;
            scheduleIdleReset();
        }

        function suppressPhysicalScannerFollowup(event) {
            if (!event || event.ctrlKey || event.altKey || event.metaKey || isEditableHotkeyTarget(event.target)) {
                return;
            }
            if (getUsCharacterFromPhysicalKey(event) ||
                    (isPhysicalScannerTerminator(event) && now() <= suppressTerminatorUntil) ||
                    ((event.key === 'Backspace' || event.code === 'Backspace' || event.key === 'Escape' || event.code === 'Escape') && buffer)) {
                consumePhysicalScannerEvent(event);
            }
        }

        if (physicalScannerInputInstalled) {
            return;
        }
        physicalScannerInputInstalled = true;
        window.addEventListener('keydown', handlePhysicalScannerKeydown, true);
        window.addEventListener('keypress', suppressPhysicalScannerFollowup, true);
        window.addEventListener('keyup', suppressPhysicalScannerFollowup, true);
    }

    function isManualAsciiTextTarget(target) {
        var tag = String(target && target.tagName || '').toLowerCase();
        var type;
        if (tag === 'textarea') {
            return !target.readOnly && !target.disabled;
        }
        if (tag !== 'input' || target.readOnly || target.disabled) {
            return false;
        }
        type = String(target.type || 'text').toLowerCase();
        return type === 'text' || type === 'search' || type === 'tel' || type === 'url';
    }

    function getUsCharacterFromManualKey(event) {
        var character = getUsCharacterFromPhysicalKey(event);
        var code = String(event && event.code || '');
        var capsLock = false;
        if (!character || !/^Key[A-Z]$/.test(code)) {
            return character;
        }
        try {
            capsLock = event.getModifierState && event.getModifierState('CapsLock') === true;
        } catch (e) {}
        if (capsLock) {
            character = event.shiftKey ? character.toLowerCase() : character.toUpperCase();
        }
        return character;
    }

    function sanitizeManualAsciiText(value) {
        var source = String(value == null ? '' : value);
        var result = '';
        var character;
        var mapped;
        var code;
        var i;
        for (i = 0; i < source.length; i++) {
            character = source.charAt(i);
            mapped = getUkrainianPhysicalKeyFallback(character);
            if (mapped) {
                result += mapped;
                continue;
            }
            code = character.charCodeAt(0);
            if ((code >= 32 && code <= 126) || character === '\n' || character === '\r' || character === '\t') {
                result += character;
            }
        }
        return result;
    }

    function insertManualAsciiCharacter(target, character) {
        var start;
        var end;
        var value;
        var inputEvent;
        try {
            start = typeof target.selectionStart === 'number' ? target.selectionStart : String(target.value || '').length;
            end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
            if (typeof target.setRangeText === 'function') {
                target.setRangeText(character, start, end, 'end');
            } else {
                value = String(target.value || '');
                target.value = value.slice(0, start) + character + value.slice(end);
            }
            inputEvent = new Event('input', { bubbles: true });
            target.dispatchEvent(inputEvent);
        } catch (e) {}
    }

    function sanitizeManualAsciiTarget(target) {
        var value;
        var sanitized;
        var selectionStart;
        var selectionEnd;
        var sanitizedStart;
        var sanitizedEnd;
        if (!isManualAsciiTextTarget(target)) {
            return;
        }
        value = String(target.value || '');
        sanitized = sanitizeManualAsciiText(value);
        if (sanitized === value) {
            return;
        }
        try {
            selectionStart = typeof target.selectionStart === 'number' ? target.selectionStart : value.length;
            selectionEnd = typeof target.selectionEnd === 'number' ? target.selectionEnd : selectionStart;
            sanitizedStart = sanitizeManualAsciiText(value.slice(0, selectionStart)).length;
            sanitizedEnd = sanitizeManualAsciiText(value.slice(0, selectionEnd)).length;
            target.value = sanitized;
            if (typeof target.setSelectionRange === 'function') {
                target.setSelectionRange(sanitizedStart, sanitizedEnd);
            }
        } catch (e) {
            try { target.value = sanitized; } catch (e2) {}
        }
    }

    function installManualAsciiInput() {
        function handleManualAsciiKeydown(event) {
            var character;
            if (!event || !isManualAsciiTextTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing) {
                return;
            }
            character = getUsCharacterFromManualKey(event);
            if (!character) {
                return;
            }
            consumePhysicalScannerEvent(event);
            insertManualAsciiCharacter(event.target, character);
        }

        function suppressManualAsciiFollowup(event) {
            if (!event || !isManualAsciiTextTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
                return;
            }
            if (getUsCharacterFromManualKey(event)) {
                consumePhysicalScannerEvent(event);
            }
        }

        function handleManualAsciiInput(event) {
            sanitizeManualAsciiTarget(event && event.target);
        }

        if (manualAsciiInputInstalled) {
            return;
        }
        manualAsciiInputInstalled = true;
        window.addEventListener('keydown', handleManualAsciiKeydown, true);
        window.addEventListener('keypress', suppressManualAsciiFollowup, true);
        window.addEventListener('keyup', suppressManualAsciiFollowup, true);
        window.addEventListener('input', handleManualAsciiInput, true);
    }

    function resetAftMoveSessionForDropZone() {
        if (isActiveAftStep(AFT_STEP_SOURCE)) {
            return false;
        }

        clearAftMoveSessionValues();
        clearAftMoveSteps();

        if (isAftResetAllowed()) {
            triggerAftResetSession();
        }

        return true;
    }

    function canScanAftStep(stepId) {
        return isActiveAftStep(stepId) && !isAftInputDisabled() && !hasBlockingAftModal();
    }

    function canOpenDirectScanEntry(stepId) {
        var activeStepId = getActiveAftStepId();
        if (isAftInputDisabled() || hasBlockingAftModal()) {
            return false;
        }
        if (stepId === AFT_STEP_DESTINATION) {
            return activeStepId === AFT_STEP_DESTINATION || activeStepId === AFT_STEP_CONTAINER;
        }
        return activeStepId === stepId;
    }

    function getDirectScanStepForBox(box) {
        if (!box) {
            return '';
        }
        if (box.id === 'scan-destination-container') {
            return AFT_STEP_DESTINATION;
        }
        if (box.id === 'scan-container') {
            return AFT_STEP_CONTAINER;
        }
        return '';
    }

    function findDirectScanEntryBox(node) {
        while (node && node !== document) {
            if (node.id === 'scan-destination-container' || node.id === 'scan-container') {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    function stopDirectScanEntryEvent(e, preventDefault) {
        if (!e) {
            return;
        }
        if (preventDefault && e.preventDefault) {
            e.preventDefault();
        }
        if (e.stopImmediatePropagation) {
            e.stopImmediatePropagation();
        } else if (e.stopPropagation) {
            e.stopPropagation();
        }
        e.cancelBubble = true;
    }

    function closeDirectScanEntry(restoreFocus) {
        var input = getCachedElement('aft-direct-scan-input');
        var boxes = [
            getCachedElement('scan-destination-container'),
            getCachedElement('scan-container')
        ];
        var i;

        if (input && input.__aftDirectScanCloseTimer) {
            window.clearTimeout(input.__aftDirectScanCloseTimer);
            input.__aftDirectScanCloseTimer = null;
        }
        if (input && input.parentNode) {
            try {
                input.parentNode.removeChild(input);
            } catch (e) {}
        }
        delete cachedElements['aft-direct-scan-input'];
        for (i = 0; i < boxes.length; i++) {
            if (boxes[i] && boxes[i].classList) {
                boxes[i].classList.remove('aft-direct-scan-editing');
            }
        }
        if (restoreFocus) {
            queueAftPageFocusRestore();
        }
    }

    function flashDirectScanInputError(input) {
        if (!input || !input.classList) {
            return;
        }
        input.classList.remove('aft-direct-scan-input-error');
        try {
            void input.offsetWidth;
        } catch (e) {}
        input.classList.add('aft-direct-scan-input-error');
        window.setTimeout(function () {
            if (input && input.classList) {
                input.classList.remove('aft-direct-scan-input-error');
            }
        }, 420);
    }

    function openDirectScanEntry(box, stepId) {
        var existing = getCachedElement('aft-direct-scan-input');
        var input;
        var placeholder;
        var finishPendingEntry;
        var stopInputEvent;

        if (!box || !stepId || !canOpenDirectScanEntry(stepId)) {
            return false;
        }
        if (existing && existing.parentNode === box && existing.getAttribute('data-aft-step-id') === stepId) {
            try {
                existing.focus({ preventScroll: true });
            } catch (e1) {
                try {
                    existing.focus();
                } catch (e2) {}
            }
            return true;
        }

        closeDirectScanEntry(false);
        placeholder = stepId === AFT_STEP_DESTINATION ? 'Wprowad\u017a Drop-Zone' : 'Wprowad\u017a kontener';
        input = document.createElement('input');
        input.id = 'aft-direct-scan-input';
        input.className = 'aft-direct-scan-input';
        input.type = 'text';
        input.placeholder = placeholder;
        input.maxLength = 256;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('autocapitalize', 'none');
        input.setAttribute('inputmode', 'text');
        input.setAttribute('aria-label', placeholder);
        input.setAttribute('data-aft-step-id', stepId);

        finishPendingEntry = function () {
            if (!input.__aftDirectScanPending) {
                return;
            }
            input.__aftDirectScanPending = false;
            closeDirectScanEntry(true);
        };
        stopInputEvent = function (e) {
            stopDirectScanEntryEvent(e, false);
        };

        input.addEventListener('mousedown', stopInputEvent, false);
        input.addEventListener('mouseup', stopInputEvent, false);
        input.addEventListener('click', stopInputEvent, false);
        input.addEventListener('dblclick', stopInputEvent, false);
        input.addEventListener('input', stopInputEvent, false);
        input.addEventListener('keypress', stopInputEvent, false);
        input.addEventListener('keydown', function (e) {
            var key = e && (e.key || e.keyCode);
            var value;

            if (key === 'Enter' || key === 13) {
                stopDirectScanEntryEvent(e, true);
                if (input.__aftDirectScanPending) {
                    return;
                }
                value = trimText(input.value);
                if (!value) {
                    flashDirectScanInputError(input);
                    return;
                }
                if (!canOpenDirectScanEntry(stepId)) {
                    flashDirectScanInputError(input);
                    return;
                }
                if (stepId === AFT_STEP_DESTINATION && isActiveAftStep(AFT_STEP_CONTAINER)) {
                    submitDropZoneWithReset(value);
                } else if (stepId === AFT_STEP_CONTAINER && !enqueueAftContainerScan(value)) {
                    flashDirectScanInputError(input);
                    return;
                } else if (stepId !== AFT_STEP_CONTAINER && !scanDirect(value)) {
                    flashDirectScanInputError(input);
                    return;
                }
                directScanEntrySuppressEnterUntil = now() + 500;
                input.__aftDirectScanPending = true;
                input.readOnly = true;
                input.__aftDirectScanCloseTimer = window.setTimeout(finishPendingEntry, 240);
                return;
            }

            if (key === 'Escape' || key === 27) {
                stopDirectScanEntryEvent(e, true);
                closeDirectScanEntry(true);
                return;
            }
            stopDirectScanEntryEvent(e, false);
        }, false);
        input.addEventListener('keyup', function (e) {
            var key = e && (e.key || e.keyCode);
            stopDirectScanEntryEvent(e, key === 'Enter' || key === 13 || key === 'Escape' || key === 27);
            if ((key === 'Enter' || key === 13) && input.__aftDirectScanPending) {
                finishPendingEntry();
            }
        }, false);
        input.addEventListener('blur', function () {
            window.setTimeout(function () {
                if (!input.__aftDirectScanPending && getCachedElement('aft-direct-scan-input') === input && document.activeElement !== input) {
                    closeDirectScanEntry(false);
                }
            }, 100);
        }, false);

        box.classList.add('aft-direct-scan-editing');
        box.appendChild(input);
        cachedElements[input.id] = input;
        try {
            input.focus({ preventScroll: true });
        } catch (e3) {
            try {
                input.focus();
            } catch (e4) {}
        }
        return true;
    }

    function setDirectScanEntryReady(box, ready) {
        var originalTitle;
        if (!box || !box.classList) {
            return;
        }
        if (ready) {
            box.classList.add('aft-direct-scan-ready');
            if (!box.hasAttribute('data-aft-direct-scan-original-title')) {
                box.setAttribute('data-aft-direct-scan-original-title', box.getAttribute('title') || '');
            }
            box.setAttribute('title', 'Kliknij, aby wprowadzi\u0107 tekst skanu');
            return;
        }

        box.classList.remove('aft-direct-scan-ready');
        if (box.hasAttribute('data-aft-direct-scan-original-title')) {
            originalTitle = box.getAttribute('data-aft-direct-scan-original-title');
            if (originalTitle) {
                box.setAttribute('title', originalTitle);
            } else {
                box.removeAttribute('title');
            }
            box.removeAttribute('data-aft-direct-scan-original-title');
        }
    }

    function updateDirectScanEntryAffordance() {
        var activeStepId = getActiveAftStepId();
        var canAcceptScan = !isAftInputDisabled() && !hasBlockingAftModal();
        var destinationBox = getCachedElement('scan-destination-container');
        var containerBox = getCachedElement('scan-container');
        var input = getCachedElement('aft-direct-scan-input');
        var inputBox;
        var inputStep;

        setDirectScanEntryReady(
            destinationBox,
            canAcceptScan && (activeStepId === AFT_STEP_DESTINATION || activeStepId === AFT_STEP_CONTAINER) && isVisible(destinationBox)
        );
        setDirectScanEntryReady(
            containerBox,
            canAcceptScan && activeStepId === AFT_STEP_CONTAINER && isVisible(containerBox)
        );

        if (!input) {
            return;
        }
        inputBox = findDirectScanEntryBox(input);
        inputStep = input.getAttribute('data-aft-step-id') || '';
        if (!inputBox || !canAcceptScan || !canOpenDirectScanEntry(inputStep) ||
                !inputBox.classList.contains('aft-direct-scan-ready')) {
            closeDirectScanEntry(!!input.__aftDirectScanPending);
        }
    }

    function installDirectScanEntryHandler() {
        var suppressSubmittedEnter;
        if (directScanEntryHandlersInstalled) {
            return;
        }
        directScanEntryHandlersInstalled = true;
        suppressSubmittedEnter = function (e) {
            var key = e && (e.key || e.keyCode);
            if (now() <= directScanEntrySuppressEnterUntil && (key === 'Enter' || key === 13)) {
                stopDirectScanEntryEvent(e, true);
            }
        };
        document.addEventListener('keydown', suppressSubmittedEnter, true);
        document.addEventListener('keypress', suppressSubmittedEnter, true);
        document.addEventListener('keyup', suppressSubmittedEnter, true);
        document.addEventListener('click', function (e) {
            var target = e && e.target;
            var box;
            var stepId;

            if (target && target.id === 'aft-direct-scan-input') {
                return;
            }
            box = findDirectScanEntryBox(target);
            stepId = getDirectScanStepForBox(box);
            if (!box || !stepId || !box.classList.contains('aft-direct-scan-ready') || !canOpenDirectScanEntry(stepId)) {
                return;
            }
            stopEvent(e);
            openDirectScanEntry(box, stepId);
        }, true);
    }

    function waitForAftStep(stepId, sequenceId, startedAt, callback) {
        if (sequenceId !== dropZoneScanSequence) {
            return;
        }
        if (canScanAftStep(stepId)) {
            callback();
            return;
        }
        if (now() - startedAt > DROP_ZONE_SEQUENCE_MAX_WAIT_MS) {
            finishDropZoneSequence(sequenceId);
            return;
        }
        window.setTimeout(function () {
            waitForAftStep(stepId, sequenceId, startedAt, callback);
        }, DROP_ZONE_STEP_WAIT_MS);
    }

    function finishDropZoneSequence(sequenceId) {
        if (sequenceId === dropZoneScanSequence) {
            dropZoneSequenceActive = false;
        }
    }

    function scanDefaultSourceNow() {
        lastDefaultSourceScanAt = now();
        return scanDirect(DEFAULT_SOURCE_SCAN);
    }

    function autoDefaultSourceScan() {
        var t;
        if (dropZoneSequenceActive) {
            return;
        }
        if (!canScanAftStep(AFT_STEP_SOURCE)) {
            return;
        }
        t = now();
        if (t - lastDefaultSourceScanAt < DEFAULT_SOURCE_SCAN_COOLDOWN_MS) {
            return;
        }
        scanDefaultSourceNow();
    }

    function submitDropZoneWithReset(dropZoneText) {
        var sequenceId = ++dropZoneScanSequence;
        var startedAt = now();

        activateAgeDropZoneForScanText(dropZoneText);
        dropZoneSequenceActive = true;
        resetAftMoveSessionForDropZone();

        waitForAftStep(AFT_STEP_SOURCE, sequenceId, startedAt, function () {
            scanDefaultSourceNow();
            waitForAftStep(AFT_STEP_DESTINATION, sequenceId, now(), function () {
                scanDirect(dropZoneText);
                queueAftPageFocusRestore();
                finishDropZoneSequence(sequenceId);
            });
        });

        return true;
    }

    function submitConfirm(container) {
        autoConfirmScanActiveUntil = now() + 2600;
        triggerScanSuccessPulse('scan-container');
        scanDirect(container);
    }

    function autoConfirmRescan() {
        var container = extractContainerFromConfirmation();
        if (!container) {
            lastModalSignature = '';
            modalRetryCount = 0;
            return;
        }

        var modal = getCachedElement('diversion-with-back');
        var modalText = getConfirmationModalText(modal);
        var signature = container + '|' + modalText;
        var t = now();

        if (signature !== lastModalSignature) {
            lastModalSignature = signature;
            modalRetryCount = 0;
            lastConfirmAt = 0;
        }

        if (t - lastConfirmAt < CONFIRM_RETRY_COOLDOWN_MS) {
            return;
        }

        if (modalRetryCount >= MAX_CONFIRM_RETRIES_PER_MODAL) {
            return;
        }

        lastConfirmAt = t;
        modalRetryCount++;
        submitConfirm(container);
    }
    function autoActionLoop() {
        updateWindowFocusIndicator();
        autoContinueError();
        autoConfirmRescan();
        autoDefaultSourceScan();
        processAftContainerScanQueue();
        observeScannedContainerAge();
    }

    function slowMaintenanceLoop() {
        installNativeAftSoundBlocker();
        installPhysicalScannerInput();
        installManualAsciiInput();
        blockAftSignOutHotkey();
        installAftContainerScanHook();
        installAftScanSuccessHooks();
        installDirectScanEntryHandler();
        updateCompactSourceBadge();
        updateScanTextEndVisibility();
        updateScanWaitingAnimation();
        updateDirectScanEntryAffordance();
    }

    function queueAutoActionLoop() {
        if (observerTimer) {
            return;
        }
        observerTimer = window.setTimeout(function () {
            observerTimer = null;
            autoActionLoop();
            slowMaintenanceLoop();
        }, 25);
    }

    function queueLayoutUpdate() {
        if (layoutTimer) {
            return;
        }
        layoutTimer = window.setTimeout(function () {
            layoutTimer = null;
            keepPanelUnderScanSteps();
            updateDropZoneGridLayouts();
            alignScanHistoryBoxToGroups();
            updateLatestAgeOverlayPosition();
            updateScanTextEndVisibility();
        }, LAYOUT_DEBOUNCE_MS);
    }

    function queueRuntimeUpdate() {
        queueAutoActionLoop();
        queueLayoutUpdate();
    }

    function nodeToElement(node) {
        if (!node) {
            return null;
        }
        return node.nodeType === 1 ? node : node.parentNode;
    }

    function hasClass(el, className) {
        return !!(el && el.className && String(el.className).indexOf(className) !== -1);
    }

    function isOwnUiElement(el) {
        var panel = getCachedElement('aft-scan-buttons-panel');
        var stepsContainer = document.querySelector('.steps-container');
        var marker = getCachedElement('aft-scan-drop-marker');
        var picker = getCachedElement('aft-scan-group-color-picker');
        var dataMatrixOverlay = getCachedElement('aft-scan-datamatrix-overlay');
        var latestAgeOverlay = getCachedElement('aft-latest-container-age');
        var latestAgeBox = getCachedElement('aft-latest-age-box');
        var latestQuantityBox = getCachedElement('aft-latest-quantity-box');
        if (!el) {
            return false;
        }
        try {
            if (panel && (el === panel || panel.contains(el))) {
                if (stepsContainer && (el === stepsContainer || stepsContainer.contains(el))) {
                    return false;
                }
                return true;
            }
            if (marker && (el === marker || marker.contains(el))) {
                return true;
            }
            if (picker && (el === picker || picker.contains(el))) {
                return true;
            }
            if (dataMatrixOverlay && (el === dataMatrixOverlay || dataMatrixOverlay.contains(el))) {
                return true;
            }
            if (latestAgeOverlay && (el === latestAgeOverlay || latestAgeOverlay.contains(el))) {
                return true;
            }
            if (latestAgeBox && (el === latestAgeBox || latestAgeBox.contains(el))) {
                return true;
            }
            if (latestQuantityBox && (el === latestQuantityBox || latestQuantityBox.contains(el))) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function isRelevantAftElement(el) {
        var id;
        while (el && el !== document) {
            if (isOwnUiElement(el)) {
                return false;
            }

            id = el.id || '';
            if (id === 'exception-wrapper' || id === 'exception-btn' || id === 'diversion-with-back' ||
                    id === 'text-entry' || id === 'scan-source-container' ||
                    id === 'scan-destination-container' || id === 'scan-container') {
                return true;
            }

            if (hasClass(el, 'steps-container') || hasClass(el, 'step-container') ||
                    hasClass(el, 'modal-message') || hasClass(el, 'modal-instruction') ||
                    hasClass(el, 'diversion-modal-action') || hasClass(el, 'exception-msg') ||
                    hasClass(el, 'warning-msg')) {
                return true;
            }

            el = el.parentNode;
        }
        return false;
    }

    function mutationTouchesRelevantAft(record) {
        var i;
        var node;

        if (isRelevantAftElement(nodeToElement(record.target))) {
            return true;
        }

        for (i = 0; record.addedNodes && i < record.addedNodes.length; i++) {
            node = nodeToElement(record.addedNodes[i]);
            if (isRelevantAftElement(node)) {
                return true;
            }
        }

        for (i = 0; record.removedNodes && i < record.removedNodes.length; i++) {
            node = nodeToElement(record.removedNodes[i]);
            if (isRelevantAftElement(node)) {
                return true;
            }
        }

        return false;
    }

    function startObserver() {
        try {
            var observer = new MutationObserver(function (records) {
                for (var i = 0; i < records.length; i++) {
                    if (mutationTouchesRelevantAft(records[i])) {
                        queueAutoActionLoop();
                        queueLayoutUpdate();
                        return;
                    }
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        } catch (e) {}
    }

    function isPeculiarInventoryPage() {
        try {
            return String(window.location && window.location.hostname || '').toLowerCase() ===
                'peculiar-inventory-eu.aka.corp.amazon.com';
        } catch (e) {
            return false;
        }
    }

    function getPeculiarSearchContainer() {
        var hash = '';
        var params;
        try {
            hash = String(window.location && window.location.hash || '').replace(/^#/, '');
            params = new URLSearchParams(hash);
            return trimText(params.get(PECULIAR_CONTAINER_HASH_KEY));
        } catch (e) {
            return '';
        }
    }

    function dispatchPeculiarSearchInputEvent(input, eventName) {
        var event;
        try {
            event = document.createEvent('Event');
            event.initEvent(eventName, true, true);
            input.dispatchEvent(event);
        } catch (e) {}
    }

    function submitPeculiarContainerSearch(containerId, remainingAttempts) {
        var input = document.getElementById('searchContainerInput');
        var button = document.getElementById('searchContainerButton');
        if (!input || !button) {
            if (remainingAttempts > 0) {
                window.setTimeout(function () {
                    submitPeculiarContainerSearch(containerId, remainingAttempts - 1);
                }, 100);
            }
            return;
        }
        input.value = containerId;
        dispatchPeculiarSearchInputEvent(input, 'input');
        dispatchPeculiarSearchInputEvent(input, 'change');
        window.setTimeout(function () {
            button.click();
        }, 100);
    }

    function startPeculiarContainerSearch() {
        var pathname = '';
        var containerId;
        if (!isPeculiarInventoryPage()) {
            return false;
        }
        try {
            pathname = String(window.location && window.location.pathname || '');
        } catch (e) {}
        if (!/^\/WRO1\/overview\/?$/i.test(pathname)) {
            return true;
        }
        containerId = getPeculiarSearchContainer();
        if (containerId) {
            window.setTimeout(function () {
                submitPeculiarContainerSearch(containerId, 20);
            }, 100);
        }
        return true;
    }

    function hasTargetMoveJobId() {
        var params;
        var search = '';
        try {
            params = new URLSearchParams(window.location && window.location.search ? window.location.search : '');
            return params.get('jobId') === '100';
        } catch (e) {
            try {
                search = String(window.location && window.location.search ? window.location.search : '');
            } catch (e2) {
                search = '';
            }
        }
        return /(?:[?&])jobId=100(?:&|$)/.test(search);
    }

    function startDarkStyleOnly() {
        installDarkModeStyle();
        setDarkModeClass(true);
    }

    function start() {
        if (startPeculiarContainerSearch()) {
            return;
        }
        if (!hasTargetMoveJobId()) {
            startDarkStyleOnly();
            return;
        }

        installNativeAftSoundBlocker();
        installAgeAlarmAudioUnlock();
        createScanButtonsPanel();
        initializeUserProfileSync();
        startObserver();
        try {
            window.addEventListener('resize', queueLayoutUpdate, false);
            window.addEventListener('scroll', queueLayoutUpdate, false);
            window.addEventListener('focus', queueRuntimeUpdate, false);
            window.addEventListener('online', queueRuntimeUpdate, false);
            document.addEventListener('visibilitychange', queueRuntimeUpdate, false);
            document.addEventListener('dragover', handleDocumentDragOver, true);
            document.addEventListener('drop', handleDocumentDrop, true);
            window.addEventListener('dragover', handleDocumentDragOver, true);
            window.addEventListener('drop', handleDocumentDrop, true);
        } catch (e) {}
        autoActionLoop();
        slowMaintenanceLoop();
        queueLayoutUpdate();
        window.setTimeout(queueAutoActionLoop, 250);
        window.setTimeout(queueAutoActionLoop, 1200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
