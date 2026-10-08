// ==UserScript==
// @name         Ticket Quick Replies
// @namespace    ticket-quick-replies
// @version      1.04
// @description  Quick replies and template groups for tickets.
// @icon         https://drive-render.corp.amazon.com/view/aolenche@/Icons/Ticket-Quick-Replies.png
// @author       aolenche
// @match        https://t.corp.amazon.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Ticket-Quick-Replies.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Ticket-Quick-Replies.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const storageKey = 'ticket-quick-replies-v1';
    const lastGroupKey = 'ticket-quick-replies-last-group';
    const fullscreenKey = 'ticket-quick-replies-fullscreen';
    const defaultGroupId = 'default';
    const editorSelector = '#sim-communicationActions--createComment';
    const buttonId = 'ticket-quick-replies-button';
    let data;
    let storageError = '';
    let selectedGroup = defaultGroupId;
    let query = '';
    let savedSelection = null;
    let returnFocus = null;
    let editing = false;
    let drag = null;
    let backdropPress = false;
    let suppressClickUntil = 0;
    const rowAnimations = new WeakMap();

    function readData() {
        const raw = GM_getValue(storageKey, null);
        if (raw === null) {
            return {
                version: 1,
                groups: [{ id: defaultGroupId, name: 'Ungrouped' }],
                replies: []
            };
        }
        return validateData(JSON.parse(raw));
    }

    function validateData(value) {
        if (!value || value.version !== 1 || !Array.isArray(value.groups) || !Array.isArray(value.replies)) {
            throw new Error('Unknown saved replies format.');
        }
        const groupIds = new Set();
        const replyIds = new Set();
        for (const group of value.groups) {
            if (!group || typeof group.id !== 'string' || !group.id || groupIds.has(group.id) ||
                typeof group.name !== 'string' || !group.name.trim()) {
                throw new Error('The saved group list is corrupted.');
            }
            groupIds.add(group.id);
        }
        if (!groupIds.has(defaultGroupId)) {
            throw new Error('The default group is missing.');
        }
        for (const reply of value.replies) {
            if (!reply || typeof reply.id !== 'string' || !reply.id || replyIds.has(reply.id) ||
                !groupIds.has(reply.groupId) || typeof reply.title !== 'string' || !reply.title.trim() ||
                typeof reply.text !== 'string' || !reply.text.trim()) {
                throw new Error('The saved reply list is corrupted.');
            }
            replyIds.add(reply.id);
        }
        return value;
    }

    function refreshData(restoreSelection = false) {
        try {
            data = readData();
            storageError = '';
            if (restoreSelection) selectedGroup = GM_getValue(lastGroupKey, defaultGroupId);
            if (!data.groups.some(group => group.id === selectedGroup)) {
                selectedGroup = defaultGroupId;
            }
        } catch (error) {
            storageError = `Could not load replies: ${error.message}`;
        }
    }

    function rememberGroup(id) {
        selectedGroup = id;
        try {
            GM_setValue(lastGroupKey, id);
        } catch (error) {
            message.textContent = `Could not remember the selected group: ${error.message}`;
        }
    }

    function commit(change) {
        try {
            const next = readData();
            change(next);
            GM_setValue(storageKey, JSON.stringify(next));
            data = next;
            storageError = '';
            return true;
        } catch (error) {
            message.textContent = `Could not save: ${error.message}`;
            return false;
        }
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(text, action, className = '', label = text) {
        const node = element('button', className, text);
        node.type = 'button';
        node.setAttribute('aria-label', label);
        node.title = label;
        node.addEventListener('click', action);
        return node;
    }

    const host = element('div');
    host.id = 'ticket-quick-replies-root';
    const root = host.attachShadow({ mode: 'open' });
    const style = element('style');
    style.textContent = `
        :host {
            color-scheme: var(--tqr-scheme, dark);
            font: 14px/20px var(--tqr-font, "Amazon Ember", "Helvetica Neue", Roboto, Arial, sans-serif);
            color: var(--tqr-text, #c6c6cd);
        }
        * { box-sizing: border-box; }
        dialog {
            width: min(940px, calc(100vw - 32px));
            max-height: calc(100vh - 40px);
            padding: 0;
            border: 1px solid var(--tqr-divider, #424650);
            border-radius: var(--tqr-radius, 16px);
            background: var(--tqr-surface, #161d26);
            color: inherit;
            box-shadow: 0 18px 70px #10233640;
        }
        dialog::backdrop { background: #0009; }
        dialog.fullscreen[open] {
            display: flex;
            flex-direction: column;
            width: 100vw;
            height: 100dvh;
            max-width: none;
            max-height: none;
            margin: 0;
            border-radius: 0;
        }
        .fullscreen > .header, .fullscreen > .tools,
        .fullscreen > .message, .fullscreen > .transfer-status { flex-shrink: 0; }
        .fullscreen .layout { flex: 1; min-height: 0; }
        .fullscreen .groups, .fullscreen .replies { max-height: none; min-height: 0; }
        .fullscreen .form { flex: 1; min-height: 0; max-height: none; }
        .fullscreen .reply-preview { display: block; -webkit-line-clamp: unset; overflow: visible; }
        .fullscreen .reply { align-content: start; }
        .header-actions { display: flex; align-items: center; gap: 16px; }
        .fullscreen-switch {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin: 0;
            font-size: 13px;
            font-weight: normal;
            cursor: pointer;
        }
        .fullscreen-switch input {
            appearance: none;
            display: block;
            width: 34px;
            height: 20px;
            margin: 0;
            padding: 2px;
            border-radius: 12px;
            background: var(--tqr-input, #161d26);
            cursor: pointer;
        }
        .fullscreen-switch input::before {
            content: '';
            display: block;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: var(--tqr-secondary, #c6c6cd);
            transition: transform 150ms ease;
        }
        .fullscreen-switch input:checked { background: var(--tqr-accent, #42b4ff); }
        .fullscreen-switch input:checked::before {
            transform: translateX(14px);
            background: var(--tqr-surface, #161d26);
        }
        dialog.confirmation { width: min(480px, calc(100vw - 32px)); padding: 24px; }
        .confirmation p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 16px 0 24px; }
        button, input, textarea, select { font: inherit; }
        button {
            padding: 4px 16px;
            border: 2px solid var(--tqr-accent, #42b4ff);
            border-radius: var(--tqr-button-radius, 20px);
            background: var(--tqr-surface, #161d26);
            color: var(--tqr-accent, #42b4ff);
            font-weight: 700;
            cursor: pointer;
        }
        button:hover { background: var(--tqr-selected, #001129); }
        button:disabled { opacity: .4; cursor: default; }
        button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
            outline: 2px solid var(--tqr-accent, #42b4ff);
            outline-offset: 2px;
        }
        .primary {
            background: var(--tqr-primary, #f90);
            border-color: var(--tqr-primary, #f90);
            color: var(--tqr-primary-text, #0f141a);
        }
        .primary:hover { background: var(--tqr-primary, #f90); filter: brightness(1.1); }
        .danger { color: var(--tqr-error, #ff7a7a); border-color: var(--tqr-error, #ff7a7a); }
        .header, .tools, .actions, .group-row, .reply-row, .group-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .header { justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--tqr-divider, #424650); }
        h2 { font-size: 20px; line-height: 24px; margin: 0; color: var(--tqr-heading, #ebebf0); }
        .tools { padding: 12px 20px; flex-wrap: wrap; }
        .search { flex: 1; min-width: 180px; }
        input, textarea, select {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid var(--tqr-input-border, #656871);
            border-radius: 8px;
            background: var(--tqr-input, #161d26);
            color: var(--tqr-text, #c6c6cd);
        }
        .layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 260px; }
        .groups { background: var(--tqr-layout, #0d1117); padding: 12px; border-right: 1px solid var(--tqr-divider, #424650); }
        .groups, .replies { overflow: auto; max-height: min(52vh, 480px); }
        .group-row { margin-bottom: 5px; }
        .group-name { flex: 1; text-align: left; overflow-wrap: anywhere; }
        .group-name[aria-pressed="true"] { background: var(--tqr-selected, #001129); border-color: var(--tqr-accent, #42b4ff); }
        .count { font-size: 12px; color: var(--tqr-secondary, #c6c6cd); }
        .group-actions {
            margin-top: 10px;
            padding: 8px;
            gap: 4px;
            border: 1px solid var(--tqr-divider, #424650);
            border-radius: 8px;
            background: var(--tqr-surface, #161d26);
        }
        .group-caption {
            flex: 1;
            font-size: 12px;
            color: var(--tqr-secondary, #c6c6cd);
        }
        .group-actions button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            padding: 5px;
            border: 1px solid transparent;
            border-radius: 6px;
            color: var(--tqr-secondary, #c6c6cd);
        }
        .group-actions button:hover {
            color: var(--tqr-accent, #42b4ff);
            border-color: var(--tqr-divider, #424650);
        }
        .group-actions .danger:hover { color: var(--tqr-error, #ff7a7a); }
        .group-actions svg { width: 16px; height: 16px; }
        .replies {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-content: start;
            gap: 12px;
            padding: 12px 16px;
        }
        .reply-row {
            position: relative;
            display: block;
            min-width: 0;
            min-height: 124px;
            border: 1px solid var(--tqr-input-border, #656871);
            border-radius: 8px;
            background: var(--tqr-surface, #161d26);
        }
        .reply-row:hover { border-color: var(--tqr-accent, #42b4ff); }
        .reply {
            display: block;
            width: 100%;
            height: 100%;
            min-width: 0;
            padding: 12px;
            text-align: left;
            border: 0;
            border-radius: 8px;
            color: var(--tqr-text, #c6c6cd);
        }
        .reply-title {
            display: block;
            min-height: 20px;
            padding-left: 24px;
            padding-right: 56px;
            font-weight: bold;
            overflow-wrap: anywhere;
        }
        .reply-preview {
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            margin-top: 10px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            color: var(--tqr-secondary, #c6c6cd);
            font-size: 13px;
            font-weight: 400;
        }
        .reply-actions {
            position: absolute;
            top: 8px;
            right: 8px;
            display: flex;
            gap: 4px;
        }
        .reply-actions button {
            width: 24px;
            height: 24px;
            padding: 2px;
            border: 0;
            border-radius: 4px;
            background: transparent;
        }
        .reply-actions button:hover { background: var(--tqr-selected, #001129); }
        .reply-row > .drag-handle {
            position: absolute;
            top: 8px;
            left: 8px;
            width: 24px;
            height: 24px;
            z-index: 1;
        }
        .drag-handle {
            flex: 0 0 auto;
            align-self: center;
            padding: 4px;
            border: 0;
            background: transparent;
            color: var(--tqr-secondary, #c6c6cd);
            cursor: grab;
            touch-action: none;
        }
        .drag-row > .reply, .drag-row > .group-name { cursor: grab; touch-action: none; }
        .drag-row { transition: opacity 120ms ease; }
        .drag-origin { opacity: .35; outline: 2px dashed var(--tqr-accent, #42b4ff); outline-offset: -2px; border-radius: 8px; }
        .drag-ghost {
            position: fixed;
            left: 0;
            top: 0;
            z-index: 10;
            margin: 0;
            padding: 5px;
            border-radius: 8px;
            background: var(--tqr-surface, #161d26);
            box-shadow: 0 8px 24px #0006;
            opacity: .95;
            pointer-events: none;
            will-change: transform;
        }
        .drop-target { outline: 2px solid var(--tqr-accent, #42b4ff); border-radius: 8px; background: var(--tqr-selected, #001129); }
        .drag-active, .drag-active * { user-select: none; cursor: grabbing !important; }
        .drag-handle:disabled { cursor: default; }
        .empty { grid-column: 1 / -1; color: var(--tqr-secondary, #c6c6cd); padding: 16px 0; }
        .form { padding: 16px 20px; border-top: 1px solid var(--tqr-divider, #424650); max-height: 65vh; overflow: auto; }
        .form[hidden], .layout[hidden], .tools[hidden] { display: none; }
        label { display: block; margin-bottom: 12px; font-weight: bold; }
        label input, label textarea, label select { display: block; margin-top: 4px; font-weight: normal; }
        .new-group-field[hidden] { display: none; }
        .form textarea { min-height: 150px; max-height: 30vh; resize: vertical; }
        .actions { justify-content: flex-end; }
        .message { margin: 0; padding: 0 20px 10px; color: var(--tqr-error, #ff7a7a); font-size: 14px; white-space: pre-wrap; }
        .message:empty { display: none; }
        .transfer-actions {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }
        .transfer-actions[hidden] { display: none; }
        .transfer-status { padding: 0 20px 8px; color: var(--tqr-secondary, #c6c6cd); font-size: 12px; }
        .transfer-status:empty { display: none; }
        @media (max-width: 640px) {
            .layout { grid-template-columns: 1fr; }
            .groups { max-height: 160px; border-right: 0; border-bottom: 1px solid var(--tqr-divider, #424650); }
            .replies { grid-template-columns: 1fr; max-height: 35vh; }
            .tools, .header, .form { padding-left: 12px; padding-right: 12px; }
            .fullscreen .layout { grid-template-rows: auto minmax(0, 1fr); }
            .fullscreen .groups { max-height: 25dvh; }
            .header-actions { gap: 8px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .fullscreen-switch input::before { transition: none; }
        }
    `;
    const dialog = element('dialog');
    dialog.setAttribute('aria-labelledby', 'tqr-title');
    const header = element('div', 'header');
    const heading = element('h2', '', 'Replies');
    heading.id = 'tqr-title';
    const headerActions = element('div', 'header-actions');
    const fullscreenLabel = element('label', 'fullscreen-switch');
    const fullscreenToggle = element('input');
    fullscreenToggle.type = 'checkbox';
    fullscreenToggle.setAttribute('role', 'switch');
    fullscreenToggle.setAttribute('aria-label', 'Full screen');
    fullscreenToggle.addEventListener('change', () => {
        cancelDrag();
        dialog.classList.toggle('fullscreen', fullscreenToggle.checked);
        try {
            GM_setValue(fullscreenKey, fullscreenToggle.checked);
        } catch (error) {
            message.textContent = `Could not remember full screen: ${error.message}`;
        }
    });
    fullscreenLabel.append(fullscreenToggle, element('span', '', 'Full screen'));
    headerActions.append(fullscreenLabel, button('✕', () => dialog.close(), '', 'Close'));
    header.append(heading, headerActions);
    const tools = element('div', 'tools');
    const search = element('input', 'search');
    search.type = 'search';
    search.placeholder = 'Search this group';
    search.setAttribute('aria-label', 'Search replies');
    search.addEventListener('input', () => {
        query = search.value.trim().toLocaleLowerCase();
        renderReplies();
    });
    const addReply = button('+ Reply', () => editReply(), 'primary');
    const addGroup = button('+ Group', () => editGroup());
    tools.append(search, addReply, addGroup);
    const layout = element('div', 'layout');
    const groups = element('nav', 'groups');
    groups.setAttribute('aria-label', 'Reply groups');
    const replies = element('div', 'replies');
    layout.append(groups, replies);
    const form = element('form', 'form');
    form.hidden = true;
    const message = element('p', 'message');
    message.setAttribute('role', 'alert');
    const transfer = element('div', 'transfer-actions');
    const transferStatus = element('span', 'transfer-status');
    transferStatus.setAttribute('aria-live', 'polite');
    const fileInput = element('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    const exportButton = button('Export', exportReplies, '', 'Export all groups and replies');
    const importButton = button('Import', () => fileInput.click(), '', 'Import groups and replies from a file');
    fileInput.addEventListener('change', importReplies);
    transfer.append(exportButton, importButton, fileInput);
    tools.append(transfer);
    dialog.append(header, tools, transferStatus, message, layout, form);
    const confirmation = element('dialog', 'confirmation');
    confirmation.setAttribute('aria-labelledby', 'tqr-confirm-title');
    confirmation.setAttribute('aria-describedby', 'tqr-confirm-text');
    const confirmationTitle = element('h2');
    confirmationTitle.id = 'tqr-confirm-title';
    const confirmationText = element('p');
    confirmationText.id = 'tqr-confirm-text';
    const confirmationActions = element('div', 'actions');
    const confirmationCancel = button('Cancel', () => finishConfirmation(false));
    const confirmationAccept = button('Confirm', () => finishConfirmation(true), 'primary');
    confirmationActions.append(confirmationCancel, confirmationAccept);
    confirmation.append(confirmationTitle, confirmationText, confirmationActions);
    let pendingConfirmation = null;
    let confirmationFocus = null;
    let confirmationBackdrop = false;
    confirmation.addEventListener('cancel', event => {
        event.preventDefault();
        finishConfirmation(false);
    });
    confirmation.addEventListener('pointerdown', event => {
        confirmationBackdrop = event.button === 0 && event.target === confirmation && outsideConfirmation(event);
    });
    confirmation.addEventListener('pointercancel', () => { confirmationBackdrop = false; });
    confirmation.addEventListener('click', event => {
        if (confirmationBackdrop && event.target === confirmation && outsideConfirmation(event)) finishConfirmation(false);
        confirmationBackdrop = false;
    });
    confirmation.addEventListener('keydown', event => event.stopPropagation());
    root.append(style, dialog, confirmation);
    document.body.append(host);

    function outsideConfirmation(event) {
        const rect = confirmation.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom;
    }

    function askConfirmation(title, text, accept, destructive = false) {
        if (pendingConfirmation || !dialog.open) return Promise.resolve(false);
        cancelDrag();
        confirmationTitle.textContent = title;
        confirmationText.textContent = text;
        confirmationAccept.textContent = accept;
        confirmationAccept.setAttribute('aria-label', accept);
        confirmationAccept.title = accept;
        confirmationAccept.className = destructive ? 'danger' : 'primary';
        confirmationFocus = root.activeElement;
        confirmationBackdrop = false;
        return new Promise(resolve => {
            pendingConfirmation = resolve;
            confirmation.showModal();
            confirmationCancel.focus();
        });
    }

    function finishConfirmation(accepted) {
        const resolve = pendingConfirmation;
        pendingConfirmation = null;
        if (confirmation.open) confirmation.close();
        if (dialog.open && confirmationFocus && confirmationFocus.isConnected) confirmationFocus.focus();
        confirmationFocus = null;
        if (resolve) resolve(accepted);
    }

    function exportReplies() {
        let url;
        let link;
        try {
            const saved = readData();
            const lastGroupId = GM_getValue(lastGroupKey, defaultGroupId);
            const backup = {
                type: 'Ticket Quick Replies',
                schemaVersion: 1,
                exportedAt: new Date().toISOString(),
                data: saved,
                lastGroupId: saved.groups.some(group => group.id === lastGroupId) ? lastGroupId : defaultGroupId
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
            url = URL.createObjectURL(blob);
            link = element('a');
            link.href = url;
            const date = new Date().toLocaleDateString('en-CA');
            link.download = `replies-${date}.json`;
            link.hidden = true;
            dialog.append(link);
            link.click();
            message.textContent = '';
            transferStatus.textContent = 'Export file created.';
        } catch (error) {
            message.textContent = `Could not export replies: ${error.message}`;
        } finally {
            if (link) link.remove();
            if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    async function importReplies() {
        const file = fileInput.files[0];
        if (!file) return;
        importButton.disabled = true;
        transferStatus.textContent = '';
        try {
            const before = GM_getValue(storageKey, null);
            if (file.size > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB.');
            const backup = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
            if (!backup || backup.type !== 'Ticket Quick Replies' || backup.schemaVersion !== 1) {
                throw new Error('Select a Ticket Quick Replies export file.');
            }
            const imported = validateData(backup.data);
            if (!dialog.open) return;
            const prompt = `Import ${imported.replies.length} replies in ${imported.groups.length} groups? ` +
                'This will replace all current groups and replies. Export your current list first if you want to keep it.';
            if (!await askConfirmation('Import replies', prompt, 'Replace replies')) return;
            if (!dialog.open) return;
            if (GM_getValue(storageKey, null) !== before) {
                throw new Error('Your replies changed while the file was being read. Import the file again.');
            }
            GM_setValue(storageKey, JSON.stringify(imported));
            data = imported;
            storageError = '';
            rememberGroup(imported.groups.some(group => group.id === backup.lastGroupId) ? backup.lastGroupId : defaultGroupId);
            query = '';
            search.value = '';
            render();
            transferStatus.textContent = `Imported ${imported.replies.length} replies.`;
        } catch (error) {
            message.textContent = `Could not import replies: ${error.message}`;
        } finally {
            fileInput.value = '';
            importButton.disabled = false;
        }
    }

    function moveEntry(items, id, direction, filter = () => true) {
        const ordered = items.filter(filter);
        const index = ordered.findIndex(item => item.id === id);
        const other = ordered[index + direction];
        if (index < 0 || !other) return;
        const from = items.findIndex(item => item.id === id);
        const to = items.findIndex(item => item.id === other.id);
        [items[from], items[to]] = [items[to], items[from]];
    }

    function groupName(group) {
        return group.id === defaultGroupId && group.name === 'Без групи' ? 'Ungrouped' : group.name;
    }

    function groupAction(label, action, path, className = '') {
        const control = button('', action, className, label);
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.8');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');
        icon.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', path);
        icon.append(shape);
        control.append(icon);
        return control;
    }

    function render() {
        message.textContent = storageError;
        addReply.disabled = !!storageError;
        addGroup.disabled = !!storageError;
        exportButton.disabled = !!storageError;
        groups.replaceChildren();
        replies.replaceChildren();
        if (storageError) return;
        if (!data.groups.some(group => group.id === selectedGroup)) selectedGroup = defaultGroupId;
        for (const group of data.groups) {
            const row = element('div', 'group-row');
            enableDrag(row, 'group', group.id);
            const select = button(groupName(group), () => {
                rememberGroup(group.id);
                render();
            }, 'group-name');
            select.setAttribute('aria-pressed', String(group.id === selectedGroup));
            row.append(dragHandle('group', group.id, groupName(group)), select,
                element('span', 'count', String(data.replies.filter(reply => reply.groupId === group.id).length)));
            groups.append(row);
        }
        const controls = element('div', 'group-actions');
        controls.setAttribute('role', 'toolbar');
        controls.setAttribute('aria-label', 'Group options');
        const current = data.groups.find(group => group.id === selectedGroup);
        controls.append(element('span', 'group-caption', 'Group options'),
            groupAction('Rename group', () => editGroup(current), 'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z'));
        if (current.id !== defaultGroupId) {
            controls.append(groupAction('Delete group', () => deleteGroup(current),
                'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', 'danger'));
        }
        groups.append(controls);
        renderReplies();
    }

    function reorderGroup(direction) {
        if (commit(next => moveEntry(next.groups, selectedGroup, direction))) render();
    }

    function renderReplies() {
        replies.replaceChildren();
        if (storageError) return;
        const ordered = data.replies.filter(reply => reply.groupId === selectedGroup);
        const visible = ordered.filter(reply => `${reply.title}\n${reply.text}`.toLocaleLowerCase().includes(query));
        if (!visible.length) {
            replies.append(element('p', 'empty', query ? 'No replies found.' : 'This group has no replies yet. Click “+ Reply” to add one.'));
        }
        for (const reply of visible) {
            const row = element('div', 'reply-row');
            enableDrag(row, 'reply', reply.id);
            const insert = button('', () => insertReply(reply.id), 'reply', `Insert: ${reply.title}`);
            insert.append(element('span', 'reply-title', reply.title), element('span', 'reply-preview', reply.text));
            const actions = element('div', 'reply-actions');
            actions.append(
                button('✎', () => editReply(reply), '', `Edit: ${reply.title}`),
                button('✕', () => deleteReply(reply), 'danger', `Delete: ${reply.title}`)
            );
            row.append(dragHandle('reply', reply.id, reply.title), insert, actions);
            replies.append(row);
        }
    }

    function reorderReply(id, direction) {
        if (commit(next => {
            const reply = next.replies.find(item => item.id === id);
            if (!reply) throw new Error('This reply was deleted in another tab.');
            moveEntry(next.replies, id, direction, item => item.groupId === reply.groupId);
        })) render();
    }

    function dragHandle(kind, id, title) {
        const handle = button('⠿', () => {}, 'drag-handle', `Drag: ${title}`);
        handle.title = 'Drag to move. Use Alt+↑ / Alt+↓ with the keyboard.';
        handle.disabled = kind === 'reply' && !!query;
        handle.addEventListener('keydown', event => {
            if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? -1 : 1;
            if (kind === 'group') {
                rememberGroup(id);
                reorderGroup(direction);
            } else {
                reorderReply(id, direction);
            }
            const row = Array.from(root.querySelectorAll('.drag-row')).find(item => item.dataset.sortId === id);
            if (row) row.querySelector('.drag-handle').focus();
        });
        return handle;
    }

    function sortableRows(container) {
        return Array.from(container.children).filter(row => row.classList.contains('drag-row'));
    }

    function animateRows(container, change) {
        const rows = sortableRows(container);
        const before = new Map(rows.map(row => [row, row.getBoundingClientRect()]));
        for (const row of rows) {
            const animation = rowAnimations.get(row);
            if (animation) animation.cancel();
        }
        change();
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        for (const row of rows) {
            const old = before.get(row);
            const next = row.getBoundingClientRect();
            const dx = old.left - next.left;
            const dy = old.top - next.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            rowAnimations.set(row, row.animate([
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0, 0)' }
            ], { duration: 170, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }));
        }
    }

    function enableDrag(row, kind, id) {
        row.classList.add('drag-row');
        row.dataset.sortId = id;
        row.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !event.isPrimary || drag || editing || storageError) return;
            if (kind === 'reply' && query) return;
            if (!event.target.closest('.drag-handle, .reply, .group-name')) return;
            drag = {
                row, kind, id, pointerId: event.pointerId,
                container: kind === 'group' ? groups : replies,
                groupId: selectedGroup,
                x: event.clientX, y: event.clientY,
                startX: event.clientX, startY: event.clientY,
                active: false, valid: false, targetGroup: null, frame: 0
            };
            window.addEventListener('pointermove', trackDrag, true);
            window.addEventListener('pointerup', dropDrag, true);
            window.addEventListener('pointercancel', cancelDrag, true);
            window.addEventListener('blur', cancelDrag);
        });
    }

    function trackDrag(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
        event.preventDefault();
        if (!drag.active) {
            drag.active = true;
            const rect = drag.row.getBoundingClientRect();
            drag.offsetX = drag.startX - rect.left;
            drag.offsetY = drag.startY - rect.top;
            drag.ghost = drag.row.cloneNode(true);
            drag.ghost.classList.remove('drag-row');
            drag.ghost.classList.add('drag-ghost');
            drag.ghost.removeAttribute('data-sort-id');
            drag.ghost.setAttribute('aria-hidden', 'true');
            drag.ghost.inert = true;
            drag.ghost.style.width = `${rect.width}px`;
            dialog.append(drag.ghost);
            drag.row.classList.add('drag-origin');
            dialog.classList.add('drag-active');
            drag.frame = requestAnimationFrame(dragFrame);
        }
    }

    function updateDropTarget() {
        if (!drag || !drag.active) return;
        for (const target of groups.querySelectorAll('.drop-target')) target.classList.remove('drop-target');
        drag.targetGroup = null;
        drag.valid = false;
        const hit = root.elementFromPoint(drag.x, drag.y);
        const groupRow = hit && hit.closest('.group-row');
        if (drag.kind === 'reply' && groupRow && groups.contains(groupRow)) {
            drag.targetGroup = groupRow.dataset.sortId;
            drag.valid = true;
            groupRow.classList.add('drop-target');
            return;
        }
        const bounds = drag.container.getBoundingClientRect();
        if (drag.x < bounds.left || drag.x > bounds.right || drag.y < bounds.top || drag.y > bounds.bottom) return;
        drag.valid = true;
        if (drag.kind === 'reply') {
            const rows = sortableRows(replies);
            const from = rows.indexOf(drag.row);
            let targetIndex = from;
            let nearest = Infinity;
            rows.forEach((row, index) => {
                const rect = row.getBoundingClientRect();
                const transform = new DOMMatrix(getComputedStyle(row).transform);
                const x = rect.left - transform.m41 + rect.width / 2;
                const y = rect.top - transform.m42 + rect.height / 2;
                const distance = ((drag.x - x) / rect.width) ** 2 + ((drag.y - y) / rect.height) ** 2;
                if (distance < nearest) {
                    nearest = distance;
                    targetIndex = index;
                }
            });
            if (targetIndex !== from) {
                const target = rows[targetIndex];
                const reference = targetIndex < from ? target : target.nextElementSibling;
                animateRows(replies, () => replies.insertBefore(drag.row, reference));
            }
            return;
        }
        const ordered = sortableRows(drag.container).filter(row => row !== drag.row);
        const next = ordered.find(row => {
            const animation = rowAnimations.get(row);
            const rect = row.getBoundingClientRect();
            const transform = animation ? new DOMMatrix(getComputedStyle(row).transform).m42 : 0;
            return drag.y < rect.top - transform + rect.height / 2;
        });
        const reference = next || (drag.kind === 'group' ? groups.querySelector('.group-actions') : null);
        if (drag.row.nextElementSibling !== reference) {
            animateRows(drag.container, () => drag.container.insertBefore(drag.row, reference));
        }
    }

    function dragFrame() {
        if (!drag || !drag.active) return;
        drag.ghost.style.transform = `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0)`;
        const bounds = drag.container.getBoundingClientRect();
        if (drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom) {
            const edge = 36;
            const speed = drag.y < bounds.top + edge ? -(bounds.top + edge - drag.y) / 3 :
                drag.y > bounds.bottom - edge ? (drag.y - bounds.bottom + edge) / 3 : 0;
            drag.container.scrollTop += speed;
        }
        updateDropTarget();
        drag.frame = requestAnimationFrame(dragFrame);
    }

    function cleanupDrag() {
        const current = drag;
        drag = null;
        window.removeEventListener('pointermove', trackDrag, true);
        window.removeEventListener('pointerup', dropDrag, true);
        window.removeEventListener('pointercancel', cancelDrag, true);
        window.removeEventListener('blur', cancelDrag);
        if (!current) return null;
        cancelAnimationFrame(current.frame);
        if (current.ghost) current.ghost.remove();
        current.row.classList.remove('drag-origin');
        dialog.classList.remove('drag-active');
        for (const target of groups.querySelectorAll('.drop-target')) target.classList.remove('drop-target');
        if (current.active) suppressClickUntil = performance.now() + 350;
        return current;
    }

    function cancelDrag() {
        const current = cleanupDrag();
        if (current && current.active) render();
    }

    function dropDrag(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        updateDropTarget();
        const current = cleanupDrag();
        if (!current.active) return;
        event.preventDefault();
        event.stopPropagation();
        if (!current.valid) {
            render();
            return;
        }
        const ordered = sortableRows(current.container);
        const index = ordered.indexOf(current.row);
        const beforeId = ordered[index + 1]?.dataset.sortId || null;
        const success = commit(next => {
            const items = current.kind === 'group' ? next.groups : next.replies;
            const from = items.findIndex(item => item.id === current.id);
            if (from < 0) throw new Error('This item was deleted in another tab.');
            const item = items[from];
            if (current.kind === 'reply' && item.groupId !== current.groupId) {
                throw new Error('This reply was moved in another tab. Reopen the list.');
            }
            if (current.targetGroup && current.targetGroup !== current.groupId) {
                if (!next.groups.some(group => group.id === current.targetGroup)) throw new Error('This group was deleted.');
                item.groupId = current.targetGroup;
                items.splice(from, 1);
                items.push(item);
            } else {
                if (beforeId && !items.some(other => other.id === beforeId &&
                    (current.kind === 'group' || other.groupId === current.groupId))) {
                    throw new Error('The order changed in another tab. Reopen the list.');
                }
                items.splice(from, 1);
                const target = beforeId ? items.findIndex(other => other.id === beforeId) : items.length;
                items.splice(target, 0, item);
            }
        });
        if (!success) {
            const error = message.textContent;
            render();
            message.textContent = error;
        } else if (current.targetGroup && current.targetGroup !== current.groupId) {
            render();
        }
    }

    dialog.addEventListener('click', event => {
        if (performance.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    async function deleteReply(reply) {
        if (!await askConfirmation('Delete reply', `Delete “${reply.title}”?`, 'Delete', true)) return;
        if (!dialog.open) return;
        if (commit(next => {
            next.replies = next.replies.filter(item => item.id !== reply.id);
        })) render();
    }

    async function deleteGroup(group) {
        const text = `Delete “${group.name}”? Its replies will be moved to the default group.`;
        if (!await askConfirmation('Delete group', text, 'Delete', true)) return;
        if (!dialog.open) return;
        if (commit(next => {
            next.groups = next.groups.filter(item => item.id !== group.id);
            for (const reply of next.replies) {
                if (reply.groupId === group.id) reply.groupId = defaultGroupId;
            }
        })) {
            rememberGroup(defaultGroupId);
            render();
        }
    }

    function field(text, control) {
        const label = element('label', '', text);
        label.append(control);
        form.append(label);
        return control;
    }

    function beginForm(title) {
        editing = true;
        form.replaceChildren(element('h2', '', title));
        form.hidden = false;
        layout.hidden = true;
        tools.hidden = true;
        transfer.hidden = true;
        message.textContent = '';
    }

    function endForm() {
        editing = false;
        form.hidden = true;
        layout.hidden = false;
        tools.hidden = false;
        transfer.hidden = false;
        form.onsubmit = null;
        refreshData();
        render();
        search.focus();
    }

    function formActions(save) {
        const actions = element('div', 'actions');
        const submit = element('button', 'primary', 'Save');
        submit.type = 'submit';
        actions.append(button('Cancel', endForm), submit);
        form.append(actions);
        form.onsubmit = event => {
            event.preventDefault();
            save();
        };
    }

    function editGroup(group = null) {
        beginForm(group ? 'Group name' : 'New group');
        const name = field('Name', element('input'));
        name.required = true;
        name.maxLength = 100;
        name.value = group ? groupName(group) : '';
        formActions(() => {
            const title = name.value.trim();
            if (!title) {
                message.textContent = 'Enter a group name.';
                name.focus();
                return;
            }
            const id = group ? group.id : crypto.randomUUID();
            if (commit(next => {
                if (group) {
                    const existing = next.groups.find(item => item.id === id);
                    if (!existing) throw new Error('This group was deleted in another tab.');
                    if (existing.name !== group.name) throw new Error('The name changed in another tab. Cancel editing and reopen the group.');
                    existing.name = title;
                } else {
                    next.groups.push({ id, name: title });
                }
            })) {
                rememberGroup(id);
                endForm();
            }
        });
        name.focus();
    }

    function editReply(reply = null) {
        beginForm(reply ? 'Edit reply' : 'New reply');
        const title = field('Title', element('input'));
        title.required = true;
        title.maxLength = 200;
        title.value = reply ? reply.title : '';
        const group = field('Group', element('select'));
        for (const item of data.groups) {
            const option = element('option', '', groupName(item));
            option.value = item.id;
            group.append(option);
        }
        const createGroupOption = element('option', '', '+ New group…');
        createGroupOption.value = '';
        group.append(createGroupOption);
        group.value = reply ? reply.groupId : selectedGroup;
        const newGroupName = field('New group name', element('input', 'new-group-name'));
        newGroupName.maxLength = 100;
        newGroupName.placeholder = 'Enter a group name';
        newGroupName.disabled = true;
        newGroupName.parentElement.className = 'new-group-field';
        newGroupName.parentElement.hidden = true;
        group.addEventListener('change', () => {
            const creating = group.value === '';
            newGroupName.parentElement.hidden = !creating;
            newGroupName.disabled = !creating;
            newGroupName.required = creating;
            message.textContent = '';
            if (creating) newGroupName.focus();
        });
        const text = field('Reply text', element('textarea'));
        text.required = true;
        text.value = reply ? reply.text : '';
        formActions(() => {
            if (!title.value.trim() || !text.value.trim()) {
                message.textContent = 'Enter a title and reply text.';
                return;
            }
            const creatingGroup = group.value === '';
            const groupNameValue = newGroupName.value.trim();
            if (creatingGroup && !groupNameValue) {
                message.textContent = 'Enter a group name.';
                newGroupName.focus();
                return;
            }
            const updated = {
                id: reply ? reply.id : crypto.randomUUID(),
                groupId: creatingGroup ? crypto.randomUUID() : group.value,
                title: title.value.trim(),
                text: text.value
            };
            if (commit(next => {
                if (creatingGroup) next.groups.push({ id: updated.groupId, name: groupNameValue });
                if (!next.groups.some(item => item.id === updated.groupId)) {
                    throw new Error('The selected group was deleted. Cancel editing and reopen the reply.');
                }
                if (reply) {
                    const index = next.replies.findIndex(item => item.id === reply.id);
                    if (index < 0) throw new Error('This reply was deleted in another tab.');
                    const existing = next.replies[index];
                    if (existing.title !== reply.title || existing.text !== reply.text || existing.groupId !== reply.groupId) {
                        throw new Error('This reply changed in another tab. Cancel editing and reopen it.');
                    }
                    if (existing.groupId === updated.groupId) {
                        next.replies[index] = updated;
                    } else {
                        next.replies.splice(index, 1);
                        next.replies.push(updated);
                    }
                } else {
                    next.replies.push(updated);
                }
            })) {
                rememberGroup(updated.groupId);
                endForm();
            }
        });
        title.focus();
    }

    function insertReply(id) {
        refreshData();
        if (storageError) {
            message.textContent = storageError;
            return;
        }
        const reply = data.replies.find(item => item.id === id);
        const editor = document.querySelector(editorSelector);
        if (!reply || !editor || editor.disabled || editor.readOnly || !editor.getClientRects().length) {
            message.textContent = 'The reply or ticket editor is no longer available. Reopen the list.';
            return;
        }
        const previous = editor.value;
        const useSaved = savedSelection && savedSelection.editor === editor && savedSelection.value === previous;
        const start = useSaved ? savedSelection.start : editor.selectionStart;
        const end = useSaved ? savedSelection.end : editor.selectionEnd;
        const next = previous.slice(0, start) + reply.text + previous.slice(end);
        if (editor.maxLength >= 0 && next.length > editor.maxLength) {
            message.textContent = 'The text exceeds the ticket editor’s maximum length.';
            return;
        }
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(editor, next);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        rememberGroup(reply.groupId);
        dialog.close();
        editor.focus();
        const caret = start + reply.text.length;
        editor.setSelectionRange(caret, caret);
    }

    function openDialog() {
        const editor = document.querySelector(editorSelector);
        if (!editor || editor.disabled || editor.readOnly) return;
        if (dialog.open) return;
        backdropPress = false;
        savedSelection = {
            editor,
            value: editor.value,
            start: editor.selectionStart,
            end: editor.selectionEnd
        };
        returnFocus = document.activeElement;
        syncTheme(editor);
        fullscreenToggle.checked = GM_getValue(fullscreenKey, false) === true;
        dialog.classList.toggle('fullscreen', fullscreenToggle.checked);
        refreshData(true);
        render();
        dialog.showModal();
        search.focus();
    }

    function outsideDialog(event) {
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom;
    }

    dialog.addEventListener('pointerdown', event => {
        backdropPress = event.button === 0 && event.target === dialog && !drag && outsideDialog(event);
    });
    dialog.addEventListener('pointercancel', () => {
        backdropPress = false;
    });
    dialog.addEventListener('click', event => {
        const startedOutside = backdropPress;
        backdropPress = false;
        if (startedOutside && !drag && event.target === dialog && outsideDialog(event)) dialog.close();
    });

    dialog.addEventListener('cancel', event => {
        if (drag) {
            event.preventDefault();
            cancelDrag();
            return;
        }
        if (editing) {
            event.preventDefault();
            endForm();
        }
    });
    dialog.addEventListener('close', () => {
        finishConfirmation(false);
        cancelDrag();
        if (editing) endForm();
        if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    });
    dialog.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.preventDefault();
    });

    function mountButton() {
        const editor = document.querySelector(editorSelector);
        const post = document.querySelector('.sim-communicationActions--addCommentButton');
        const current = document.getElementById(buttonId);
        if (!editor || !post) {
            if (current) current.remove();
            if (dialog.open) dialog.close();
            return;
        }
        const actionSlot = post.parentElement;
        if (current && current.parentElement === actionSlot) {
            current.disabled = editor.disabled || editor.readOnly;
            return;
        }
        if (current) current.remove();
        const trigger = button('Replies', openDialog);
        const normal = Array.from(post.closest('.sim-communicationActions--editor').querySelectorAll('button'))
            .find(node => node !== post && !node.id.startsWith('ticket-quick-replies'));
        if (normal) {
            trigger.className = Array.from(normal.classList).filter(name => !name.includes('disabled')).join(' ');
        }
        trigger.id = buttonId;
        trigger.disabled = editor.disabled || editor.readOnly;
        trigger.style.marginRight = '10px';
        actionSlot.insertBefore(trigger, post);
    }

    function syncTheme(editor) {
        const computed = getComputedStyle(editor);
        const names = Array.from(computed).filter(name => name.startsWith('--'));
        const tokens = {
            surface: 'color-background-container-content',
            layout: 'color-background-layout-main',
            input: 'color-background-input-default',
            text: 'color-text-body-default',
            heading: 'color-text-heading-default',
            secondary: 'color-text-body-secondary',
            accent: 'color-text-button-normal-default',
            primary: 'color-background-button-primary-default',
            'primary-text': 'color-text-button-primary-default',
            divider: 'color-border-divider-default',
            'input-border': 'color-border-input-default',
            selected: 'color-background-item-selected',
            error: 'color-text-status-error',
            radius: 'border-radius-container',
            'button-radius': 'border-radius-button'
        };
        for (const [key, prefix] of Object.entries(tokens)) {
            const name = names.find(item => item === `--${prefix}` || item.startsWith(`--${prefix}-`));
            if (name) host.style.setProperty(`--tqr-${key}`, computed.getPropertyValue(name).trim());
        }
        host.style.setProperty('--tqr-font', computed.fontFamily);
        host.style.setProperty('--tqr-scheme', document.body.classList.contains('awsui-polaris-dark-mode') ? 'dark' : 'light');
    }

    GM_addValueChangeListener(storageKey, (name, oldValue, newValue, remote) => {
        if (!remote || !dialog.open) return;
        if (drag) cancelDrag();
        if (editing) {
            message.textContent = 'The list changed in another tab. Your unsaved edits are still in the form.';
            return;
        }
        refreshData();
        render();
    });

    let mountQueued = false;
    const observer = new MutationObserver(() => {
        if (mountQueued) return;
        mountQueued = true;
        requestAnimationFrame(() => {
            mountQueued = false;
            mountButton();
        });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly'] });
    refreshData();
    mountButton();
})();
