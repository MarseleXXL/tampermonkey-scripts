// ==UserScript==
// @name         Dark mods FCresearch
// @namespace    http://tampermonkey.net/
// @version      1.04
// @author       aolenche
// @match        https://fcresearch-eu.aka.amazon.com/*
// @match        http://fcresearch-eu.aka.amazon.com/*
// @match        https://qi-fcresearch-eu.corp.amazon.com/*
// @match        http://qi-fcresearch-eu.corp.amazon.com/*
// @exclude      http://fcresearch-eu.aka.amazon.com/?toteDetails=1
// @exclude      https://fcresearch-eu.aka.amazon.com/*fcrcost=1*
// @icon         https://drive-render.corp.amazon.com/view/aolenche@/Icons/Dark_mods_FCResearch.png
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Dark-mods-FCresearch.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Dark-mods-FCresearch.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==
// ==/UserScript==

(function() {
    'use strict';

    const earlyThemeStyle = injectEarlyTheme();
    const earlyThemeFallback = setTimeout(removeEarlyTheme, 2500);

    function injectEarlyTheme() {
        const theme = getCookie('theme') || 'light';
        const custom = getCookie('customColors') || {};
        const defaults = getDefaultColors(theme);
        const saved = theme === 'light' ? defaults : custom[theme] || defaults;
        const pageBg = saved.pageBg || defaults.pageBg;
        const textColor = saved.textColor || defaults.textColor;
        const isDark = theme !== 'light';

        document.documentElement.style.backgroundColor = pageBg;
        document.documentElement.style.color = textColor;
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

        if (isDark) {
            document.documentElement.classList.add('dark-mods-boot');
        }

        const style = document.createElement('style');
        style.id = 'dark-mods-early-theme';
        style.textContent = `
            html,
            body {
                background-color: ${pageBg} !important;
                color: ${textColor} !important;
                color-scheme: ${isDark ? 'dark' : 'light'};
            }
            html.dark-mods-boot::before {
                content: "";
                display: block;
                position: fixed;
                inset: 0;
                background: ${pageBg} !important;
                z-index: 2147483647;
                pointer-events: none;
            }
            html.dark-mods-boot body {
                opacity: 0 !important;
            }
            body,
            .a-container,
            .a-section,
            .a-box,
            .a-box-inner,
            #results-content {
                background-color: ${pageBg} !important;
                color: ${textColor} !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
        return style;
    }

    function removeEarlyTheme() {
        clearTimeout(earlyThemeFallback);
        document.documentElement.classList.remove('dark-mods-boot');
        document.documentElement.style.backgroundColor = '';
        document.documentElement.style.color = '';
        document.documentElement.style.colorScheme = '';
        if (earlyThemeStyle && earlyThemeStyle.parentNode) {
            earlyThemeStyle.remove();
        }
    }

    function runWhenBodyReady(callback) {
        if (document.body) {
            callback();
            return;
        }
        const timer = setInterval(() => {
            if (document.body) {
                clearInterval(timer);
                callback();
            }
        }, 10);
    }

    function setCookie(name, value, days) {
        const expires = days ? `expires=${new Date(Date.now() + days * 864e5).toUTCString()}` : '';
        document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}; ${expires}; path=/; domain=${window.location.hostname}`;
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            const cookieValue = decodeURIComponent(parts.pop().split(';').shift());
            try {
                return JSON.parse(cookieValue);
            } catch (error) {
                return null;
            }
        }
        return null;
    }

    const controlsContainer = document.createElement('div');
    controlsContainer.style.position = 'fixed';
    controlsContainer.style.top = '8px';
    controlsContainer.style.zIndex = '9999';
    controlsContainer.style.display = 'flex';
    controlsContainer.style.gap = '8px';
    controlsContainer.style.alignItems = 'center';
    controlsContainer.style.setProperty('background-color', 'transparent', 'important');
    controlsContainer.style.setProperty('box-shadow', 'none', 'important');

    const controlsToggleButton = document.createElement('button');
    controlsToggleButton.type = 'button';
    controlsToggleButton.style.width = '22px';
    controlsToggleButton.style.height = '32px';
    controlsToggleButton.style.padding = '0';
    controlsToggleButton.style.backgroundColor = '#333';
    controlsToggleButton.style.color = '#fff';
    controlsToggleButton.style.border = '1px solid #444';
    controlsToggleButton.style.borderRadius = '4px';
    controlsToggleButton.style.cursor = 'pointer';
    controlsToggleButton.style.display = 'inline-flex';
    controlsToggleButton.style.alignItems = 'center';
    controlsToggleButton.style.justifyContent = 'center';
    controlsToggleButton.style.fontSize = '0';
    controlsToggleButton.style.lineHeight = '1';
    controlsToggleButton.style.flexShrink = '0';

    const controlsToggleIcon = document.createElement('span');
    controlsToggleIcon.style.width = '13px';
    controlsToggleIcon.style.height = '13px';
    controlsToggleIcon.style.display = 'inline-block';
    controlsToggleIcon.style.backgroundColor = '#fff';
    controlsToggleIcon.style.setProperty('background-color', '#fff', 'important');
    controlsToggleIcon.style.transition = 'transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.18s ease';
    controlsToggleIcon.style.transformOrigin = 'center';
    controlsToggleIcon.style.webkitMaskImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M8.55 4.35a1.25 1.25 0 0 1 1.77 0l6.8 6.8a1.2 1.2 0 0 1 0 1.7l-6.8 6.8a1.25 1.25 0 0 1-1.77-1.77L14.66 12 8.55 5.88a1.25 1.25 0 0 1 0-1.53Z'/%3E%3C/svg%3E")`;
    controlsToggleIcon.style.webkitMaskRepeat = 'no-repeat';
    controlsToggleIcon.style.webkitMaskPosition = 'center';
    controlsToggleIcon.style.webkitMaskSize = '13px 13px';
    controlsToggleIcon.style.maskImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M8.55 4.35a1.25 1.25 0 0 1 1.77 0l6.8 6.8a1.2 1.2 0 0 1 0 1.7l-6.8 6.8a1.25 1.25 0 0 1-1.77-1.77L14.66 12 8.55 5.88a1.25 1.25 0 0 1 0-1.53Z'/%3E%3C/svg%3E")`;
    controlsToggleIcon.style.maskRepeat = 'no-repeat';
    controlsToggleIcon.style.maskPosition = 'center';
    controlsToggleIcon.style.maskSize = '13px 13px';
    controlsToggleButton.appendChild(controlsToggleIcon);

    const controlsPanel = document.createElement('div');
    controlsPanel.style.display = 'flex';
    controlsPanel.style.position = 'relative';
    controlsPanel.style.alignItems = 'center';
    controlsPanel.style.gap = '8px';
    controlsPanel.style.overflow = 'visible';
    controlsPanel.style.whiteSpace = 'nowrap';
    controlsPanel.style.maxWidth = '900px';
    controlsPanel.style.opacity = '1';
    controlsPanel.style.transform = 'translateX(0)';
    controlsPanel.style.transition = 'opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1), transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
    controlsPanel.style.willChange = 'opacity, transform';
    controlsPanel.style.backfaceVisibility = 'hidden';
    controlsPanel.style.setProperty('background-color', 'transparent', 'important');
    controlsPanel.style.setProperty('box-shadow', 'none', 'important');

    controlsContainer.appendChild(controlsPanel);
    controlsContainer.appendChild(controlsToggleButton);

    let isControlsMenuHidden = getCookie('controlsMenuHidden') === true;

    function applyControlsMenuState(skipTransition) {
        const previousTransition = controlsPanel.style.transition;
        if (skipTransition) {
            controlsPanel.style.transition = 'none';
        }
        controlsToggleIcon.style.transform = isControlsMenuHidden ? 'rotate(0deg)' : 'rotate(180deg)';
        controlsToggleButton.title = isControlsMenuHidden ? 'Show menu' : 'Hide menu';
        controlsPanel.style.maxWidth = '900px';
        clearTimeout(controlsPanel.darkmodsVisibilityTimer);
        controlsContainer.style.setProperty('background-color', 'transparent', 'important');
        controlsPanel.style.setProperty('background-color', 'transparent', 'important');
        controlsPanel.style.opacity = isControlsMenuHidden ? '0' : '1';
        controlsPanel.style.transform = isControlsMenuHidden ? 'translate3d(14px, 0, 0)' : 'translate3d(0, 0, 0)';
        controlsPanel.style.pointerEvents = isControlsMenuHidden ? 'none' : 'auto';
        controlsPanel.style.visibility = 'visible';
        controlsPanel.style.overflow = 'visible';
        if (isControlsMenuHidden) {
            controlsPanel.darkmodsVisibilityTimer = setTimeout(() => {
                if (isControlsMenuHidden) {
                    controlsPanel.style.visibility = 'hidden';
                }
            }, skipTransition ? 0 : 280);
        }
        if (isControlsMenuHidden) {
            hideFloatingElement(themePickerMenu, true);
            hideFloatingElement(colorEditor, true);
        }
        if (skipTransition) {
            requestAnimationFrame(() => {
                controlsPanel.style.transition = previousTransition;
            });
        }
    }

    controlsToggleButton.addEventListener('click', () => {
        isControlsMenuHidden = !isControlsMenuHidden;
        setCookie('controlsMenuHidden', isControlsMenuHidden, 365);
        applyControlsMenuState(false);
    });

    const overlayRect = document.createElement('div');
    overlayRect.className = 'overlay-rect';
    overlayRect.style.position = 'fixed';
    overlayRect.style.top = '45px';
    overlayRect.style.height = '7px';
    overlayRect.style.left = '0';
    overlayRect.style.width = '100vw';
    overlayRect.style.zIndex = '9998';
    overlayRect.style.pointerEvents = 'none';
    overlayRect.style.opacity = '1';
    let controlsRetryTimeout;
    function syncControlsHeight() {
        const searchInput = document.querySelector('#search, .a-search input, input[type="search"].a-input-text');
        const rect = searchInput ? searchInput.getBoundingClientRect() : null;
        const height = Math.max(28, Math.round(rect ? rect.height : 32));
        const px = `${height}px`;
        if (rect) {
            controlsContainer.style.top = `${Math.round(rect.top)}px`;
        }
        [themePickerButton, modeLabel, editButton, controlsToggleButton].forEach(el => {
            el.style.height = px;
            el.style.minHeight = px;
        });
        themePickerMenu.style.top = `${height + 4}px`;
        colorEditor.style.top = `${height + 4}px`;
        syncColorEditorPosition();
    }

    function updateControlsPosition() {
        syncControlsHeight();
        clearTimeout(controlsRetryTimeout);

        const searchButton = document.querySelector('input.a-button-input[aria-labelledby="search-button-announce"]');
        const viewportPadding = 8;
        let targetLeft = 140;

        if (searchButton) {
            const rect = searchButton.getBoundingClientRect();
            const offset = 720;
            targetLeft = rect.left - offset;
        } else {
            controlsRetryTimeout = setTimeout(debouncedUpdateControlsPosition, 500);
        }

        const maxLeft = Math.max(viewportPadding, window.innerWidth - controlsContainer.offsetWidth - viewportPadding);
        const clampedLeft = Math.min(Math.max(targetLeft, viewportPadding), maxLeft);
        controlsContainer.style.left = `${clampedLeft}px`;
    }

    let controlsPositionTimeout;
    function debouncedUpdateControlsPosition() {
        clearTimeout(controlsPositionTimeout);
        controlsPositionTimeout = setTimeout(updateControlsPosition, 100);
    }

    window.addEventListener('resize', debouncedUpdateControlsPosition);

    const themeSelector = document.createElement('select');
    themeSelector.style.padding = '8px 12px';
    themeSelector.style.backgroundColor = '#333';
    themeSelector.style.color = '#fff';
    themeSelector.style.border = '1px solid #444';
    themeSelector.style.borderRadius = '4px';
    themeSelector.style.cursor = 'pointer';

    const themes = [
        { value: 'light', text: 'Light' },
    { value: 'noir', text: 'Noir' },
    { value: 'batman', text: 'Batman' },
    { value: 'matrix', text: 'Matrix' },
    { value: 'terminator', text: 'Terminator' },
    { value: 'pink', text: 'Pink' },
    { value: 'space', text: 'Space' },
    { value: 'custom', text: 'Custom' }
    ];

    themes.forEach(theme => {
        const option = document.createElement('option');
        option.value = theme.value;
        option.text = theme.text;
        themeSelector.appendChild(option);
    });

    themeSelector.style.display = 'none';
    controlsPanel.appendChild(themeSelector);

    const themeModeGroup = document.createElement('div');
    themeModeGroup.style.display = 'flex';
    themeModeGroup.style.alignItems = 'center';
    themeModeGroup.style.gap = '0';

    const themePicker = document.createElement('div');
    themePicker.style.position = 'relative';

    const themePickerButton = document.createElement('button');
    themePickerButton.type = 'button';
    themePickerButton.style.width = '128px';
    themePickerButton.style.height = '32px';
    themePickerButton.style.padding = '0 9px';
    themePickerButton.style.setProperty('background-color', '#333', 'important');
    themePickerButton.style.setProperty('color', '#fff', 'important');
    themePickerButton.style.setProperty('border', '1px solid #444', 'important');
    themePickerButton.style.borderRadius = '4px 0 0 4px';
    themePickerButton.style.cursor = 'pointer';
    themePickerButton.style.display = 'flex';
    themePickerButton.style.alignItems = 'center';
    themePickerButton.style.justifyContent = 'space-between';
    themePickerButton.style.gap = '6px';
    themePickerButton.style.boxSizing = 'border-box';

    const themePickerMenu = document.createElement('div');
    themePickerMenu.style.position = 'absolute';
    themePickerMenu.style.top = '36px';
    themePickerMenu.style.left = '0';
    themePickerMenu.style.width = '128px';
    themePickerMenu.style.padding = '4px';
    themePickerMenu.style.setProperty('background-color', '#222', 'important');
    themePickerMenu.style.setProperty('border', '1px solid #444', 'important');
    themePickerMenu.style.borderRadius = '6px';
    themePickerMenu.style.boxShadow = '0 8px 22px rgba(0, 0, 0, 0.45)';
    themePickerMenu.style.display = 'none';
    themePickerMenu.style.opacity = '0';
    themePickerMenu.style.transform = 'translate3d(0, -6px, 0) scale(0.98)';
    themePickerMenu.style.transformOrigin = 'top center';
    themePickerMenu.style.transition = 'opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1), transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
    themePickerMenu.style.willChange = 'opacity, transform';
    themePickerMenu.style.backfaceVisibility = 'hidden';
    themePickerMenu.style.pointerEvents = 'none';
    themePickerMenu.style.zIndex = '10000';

    const modeLabel = document.createElement('span');
    modeLabel.textContent = 'mode';
    modeLabel.style.height = '32px';
    modeLabel.style.padding = '0 8px';
    modeLabel.style.display = 'inline-flex';
    modeLabel.style.alignItems = 'center';
    modeLabel.style.minHeight = '32px';
    modeLabel.style.boxSizing = 'border-box';
    modeLabel.style.setProperty('background-color', '#333', 'important');
    modeLabel.style.setProperty('color', '#fff', 'important');
    modeLabel.style.setProperty('border', '1px solid #444', 'important');
    modeLabel.style.borderRadius = '0 4px 4px 0';
    modeLabel.style.marginLeft = '-1px';
    modeLabel.style.lineHeight = '1';
    modeLabel.style.fontSize = '13px';
    modeLabel.style.fontWeight = '400';
    modeLabel.style.letterSpacing = '0.1px';
    modeLabel.style.userSelect = 'none';

    themePicker.appendChild(themePickerButton);
    themePicker.appendChild(themePickerMenu);
    themeModeGroup.appendChild(themePicker);
    themeModeGroup.appendChild(modeLabel);
    controlsPanel.appendChild(themeModeGroup);

    themePickerButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (isFloatingVisible(colorEditor)) {
            hideFloatingElement(colorEditor);
            setCookie('colorEditorState', 'none', 365);
        }
        toggleFloatingElement(themePickerMenu);
    });

    document.addEventListener('click', (event) => {
        if (!themeModeGroup.contains(event.target)) {
            hideFloatingElement(themePickerMenu);
        }
    });

    const editButton = document.createElement('button');
    editButton.innerText = 'Edit Colors';
    editButton.style.height = '32px';
    editButton.style.padding = '0 12px';
    editButton.style.backgroundColor = '#333';
    editButton.style.color = '#fff';
    editButton.style.border = '1px solid #444';
    editButton.style.borderRadius = '4px';
    editButton.style.boxSizing = 'border-box';
    editButton.style.cursor = 'pointer';
    controlsPanel.appendChild(editButton);

    const colorEditor = document.createElement('div');
    colorEditor.style.position = 'absolute';
    colorEditor.style.top = '36px';
    colorEditor.style.left = '0';
    colorEditor.style.zIndex = '9999';
    colorEditor.style.backgroundColor = '#222';
    colorEditor.style.padding = '8px';
    colorEditor.style.border = '1px solid #444';
    colorEditor.style.borderRadius = '8px';
    colorEditor.style.boxShadow = '0 8px 18px rgba(0, 0, 0, 0.32)';
    colorEditor.style.display = 'none';
    colorEditor.style.width = '260px';
    colorEditor.style.boxSizing = 'border-box';
    colorEditor.style.overflow = 'hidden';
    colorEditor.style.opacity = '0';
    colorEditor.style.transform = 'translate3d(0, -6px, 0) scale(0.98)';
    colorEditor.style.transformOrigin = 'top center';
    colorEditor.style.transition = 'opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1), transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
    colorEditor.style.willChange = 'opacity, transform';
    colorEditor.style.backfaceVisibility = 'hidden';
    colorEditor.style.pointerEvents = 'none';
    colorEditor.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0; position: relative; z-index: 1; background-color: transparent !important;">
            <div style="display: grid; grid-template-columns: 18px 118px 36px 48px; gap: 7px; align-items: center; min-width: 0; padding: 2px 0 7px; background-color: transparent !important;">
                <div style="width: 18px; height: 22px; display: flex; align-items: center; justify-content: center; background-color: transparent !important; color: #fff; font-size: 13px; line-height: 1;">◐</div>
                <label style="color: #fff; display: block; line-height: 18px; font-size: 14px; white-space: nowrap; background-color: transparent !important;">Page Background</label>
                <input type="color" id="pageBg" style="width: 36px; height: 26px; padding: 0; box-sizing: border-box; border-radius: 6px;">
                <button id="resetBackground" style="width: 48px; height: 26px; padding: 0 3px; background-color: #333; color: #fff; border: 1px solid #444; border-radius: 6px; cursor: pointer; text-align: center; box-sizing: border-box; font-size: 13px;">Reset</button>
            </div>
            <div style="height: 1px; background-color: rgba(255, 255, 255, 0.12) !important; margin: 0 2px;"></div>
            <div style="display: grid; grid-template-columns: 18px 118px 36px 48px; gap: 7px; align-items: center; min-width: 0; padding: 7px 0 2px; background-color: transparent !important;">
                <div style="width: 18px; height: 22px; display: flex; align-items: center; justify-content: center; background-color: transparent !important; color: #fff; font-size: 15px; font-weight: 600; line-height: 1;">T</div>
                <label style="color: #fff; display: block; line-height: 18px; font-size: 14px; white-space: nowrap; background-color: transparent !important;">Text Color</label>
                <input type="color" id="textColor" style="width: 36px; height: 26px; padding: 0; box-sizing: border-box; border-radius: 6px;">
                <button id="resetText" style="width: 48px; height: 26px; padding: 0 3px; background-color: #333; color: #fff; border: 1px solid #444; border-radius: 6px; cursor: pointer; text-align: center; box-sizing: border-box; font-size: 13px;">Reset</button>
            </div>
        </div>
    `;
    controlsPanel.appendChild(colorEditor);

    function syncColorEditorPosition() {
        const panelRect = controlsPanel.getBoundingClientRect();
        const toggleRect = controlsToggleButton.getBoundingClientRect();
        const editorWidth = colorEditor.offsetWidth || parseInt(colorEditor.style.width, 10) || 260;
        const rightEdge = Math.round(toggleRect.right - panelRect.left);
        const left = Math.round(rightEdge - editorWidth);
        colorEditor.style.left = `${left}px`;
    }

    function isFloatingVisible(element) {
        return element.dataset.darkmodsVisible === 'true';
    }

    function showFloatingElement(element, instant) {
        clearTimeout(element.darkmodsHideTimer);
        element.dataset.darkmodsVisible = 'true';
        element.style.display = 'block';
        element.style.pointerEvents = 'auto';
        const applyOpenState = () => {
            element.style.opacity = '1';
            element.style.transform = 'translate3d(0, 0, 0) scale(1)';
        };
        if (instant) {
            applyOpenState();
        } else {
            requestAnimationFrame(applyOpenState);
        }
    }

    function hideFloatingElement(element, instant) {
        clearTimeout(element.darkmodsHideTimer);
        element.dataset.darkmodsVisible = 'false';
        element.style.pointerEvents = 'none';
        element.style.opacity = '0';
        element.style.transform = 'translate3d(0, -6px, 0) scale(0.98)';
        if (instant) {
            element.style.display = 'none';
            return;
        }
        element.darkmodsHideTimer = setTimeout(() => {
            if (!isFloatingVisible(element)) {
                element.style.display = 'none';
            }
        }, 280);
    }

    function toggleFloatingElement(element) {
        if (isFloatingVisible(element)) {
            hideFloatingElement(element);
        } else {
            showFloatingElement(element);
        }
    }

    const colorCache = new Map();

    let customColors = getCookie('customColors') || {};
    if (typeof customColors !== 'object' || customColors === null) {
        customColors = {};
        setCookie('customColors', customColors, 365);
    }

    let editorState = getCookie('colorEditorState');
    if (editorState === 'block') {
        showFloatingElement(colorEditor, true);
    } else {
        hideFloatingElement(colorEditor, true);
    }
    hideFloatingElement(themePickerMenu, true);

    let currentPickerColors = {
        buttonBg: '#333',
        menuBg: '#222',
        textColor: '#fff',
        borderColor: '#444',
        activeBg: 'transparent',
        hoverBg: '#444',
        inactiveBg: 'transparent'
    };

    function getThemePreviewColors(themeValue) {
        const defaults = getDefaultColors(themeValue);
        if (themeValue !== 'light' && customColors[themeValue]) {
            return {
                pageBg: customColors[themeValue].pageBg || defaults.pageBg,
                textColor: customColors[themeValue].textColor || defaults.textColor
            };
        }
        return defaults;
    }

    function createThemeSwatch(themeValue) {
        const colors = getThemePreviewColors(themeValue);
        const wrapper = document.createElement('span');
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '2px';
        wrapper.style.padding = '0';
        wrapper.style.border = 'none';
        wrapper.style.borderRadius = '0';
        wrapper.style.setProperty('background-color', 'transparent', 'important');
        wrapper.style.flexShrink = '0';

        const bg = document.createElement('span');
        bg.style.width = '12px';
        bg.style.height = '12px';
        bg.style.borderRadius = '3px';
        bg.style.setProperty('background-color', colors.pageBg, 'important');
        bg.style.border = '1px solid rgba(255, 255, 255, 0.35)';
        bg.style.boxSizing = 'border-box';

        const text = document.createElement('span');
        text.style.width = '12px';
        text.style.height = '12px';
        text.style.borderRadius = '3px';
        text.style.setProperty('background-color', colors.textColor, 'important');
        text.style.border = '1px solid rgba(255, 255, 255, 0.35)';
        text.style.boxSizing = 'border-box';

        wrapper.appendChild(bg);
        wrapper.appendChild(text);
        return wrapper;
    }

    function updateThemePicker() {
        const selected = themes.find(theme => theme.value === themeSelector.value) || themes[0];
        themePickerButton.textContent = '';

        const selectedLeft = document.createElement('span');
        selectedLeft.className = 'darkmods-theme-picker-left';
        selectedLeft.style.display = 'inline-flex';
        selectedLeft.style.alignItems = 'center';
        selectedLeft.style.gap = '6px';
        selectedLeft.style.setProperty('background-color', 'transparent', 'important');
        selectedLeft.appendChild(createThemeSwatch(selected.value));

        const selectedName = document.createElement('span');
        selectedName.className = 'darkmods-theme-picker-text';
        selectedName.textContent = selected.text;
        selectedName.style.whiteSpace = 'nowrap';
        selectedName.style.setProperty('background-color', 'transparent', 'important');
        selectedLeft.appendChild(selectedName);

        const arrow = document.createElement('span');
        arrow.className = 'darkmods-theme-picker-arrow';
        arrow.textContent = '▾';
        arrow.style.opacity = '0.85';
        arrow.style.setProperty('background-color', 'transparent', 'important');
        arrow.style.fontSize = '11px';

        themePickerButton.appendChild(selectedLeft);
        themePickerButton.appendChild(arrow);
        themePickerMenu.textContent = '';

        themes.forEach(theme => {
            const item = document.createElement('button');
            item.type = 'button';
            item.style.width = '100%';
            item.style.padding = '6px 7px';
            item.style.setProperty('background-color', theme.value === themeSelector.value ? currentPickerColors.activeBg : currentPickerColors.inactiveBg, 'important');
            item.style.setProperty('color', currentPickerColors.textColor, 'important');
            item.style.setProperty('border', 'none', 'important');
            item.style.borderRadius = '4px';
            item.style.cursor = 'pointer';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '7px';
            item.style.textAlign = 'left';

            item.appendChild(createThemeSwatch(theme.value));

            const name = document.createElement('span');
            name.className = 'darkmods-theme-picker-text';
            name.textContent = theme.text;
            name.style.flex = '1';
            name.style.whiteSpace = 'nowrap';
            name.style.setProperty('background-color', 'transparent', 'important');
            item.appendChild(name);

            item.addEventListener('mouseenter', () => {
                item.style.setProperty('background-color', currentPickerColors.hoverBg, 'important');
            });
            item.addEventListener('mouseleave', () => {
                item.style.setProperty('background-color', theme.value === themeSelector.value ? currentPickerColors.activeBg : currentPickerColors.inactiveBg, 'important');
            });
            item.addEventListener('click', () => {
                if (isFloatingVisible(colorEditor)) {
                    hideFloatingElement(colorEditor);
                    setCookie('colorEditorState', 'none', 365);
                }
                themeSelector.value = theme.value;
                hideFloatingElement(themePickerMenu);
                themeSelector.dispatchEvent(new Event('change', { bubbles: true }));
            });

            themePickerMenu.appendChild(item);
        });
    }

    const styleSheet = document.createElement('style');
    styleSheet.id = `dark-mods-stylesheet-${Date.now()}`;
    function hexToHSL(hex) {
        if (colorCache.has(hex)) return colorCache.get(hex);
        let r = parseInt(hex.slice(1, 3), 16) / 255;
        let g = parseInt(hex.slice(3, 5), 16) / 255;
        let b = parseInt(hex.slice(5, 7), 16) / 255;
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) {
            h = s = 0;
        } else {
            let d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        const hsl = { h: h * 360, s: s * 100, l: l * 100 };
        colorCache.set(hex, hsl);
        return hsl;
    }

    function hslToHex(h, s, l) {
        const key = `${h}-${s}-${l}`;
        if (colorCache.has(key)) return colorCache.get(key);
        l /= 100;
        const a = s * Math.min(l, 1 - l) / 100;
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        const hex = `#${f(0)}${f(8)}${f(4)}`;
        colorCache.set(key, hex);
        return hex;
    }

    function hexToRGBA(hex, opacity) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    function averageRGBA(color1, color2) {
        const rgba1 = color1.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        const rgba2 = color2.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (!rgba1 || !rgba2) return color1;
        const r = Math.round((parseInt(rgba1[1]) + parseInt(rgba2[1])) / 2);
        const g = Math.round((parseInt(rgba1[2]) + parseInt(rgba2[2])) / 2);
        const b = Math.round((parseInt(rgba1[3]) + parseInt(rgba2[3])) / 2);
        const a = (parseFloat(rgba1[4]) + parseFloat(rgba2[4])) / 2;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    function generateShades(baseColor, type) {
        const hsl = hexToHSL(baseColor);
        if (type === 'background') {
            return {
                pageBg: baseColor,
                elementBg: hslToHex(hsl.h, hsl.s, Math.min(hsl.l + 5, 100)),
                borderColor: hslToHex(hsl.h, hsl.s, Math.min(hsl.l + 10, 100)),
                hoverBg: hslToHex(hsl.h, hsl.s, Math.min(hsl.l + 7, 100))
            };
        } else if (type === 'text') {
            return {
                textColor: baseColor,
                linkColor: hslToHex((hsl.h + 10) % 360, Math.max(hsl.s - 5, 0), hsl.l),
                linkHoverColor: hslToHex((hsl.h + 10) % 360, Math.max(hsl.s - 5, 0), Math.min(hsl.l + 15, 100)),
                inactiveColor: hslToHex(hsl.h, Math.max(hsl.s - 30, 0), Math.max(hsl.l - 15, 0)),
                selectionBgColor: hslToHex(hsl.h, Math.max(hsl.s - 10, 0), Math.min(hsl.l + 10, 100))
            };
        }
        return {};
    }

    let textColorWithOpacity = '';
    let textColorWith20Opacity = '';
    let gradientHueShifted = '';

    function updateGradientColors(colors) {
        textColorWithOpacity = hexToRGBA(colors.textColor, 0.7);
        textColorWith20Opacity = hexToRGBA(colors.textColor, 0.2);
        const textHSL = hexToHSL(colors.textColor);
        gradientHueShifted = hslToHex((textHSL.h + 20) % 360, textHSL.s, textHSL.l);
    }

    function generateThemeCSS(colors) {
        if (themeSelector.value !== 'light') {
            updateGradientColors(colors);
            const bgHSL = hexToHSL(colors.pageBg);
            const invertFilter = bgHSL.l > 50 ? 'invert(100%)' : 'invert(0%)';
            const hueRotate = `hue-rotate(${bgHSL.h}deg)`;
            const averageScrollColor = averageRGBA(textColorWith20Opacity, hexToRGBA(gradientHueShifted, 0.7));

            return `
                body, html {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                }
                * {
                    background-color: inherit !important;
                    color: inherit !important;
                    border-color: ${colors.borderColor} !important;
                }
                div, section, article, aside, main, header, footer, nav {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                    border-color: ${colors.borderColor} !important;
                }
                a {
                    color: ${colors.linkColor} !important;
                }
                a:hover {
                    color: ${colors.linkHoverColor} !important;
                }
                input, select, textarea, button {
                    background-color: ${colors.elementBg} !important;
                    color: ${colors.textColor} !important;
                    border: 1px solid ${colors.borderColor} !important;
                    transition: box-shadow 0.3s ease;
                }
                input:hover, select:hover, textarea:hover, button:hover {
                    box-shadow: 0 0 10px ${hexToRGBA(colors.textColor, 0.5)} !important;
                }
                select, option {
                    background-color: ${colors.elementBg} !important;
                    color: ${colors.textColor} !important;
                }
                select:focus, select:hover {
                    background-color: ${colors.hoverBg} !important;
                    color: ${colors.textColor} !important;
                }
                option:hover {
                    background-color: ${colors.borderColor} !important;
                    color: ${colors.textColor} !important;
                }
                .darkmods-theme-picker-left,
                .darkmods-theme-picker-text,
                .darkmods-theme-picker-arrow {
                    background: transparent !important;
                    background-color: transparent !important;
                }
                .dropdown, .menu, .dropdown-menu, [class*="dropdown"], [class*="menu"] {
                    background-color: ${colors.elementBg} !important;
                    color: ${colors.textColor} !important;
                    border-color: ${colors.borderColor} !important;
                }
                .header, .footer, .nav, .sidebar, .menu {
                    background-color: ${colors.elementBg} !important;
                    border-color: ${colors.borderColor} !important;
                }
                table, tr, td, th {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                    border-color: ${colors.borderColor} !important;
                }
                table td:not(.highlight-true):not(.highlight-false),
                table td:not(.highlight-true):not(.highlight-false) * {
                    background-color: ${colors.pageBg} !important;
                }
                .product-details, .info-box, .content, .panel, .card, .box, [class*="container"], [class*="wrapper"] {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                    border-color: ${colors.borderColor} !important;
                }
                .a-box {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                    border-color: ${colors.borderColor} !important;
                    border-radius: 6px !important;
                    overflow: hidden !important;
                }
                .a-box-inner, .a-section, .a-container, [class*="a-spacing-"] {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                    border-color: ${colors.borderColor} !important;
                }
                .a-expander-container {
                    background-color: ${colors.pageBg} !important;
                    border: none !important;
                    box-shadow: none !important;
                }
                .a-expander-header,
                .sidebar-expander-header,
                .a-link-section-expander,
                .a-expander-header[aria-expanded="true"],
                .a-expander-header[aria-expanded="false"],
                .a-expander-header[data-action="a-expander-toggle"],
                .a-expander-header *,
                .sidebar-expander-header *,
                .a-link-section-expander * {
                    background: linear-gradient(90deg, ${textColorWith20Opacity}, ${hexToRGBA(gradientHueShifted, 0.7)}) !important;
                    background-size: 200% 100%;
                    animation: gradientAnimation 5s ease infinite !important;
                    color: ${colors.textColor} !important;
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                    cursor: pointer !important;
                }
                @keyframes gradientAnimation {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                .a-expander-header::before,
                .a-expander-header::after,
                .sidebar-expander-header::before,
                .sidebar-expander-header::after {
                    background: linear-gradient(90deg, ${textColorWith20Opacity}, ${hexToRGBA(gradientHueShifted, 0.7)}) !important;
                    border: none !important;
                }
                .a-expander-header h6,
                .a-expander-header span,
                .a-expander-prompt {
                    background: transparent !important;
                    color: ${colors.textColor} !important;
                }
                .a-expander-header:hover,
                .sidebar-expander-header:hover,
                .a-link-section-expander:hover {
                    background: linear-gradient(90deg, ${hexToRGBA(colors.textColor, 0.3)}, ${hexToRGBA(gradientHueShifted, 0.8)}) !important;
                }
                .a-expander-header [style*="background-color"],
                .a-expander-header [style*="background"],
                .a-expander-header [style*="color"],
                .sidebar-expander-header [style*="background-color"],
                .sidebar-expander-header [style*="background"],
                .sidebar-expander-header [style*="color"] {
                    background: linear-gradient(90deg, ${textColorWith20Opacity}, ${hexToRGBA(gradientHueShifted, 0.7)}) !important;
                    color: ${colors.textColor} !important;
                }
                .a-expander-content,
                .a-expander-content *,
                .a-expander-content a,
                .a-expander-content span,
                .a-expander-content li {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                    border: none !important;
                }
                .a-expander-content a:hover,
                .a-expander-content li:hover {
                    background-color: ${colors.hoverBg} !important;
                }
                .a-menu,
                .a-menu-item,
                .a-nostyle {
                    background-color: ${colors.pageBg} !important;
                    color: ${colors.textColor} !important;
                }
                .a-icon,
                .a-icon-section-collapse,
                .a-icon-section-expand {
                    filter: ${invertFilter} ${hueRotate} !important;
                }
                .a-expander-header .a-icon,
                .a-expander-header svg {
                    filter: none !important;
                }
                .a-search {
                    position: relative !important;
                }
                .a-search > .a-icon-search {
                    background-image: none !important;
                    background-color: ${colors.textColor} !important;
                    background-repeat: no-repeat !important;
                    filter: drop-shadow(0 0 3px ${hexToRGBA(colors.textColor, 0.35)}) !important;
                    opacity: 1 !important;
                    width: 18px !important;
                    height: 18px !important;
                    position: absolute !important;
                    top: 50% !important;
                    left: 8px !important;
                    margin: -9px 0 0 0 !important;
                    z-index: 3 !important;
                    display: block !important;
                    color: ${colors.textColor} !important;
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                    overflow: visible !important;
                    pointer-events: none !important;
                    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M10.5 3a7.5 7.5 0 1 0 4.72 13.33l4.22 4.22a1.15 1.15 0 0 0 1.63-1.63l-4.22-4.22A7.5 7.5 0 0 0 10.5 3Zm0 2.2a5.3 5.3 0 1 1 0 10.6 5.3 5.3 0 0 1 0-10.6Z'/%3E%3C/svg%3E") !important;
                    -webkit-mask-repeat: no-repeat !important;
                    -webkit-mask-position: center !important;
                    -webkit-mask-size: 17px 17px !important;
                    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M10.5 3a7.5 7.5 0 1 0 4.72 13.33l4.22 4.22a1.15 1.15 0 0 0 1.63-1.63l-4.22-4.22A7.5 7.5 0 0 0 10.5 3Zm0 2.2a5.3 5.3 0 1 1 0 10.6 5.3 5.3 0 0 1 0-10.6Z'/%3E%3C/svg%3E") !important;
                    mask-repeat: no-repeat !important;
                    mask-position: center !important;
                    mask-size: 17px 17px !important;
                }
                .a-search:hover > .a-icon-search,
                .a-search:focus-within > .a-icon-search {
                    filter: drop-shadow(0 0 6px ${hexToRGBA(colors.textColor, 0.65)}) !important;
                }
                .a-icon-section-expand,
                .a-icon-section-collapse,
                .a-icon-expand,
                .a-icon-collapse,
                .a-icon-extender-expand,
                .a-icon-extender-collapse,
                .a-icon-dropdown {
                    background-image: none !important;
                    background-color: ${colors.textColor} !important;
                    background-repeat: no-repeat !important;
                    opacity: 1 !important;
                    filter: drop-shadow(0 0 3px ${hexToRGBA(colors.textColor, 0.35)}) !important;
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                    overflow: visible !important;
                    -webkit-mask-repeat: no-repeat !important;
                    -webkit-mask-position: center !important;
                    -webkit-mask-size: 14px 14px !important;
                    mask-repeat: no-repeat !important;
                    mask-position: center !important;
                    mask-size: 14px 14px !important;
                }
                .a-icon-section-expand,
                .a-icon-expand,
                .a-icon-extender-expand,
                .a-icon-dropdown {
                    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M6.35 8.55a1.2 1.2 0 0 1 1.7 0L12 12.5l3.95-3.95a1.2 1.2 0 1 1 1.7 1.7l-4.8 4.8a1.2 1.2 0 0 1-1.7 0l-4.8-4.8a1.2 1.2 0 0 1 0-1.7Z'/%3E%3C/svg%3E") !important;
                    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M6.35 8.55a1.2 1.2 0 0 1 1.7 0L12 12.5l3.95-3.95a1.2 1.2 0 1 1 1.7 1.7l-4.8 4.8a1.2 1.2 0 0 1-1.7 0l-4.8-4.8a1.2 1.2 0 0 1 0-1.7Z'/%3E%3C/svg%3E") !important;
                }
                .a-icon-section-collapse,
                .a-icon-collapse,
                .a-icon-extender-collapse {
                    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M6.35 15.45a1.2 1.2 0 0 0 1.7 0L12 11.5l3.95 3.95a1.2 1.2 0 1 0 1.7-1.7l-4.8-4.8a1.2 1.2 0 0 0-1.7 0l-4.8 4.8a1.2 1.2 0 0 0 0 1.7Z'/%3E%3C/svg%3E") !important;
                    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M6.35 15.45a1.2 1.2 0 0 0 1.7 0L12 11.5l3.95 3.95a1.2 1.2 0 1 0 1.7-1.7l-4.8-4.8a1.2 1.2 0 0 0-1.7 0l-4.8 4.8a1.2 1.2 0 0 0 0 1.7Z'/%3E%3C/svg%3E") !important;
                }
                .a-expander-header:hover .a-icon-section-expand,
                .a-expander-header:hover .a-icon-section-collapse,
                .sidebar-expander-header:hover .a-icon-section-expand,
                .sidebar-expander-header:hover .a-icon-section-collapse,
                .a-link-section-expander:hover .a-icon-section-expand,
                .a-link-section-expander:hover .a-icon-section-collapse,
                .a-expander-header:hover .a-icon-expand,
                .a-expander-header:hover .a-icon-collapse,
                .a-expander-header:hover .a-icon-extender-expand,
                .a-expander-header:hover .a-icon-extender-collapse {
                    filter: drop-shadow(0 0 6px ${hexToRGBA(colors.textColor, 0.65)}) !important;
                }
                .filters-popover .p-icon,
                .p-icon {
                    background-image: none !important;
                    background-color: ${colors.textColor} !important;
                    background-repeat: no-repeat !important;
                    width: 18px !important;
                    height: 18px !important;
                    min-width: 18px !important;
                    min-height: 18px !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    display: inline-block !important;
                    position: relative !important;
                    top: 8px !important;
                    left: -2px !important;
                    opacity: 1 !important;
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                    overflow: visible !important;
                    filter: drop-shadow(0 0 3px ${hexToRGBA(colors.textColor, 0.35)}) !important;
                    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M10.8 4.2a1.2 1.2 0 0 1 2.4 0v6.6h6.6a1.2 1.2 0 1 1 0 2.4h-6.6v6.6a1.2 1.2 0 1 1-2.4 0v-6.6H4.2a1.2 1.2 0 1 1 0-2.4h6.6V4.2Z'/%3E%3C/svg%3E") !important;
                    -webkit-mask-repeat: no-repeat !important;
                    -webkit-mask-position: center !important;
                    -webkit-mask-size: 17px 17px !important;
                    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M10.8 4.2a1.2 1.2 0 0 1 2.4 0v6.6h6.6a1.2 1.2 0 1 1 0 2.4h-6.6v6.6a1.2 1.2 0 1 1-2.4 0v-6.6H4.2a1.2 1.2 0 1 1 0-2.4h6.6V4.2Z'/%3E%3C/svg%3E") !important;
                    mask-repeat: no-repeat !important;
                    mask-position: center !important;
                    mask-size: 17px 17px !important;
                }
                .filters-popover:hover .p-icon,
                .p-icon:hover {
                    opacity: 1 !important;
                    border: none !important;
                    box-shadow: none !important;
                    filter: drop-shadow(0 0 6px ${hexToRGBA(colors.textColor, 0.65)}) !important;
                }
                .a-popover-trigger .a-icon-popover,
                .a-icon.a-icon-info {
                    background-image: none !important;
                    background-color: ${colors.textColor} !important;
                    background-repeat: no-repeat !important;
                    width: 15px !important;
                    height: 15px !important;
                    min-width: 15px !important;
                    min-height: 15px !important;
                    padding: 0 !important;
                    margin: 0 0 0 4px !important;
                    display: inline-block !important;
                    position: relative !important;
                    top: 2px !important;
                    vertical-align: baseline !important;
                    opacity: 0.72 !important;
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                    overflow: visible !important;
                    filter: drop-shadow(0 0 3px ${hexToRGBA(colors.textColor, 0.25)}) !important;
                    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' fill-rule='evenodd' d='M12 2.75a9.25 9.25 0 1 0 0 18.5 9.25 9.25 0 0 0 0-18.5Zm0 2a7.25 7.25 0 1 1 0 14.5 7.25 7.25 0 0 1 0-14.5Zm-1.05 6.1h2.1v6h-2.1v-6Zm1.05-3.8a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z'/%3E%3C/svg%3E") !important;
                    -webkit-mask-repeat: no-repeat !important;
                    -webkit-mask-position: center !important;
                    -webkit-mask-size: 15px 15px !important;
                    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' fill-rule='evenodd' d='M12 2.75a9.25 9.25 0 1 0 0 18.5 9.25 9.25 0 0 0 0-18.5Zm0 2a7.25 7.25 0 1 1 0 14.5 7.25 7.25 0 0 1 0-14.5Zm-1.05 6.1h2.1v6h-2.1v-6Zm1.05-3.8a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z'/%3E%3C/svg%3E") !important;
                    mask-repeat: no-repeat !important;
                    mask-position: center !important;
                    mask-size: 15px 15px !important;
                }
                .a-popover-trigger:hover .a-icon-popover,
                .a-icon.a-icon-info:hover {
                    opacity: 1 !important;
                    filter: drop-shadow(0 0 6px ${hexToRGBA(colors.textColor, 0.6)}) !important;
                }
                .s-icon.s-icon-info,
                .s-icon-info {
                    background-image: none !important;
                    background-color: ${colors.textColor} !important;
                    background-repeat: no-repeat !important;
                    width: 14px !important;
                    height: 14px !important;
                    min-width: 14px !important;
                    min-height: 14px !important;
                    padding: 0 !important;
                    margin: 0 0 0 4px !important;
                    display: inline-block !important;
                    position: relative !important;
                    top: 1px !important;
                    vertical-align: baseline !important;
                    opacity: 0.72 !important;
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                    overflow: visible !important;
                    filter: drop-shadow(0 0 3px ${hexToRGBA(colors.textColor, 0.25)}) !important;
                    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' fill-rule='evenodd' d='M12 2.75a9.25 9.25 0 1 0 0 18.5 9.25 9.25 0 0 0 0-18.5Zm0 2a7.25 7.25 0 1 1 0 14.5 7.25 7.25 0 0 1 0-14.5Zm-1.05 6.1h2.1v6h-2.1v-6Zm1.05-3.8a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z'/%3E%3C/svg%3E") !important;
                    -webkit-mask-repeat: no-repeat !important;
                    -webkit-mask-position: center !important;
                    -webkit-mask-size: 14px 14px !important;
                    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' fill-rule='evenodd' d='M12 2.75a9.25 9.25 0 1 0 0 18.5 9.25 9.25 0 0 0 0-18.5Zm0 2a7.25 7.25 0 1 1 0 14.5 7.25 7.25 0 0 1 0-14.5Zm-1.05 6.1h2.1v6h-2.1v-6Zm1.05-3.8a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z'/%3E%3C/svg%3E") !important;
                    mask-repeat: no-repeat !important;
                    mask-position: center !important;
                    mask-size: 14px 14px !important;
                }
                .s-icon.s-icon-info:hover,
                .s-icon-info:hover,
                a:hover .s-icon-info,
                h1:hover .s-icon-info,
                h2:hover .s-icon-info,
                h3:hover .s-icon-info {
                    opacity: 1 !important;
                    filter: drop-shadow(0 0 6px ${hexToRGBA(colors.textColor, 0.6)}) !important;
                }
                .a-popover .a-button-close,
                .a-popover-wrapper .a-button-close,
                .a-popover-header .a-button-close {
                    background-color: ${hexToRGBA(colors.textColor, 0.08)} !important;
                    border: 1px solid ${hexToRGBA(colors.textColor, 0.16)} !important;
                    border-radius: 6px !important;
                    box-shadow: none !important;
                }
                .a-popover .a-button-close:hover,
                .a-popover-wrapper .a-button-close:hover,
                .a-popover-header .a-button-close:hover {
                    background-color: ${hexToRGBA(colors.textColor, 0.14)} !important;
                    border-color: ${hexToRGBA(colors.textColor, 0.3)} !important;
                }
                .a-popover .a-button-close .a-icon-close,
                .a-popover-wrapper .a-button-close .a-icon-close,
                .a-popover-header .a-button-close .a-icon-close,
                .a-popover .a-icon-close-filter,
                .a-popover-wrapper .a-icon-close-filter {
                    background-image: none !important;
                    background-color: ${colors.textColor} !important;
                    background-repeat: no-repeat !important;
                    width: 18px !important;
                    height: 18px !important;
                    min-width: 18px !important;
                    min-height: 18px !important;
                    opacity: 1 !important;
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                    overflow: visible !important;
                    filter: drop-shadow(0 0 3px ${hexToRGBA(colors.textColor, 0.35)}) !important;
                    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M6.15 4.45a1.2 1.2 0 0 0-1.7 1.7L10.3 12l-5.85 5.85a1.2 1.2 0 1 0 1.7 1.7L12 13.7l5.85 5.85a1.2 1.2 0 0 0 1.7-1.7L13.7 12l5.85-5.85a1.2 1.2 0 0 0-1.7-1.7L12 10.3 6.15 4.45Z'/%3E%3C/svg%3E") !important;
                    -webkit-mask-repeat: no-repeat !important;
                    -webkit-mask-position: center !important;
                    -webkit-mask-size: 15px 15px !important;
                    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M6.15 4.45a1.2 1.2 0 0 0-1.7 1.7L10.3 12l-5.85 5.85a1.2 1.2 0 1 0 1.7 1.7L12 13.7l5.85 5.85a1.2 1.2 0 0 0 1.7-1.7L13.7 12l5.85-5.85a1.2 1.2 0 0 0-1.7-1.7L12 10.3 6.15 4.45Z'/%3E%3C/svg%3E") !important;
                    mask-repeat: no-repeat !important;
                    mask-position: center !important;
                    mask-size: 15px 15px !important;
                }
                .a-popover .a-button-close:hover .a-icon-close,
                .a-popover-wrapper .a-button-close:hover .a-icon-close,
                .a-popover-header .a-button-close:hover .a-icon-close,
                .a-popover .a-icon-close-filter:hover,
                .a-popover-wrapper .a-icon-close-filter:hover {
                    filter: drop-shadow(0 0 6px ${hexToRGBA(colors.textColor, 0.65)}) !important;
                }
                img {
                    filter: none !important;
                }
                .badge-icon-wrapper img,
                img[src^="https://internal-cdn.amazon.com/badgephotos.amazon.com/"],
                img[src^="http://ecx.images-amazon.com/"] {
                    background-color: transparent !important;
                    filter: none !important;
                }
                [style*="background-color: white"],
                [style*="background: white"],
                [style*="background-color: #fff"],
                [style*="background: #fff"] {
                    background-color: ${colors.pageBg} !important;
                }
                [style*="color: black"],
                [style*="color: #000"] {
                    color: ${colors.textColor} !important;
                }
                [style*="border"],
                [style*="border-color"],
                [style*="border-top"],
                [style*="border-bottom"],
                [style*="border-left"],
                [style*="border-right"] {
                    border-color: ${colors.borderColor} !important;
                }
                table.a-bordered,
                table.a-keyvalue,
                table.dataTable {
                    border-collapse: separate !important;
                    border-spacing: 0 !important;
                    border-radius: 6px !important;
                    overflow: hidden !important;
                    box-shadow: none !important;
                    outline: none !important;
                }
                table.a-bordered tr,
                table.a-keyvalue tr,
                table.dataTable tr,
                table.a-bordered td,
                table.a-bordered th,
                table.a-keyvalue td,
                table.a-keyvalue th,
                table.dataTable td,
                table.dataTable th {
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                }
                table td.highlight-true,
                table td.highlight-false {
                    border: none !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                    outline: none !important;
                    background: transparent !important;
                    background-color: transparent !important;
                    background-clip: border-box !important;
                    overflow: hidden !important;
                }
                table td.highlight-true *,
                table td.highlight-false * {
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                }
                table td.highlight-true > .darkmods-tf-pill,
                table td.highlight-false > .darkmods-tf-pill {
                    display: inline-block !important;
                    min-width: 5ch !important;
                    width: auto !important;
                    padding: 1px 4px !important;
                    line-height: 1.35 !important;
                    text-align: center !important;
                    border-radius: 6px !important;
                    box-sizing: border-box !important;
                    background-clip: padding-box !important;
                    position: relative !important;
                    z-index: 1 !important;
                    white-space: nowrap !important;
                }
                #table-inventory tbody tr.odd td:not(.highlight-true):not(.highlight-false),
                #table-inventory-history tbody tr.odd td:not(.highlight-true):not(.highlight-false),
                #table-container-history tbody tr.odd td:not(.highlight-true):not(.highlight-false) {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.04)}, ${hexToRGBA(colors.textColor, 0.04)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                }
                #table-inventory tbody tr.even td:not(.highlight-true):not(.highlight-false),
                #table-inventory-history tbody tr.even td:not(.highlight-true):not(.highlight-false),
                #table-container-history tbody tr.even td:not(.highlight-true):not(.highlight-false) {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.085)}, ${hexToRGBA(colors.textColor, 0.085)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                }
                #table-inventory tbody tr:hover td:not(.highlight-true):not(.highlight-false),
                #table-inventory-history tbody tr:hover td:not(.highlight-true):not(.highlight-false),
                #table-container-history tbody tr:hover td:not(.highlight-true):not(.highlight-false) {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.125)}, ${hexToRGBA(colors.textColor, 0.125)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                }
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(odd) th,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(odd) td:not(.highlight-true):not(.highlight-false) {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.04)}, ${hexToRGBA(colors.textColor, 0.04)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                }
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(even) th,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(even) td:not(.highlight-true):not(.highlight-false) {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.085)}, ${hexToRGBA(colors.textColor, 0.085)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                }
                [data-section-type="product"] table.a-keyvalue tbody tr:hover th,
                [data-section-type="product"] table.a-keyvalue tbody tr:hover td:not(.highlight-true):not(.highlight-false) {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.125)}, ${hexToRGBA(colors.textColor, 0.125)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                }
                #table-inventory tbody tr.odd td:not(.highlight-true):not(.highlight-false) *,
                #table-inventory-history tbody tr.odd td:not(.highlight-true):not(.highlight-false) *,
                #table-container-history tbody tr.odd td:not(.highlight-true):not(.highlight-false) *,
                #table-inventory tbody tr.even td:not(.highlight-true):not(.highlight-false) *,
                #table-inventory-history tbody tr.even td:not(.highlight-true):not(.highlight-false) *,
                #table-container-history tbody tr.even td:not(.highlight-true):not(.highlight-false) *,
                #table-inventory tbody tr:hover td:not(.highlight-true):not(.highlight-false) *,
                #table-inventory-history tbody tr:hover td:not(.highlight-true):not(.highlight-false) *,
                #table-container-history tbody tr:hover td:not(.highlight-true):not(.highlight-false) *,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(odd) th *,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(odd) td:not(.highlight-true):not(.highlight-false) *,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(even) th *,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(even) td:not(.highlight-true):not(.highlight-false) *,
                [data-section-type="product"] table.a-keyvalue tbody tr:hover th *,
                [data-section-type="product"] table.a-keyvalue tbody tr:hover td:not(.highlight-true):not(.highlight-false) * {
                    background: transparent !important;
                    background-color: transparent !important;
                }
                ul.a-list-link li:has(a[href]) {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.085)}, ${hexToRGBA(colors.textColor, 0.085)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                    border-radius: 4px !important;
                    margin: 1px 0 !important;
                }
                ul.a-list-link li:has(a[href]) a[href] {
                    background: transparent !important;
                    background-color: transparent !important;
                    color: ${colors.linkColor} !important;
                    display: block !important;
                    border-radius: 4px !important;
                    padding: 2px 6px !important;
                }
                ul.a-list-link li:has(a[href]):hover {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.125)}, ${hexToRGBA(colors.textColor, 0.125)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                }
                ul.a-list-link li:has(a[href]):hover a[href] {
                    color: ${colors.linkHoverColor} !important;
                }
                ul.a-list-link li a:not([href]) {
                    color: ${colors.inactiveColor} !important;
                }
                ul.a-list-link li:not(:has(a[href])) {
                    color: ${colors.inactiveColor} !important;
                }
                .a-cal-date-anchor[aria-disabled="false"] {
                    color: ${colors.textColor} !important;
                }
                .a-cal-date-anchor[aria-disabled="true"] {
                    color: ${colors.inactiveColor} !important;
                }
                ::selection {
                    background: ${hexToRGBA(colors.selectionBgColor, 0.3)} !important;
                    color: ${colors.textColor} !important;
                }
                div.a-box.a-first.a-box-title:not([style*="background: none"]),
                div.a-box.a-first.a-box-title:not([style*="background: transparent"]) {
                    background: linear-gradient(to right, ${textColorWith20Opacity}, ${hexToRGBA(gradientHueShifted, 0.7)}) !important;
                }
                div.a-box.a-first.a-box-title .a-box-inner,
                div.a-box.a-first.a-box-title div.a-box-inner,
                div.a-box.a-first.a-box-title .a-row,
                div.a-box.a-first.a-box-title div.a-row,
                div.a-box.a-first.a-box-title .a-column,
                div.a-box.a-first.a-box-title div.a-column {
                    background: transparent !important;
                }
                ul.a-unordered-list.a-nostyle.a-horizontal,
                div ul.a-unordered-list.a-nostyle.a-horizontal,
                ul.a-unordered-list.a-nostyle,
                ul.a-unordered-list.a-horizontal,
                ul.a-nostyle.a-horizontal,
                div ul.a-unordered-list.a-nostyle,
                div ul.a-unordered-list.a-horizontal,
                div ul.a-nostyle.a-horizontal {
                    background: transparent !important;
                    padding: 10px !important;
                    border-radius: 4px !important;
                }
                ul.a-unordered-list.a-nostyle.a-horizontal li,
                div ul.a-unordered-list.a-nostyle.a-horizontal li,
                ul.a-unordered-list.a-nostyle li,
                ul.a-unordered-list.a-horizontal li,
                ul.a-nostyle.a-horizontal li,
                div ul.a-unordered-list.a-nostyle li,
                div ul.a-unordered-list.a-horizontal li,
                div ul.a-nostyle.a-horizontal li,
                ul.a-unordered-list.a-nostyle.a-horizontal span,
                div ul.a-unordered-list.a-nostyle.a-horizontal span,
                ul.a-unordered-list.a-nostyle span,
                ul.a-unordered-list.a-horizontal span,
                ul.a-nostyle.a-horizontal span,
                div ul.a-unordered-list.a-nostyle span,
                div ul.a-unordered-list.a-horizontal span,
                div ul.a-nostyle.a-horizontal span,
                ul.a-unordered-list.a-nostyle.a-horizontal div,
                div ul.a-unordered-list.a-nostyle.a-horizontal div,
                ul.a-unordered-list.a-nostyle div,
                ul.a-unordered-list.a-horizontal div,
                ul.a-nostyle.a-horizontal div,
                div ul.a-unordered-list.a-nostyle div,
                div ul.a-unordered-list.a-horizontal div,
                div ul.a-nostyle.a-horizontal div,
                ul.a-unordered-list.a-nostyle.a-horizontal select,
                div ul.a-unordered-list.a-nostyle.a-horizontal select,
                ul.a-unordered-list.a-nostyle select,
                ul.a-unordered-list.a-horizontal select,
                ul.a-nostyle.a-horizontal select,
                div ul.a-unordered-list.a-nostyle select,
                div ul.a-unordered-list.a-horizontal select,
                div ul.a-nostyle.a-horizontal select,
                ul.a-unordered-list.a-nostyle.a-horizontal input,
                div ul.a-unordered-list.a-nostyle.a-horizontal input,
                ul.a-unordered-list.a-nostyle input,
                ul.a-unordered-list.a-horizontal input,
                ul.a-nostyle.a-horizontal input,
                div ul.a-unordered-list.a-nostyle input,
                div ul.a-unordered-list.a-horizontal input,
                div ul.a-nostyle.a-horizontal input,
                ul.a-unordered-list.a-nostyle.a-horizontal button,
                div ul.a-unordered-list.a-nostyle.a-horizontal button,
                ul.a-unordered-list.a-nostyle button,
                ul.a-unordered-list.a-horizontal button,
                ul.a-nostyle.a-horizontal button,
                div ul.a-unordered-list.a-nostyle button,
                div ul.a-unordered-list.a-horizontal button,
                div ul.a-nostyle.a-horizontal button {
                    background: transparent !important;
                }
                table.a-keyvalue td.highlight-true,
                table.a-keyvalue tr td.highlight-true,
                table:not(.a-keyvalue) td.highlight-true,
                table:not(.a-keyvalue) tr td.highlight-true {
                    background: transparent !important;
                    background-color: transparent !important;
                }
                table.a-keyvalue td.highlight-false,
                table.a-keyvalue tr td.highlight-false,
                table:not(.a-keyvalue) td.highlight-false,
                table:not(.a-keyvalue) tr td.highlight-false {
                    background: transparent !important;
                    background-color: transparent !important;
                }
                #table-inventory tbody tr.odd td.highlight-true,
                #table-inventory tbody tr.odd td.highlight-false,
                #table-inventory-history tbody tr.odd td.highlight-true,
                #table-inventory-history tbody tr.odd td.highlight-false,
                #table-container-history tbody tr.odd td.highlight-true,
                #table-container-history tbody tr.odd td.highlight-false,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(odd) td.highlight-true,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(odd) td.highlight-false {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.04)}, ${hexToRGBA(colors.textColor, 0.04)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                    background-clip: padding-box !important;
                }
                #table-inventory tbody tr.even td.highlight-true,
                #table-inventory tbody tr.even td.highlight-false,
                #table-inventory-history tbody tr.even td.highlight-true,
                #table-inventory-history tbody tr.even td.highlight-false,
                #table-container-history tbody tr.even td.highlight-true,
                #table-container-history tbody tr.even td.highlight-false,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(even) td.highlight-true,
                [data-section-type="product"] table.a-keyvalue tbody tr:nth-child(even) td.highlight-false {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.085)}, ${hexToRGBA(colors.textColor, 0.085)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                    background-clip: padding-box !important;
                }
                table.a-keyvalue td.highlight-true > .darkmods-tf-pill,
                table:not(.a-keyvalue) td.highlight-true > .darkmods-tf-pill,
                table.a-keyvalue td.highlight-true > .darkmods-tf-pill *,
                table:not(.a-keyvalue) td.highlight-true > .darkmods-tf-pill * {
                    background-color: #32cd32 !important;
                    color: #000000 !important;
                }
                table.a-keyvalue td.highlight-false > .darkmods-tf-pill,
                table:not(.a-keyvalue) td.highlight-false > .darkmods-tf-pill,
                table.a-keyvalue td.highlight-false > .darkmods-tf-pill *,
                table:not(.a-keyvalue) td.highlight-false > .darkmods-tf-pill * {
                    background-color: #ff4040 !important;
                    color: #000000 !important;
                }
                #table-inventory tbody tr:hover td.highlight-true,
                #table-inventory tbody tr:hover td.highlight-false,
                #table-inventory-history tbody tr:hover td.highlight-true,
                #table-inventory-history tbody tr:hover td.highlight-false,
                #table-container-history tbody tr:hover td.highlight-true,
                #table-container-history tbody tr:hover td.highlight-false,
                [data-section-type="product"] table.a-keyvalue tbody tr:hover td.highlight-true,
                [data-section-type="product"] table.a-keyvalue tbody tr:hover td.highlight-false {
                    background: linear-gradient(0deg, ${hexToRGBA(colors.textColor, 0.125)}, ${hexToRGBA(colors.textColor, 0.125)}), ${colors.pageBg} !important;
                    background-color: ${colors.pageBg} !important;
                    background-clip: padding-box !important;
                }
                ::-webkit-scrollbar {
                    width: 12px;
                    height: 12px;
                }
                ::-webkit-scrollbar-track {
                    background: ${colors.pageBg} !important;
                    border-radius: 6px;
                }
                ::-webkit-scrollbar-thumb {
                    background: linear-gradient(90deg, ${textColorWith20Opacity}, ${hexToRGBA(gradientHueShifted, 0.7)}) !important;
                    background-size: 200% 100%;
                    animation: gradientAnimation 5s ease infinite !important;
                    border-radius: 6px;
                    border: 2px solid ${colors.pageBg};
                }
                ::-webkit-scrollbar-thumb:hover {
                    background: linear-gradient(90deg, ${hexToRGBA(colors.textColor, 0.3)}, ${hexToRGBA(gradientHueShifted, 0.8)}) !important;
                    background-size: 200% 100%;
                    animation: gradientAnimation 5s ease infinite !important;
                }
                html {
                    scrollbar-color: ${averageScrollColor} ${colors.pageBg};
                    scrollbar-width: thin;
                }
            `;
        }

        return `
            table.a-keyvalue td.highlight-true,
            table.a-keyvalue tr td.highlight-true,
            table:not(.a-keyvalue) td.highlight-true,
            table:not(.a-keyvalue) tr td.highlight-true {
                background: transparent !important;
                background-color: transparent !important;
            }
            table.a-keyvalue td.highlight-false,
            table.a-keyvalue tr td.highlight-false,
            table:not(.a-keyvalue) td.highlight-false,
            table:not(.a-keyvalue) tr td.highlight-false {
                background: transparent !important;
                background-color: transparent !important;
            }
            table.a-keyvalue td.highlight-true > .darkmods-tf-pill,
            table:not(.a-keyvalue) td.highlight-true > .darkmods-tf-pill,
            table.a-keyvalue td.highlight-true > .darkmods-tf-pill *,
            table:not(.a-keyvalue) td.highlight-true > .darkmods-tf-pill * {
                background-color: #32cd32 !important;
                color: #000000 !important;
            }
            table.a-keyvalue td.highlight-false > .darkmods-tf-pill,
            table:not(.a-keyvalue) td.highlight-false > .darkmods-tf-pill,
            table.a-keyvalue td.highlight-false > .darkmods-tf-pill *,
            table:not(.a-keyvalue) td.highlight-false > .darkmods-tf-pill * {
                background-color: #ff4040 !important;
                color: #000000 !important;
            }
            ::-webkit-scrollbar {
                width: 12px;
                height: 12px;
            }
            ::-webkit-scrollbar-track {
                background: #f1f1f1 !important;
                border-radius: 6px;
            }
            ::-webkit-scrollbar-thumb {
                background: #888 !important;
                border-radius: 6px;
                border: 2px solid #f1f1f1;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: #555 !important;
            }
            html {
                scrollbar-color: #888 #f1f1f1;
                scrollbar-width: thin;
            }
        `;
    }

    function applyThemePickerColors(colors) {
        if (themeSelector.value === 'light') {
            currentPickerColors = {
                buttonBg: '#333',
                menuBg: '#222',
                textColor: '#fff',
                borderColor: '#444',
                activeBg: 'transparent',
                hoverBg: '#444',
                inactiveBg: 'transparent'
            };
        } else {
            currentPickerColors = {
                buttonBg: colors.elementBg,
                menuBg: colors.pageBg,
                textColor: colors.textColor,
                borderColor: colors.borderColor,
                activeBg: 'transparent',
                hoverBg: hexToRGBA(colors.textColor, 0.22),
                inactiveBg: 'transparent'
            };
        }

        themePickerButton.style.setProperty('background-color', currentPickerColors.buttonBg, 'important');
        themePickerButton.style.setProperty('color', currentPickerColors.textColor, 'important');
        themePickerButton.style.setProperty('border-color', currentPickerColors.borderColor, 'important');
        modeLabel.style.setProperty('background-color', currentPickerColors.buttonBg, 'important');
        modeLabel.style.setProperty('color', currentPickerColors.textColor, 'important');
        modeLabel.style.setProperty('border-color', currentPickerColors.borderColor, 'important');
        themePickerMenu.style.setProperty('background-color', currentPickerColors.menuBg, 'important');
        themePickerMenu.style.setProperty('border-color', currentPickerColors.borderColor, 'important');
        editButton.style.setProperty('background-color', themeSelector.value === 'light' ? '#555' : currentPickerColors.buttonBg, 'important');
        editButton.style.setProperty('color', currentPickerColors.textColor, 'important');
        editButton.style.setProperty('border-color', themeSelector.value === 'light' ? '#666' : currentPickerColors.borderColor, 'important');
        controlsToggleButton.style.setProperty('background-color', currentPickerColors.buttonBg, 'important');
        controlsToggleButton.style.setProperty('color', currentPickerColors.textColor, 'important');
        controlsToggleButton.style.setProperty('border-color', currentPickerColors.borderColor, 'important');
        controlsToggleIcon.style.setProperty('background-color', currentPickerColors.textColor, 'important');
        controlsContainer.style.setProperty('background-color', 'transparent', 'important');
        controlsContainer.style.setProperty('box-shadow', 'none', 'important');
        controlsPanel.style.setProperty('background-color', 'transparent', 'important');
        controlsPanel.style.setProperty('box-shadow', 'none', 'important');
        colorEditor.style.setProperty('background-color', currentPickerColors.menuBg, 'important');
        colorEditor.style.setProperty('border-color', currentPickerColors.borderColor, 'important');
        colorEditor.style.setProperty('color', currentPickerColors.textColor, 'important');
        colorEditor.querySelectorAll('h3, label').forEach(el => el.style.setProperty('color', currentPickerColors.textColor, 'important'));
        colorEditor.querySelectorAll('button').forEach(button => {
            button.style.setProperty('background-color', currentPickerColors.buttonBg, 'important');
            button.style.setProperty('color', currentPickerColors.textColor, 'important');
            button.style.setProperty('border-color', currentPickerColors.borderColor, 'important');
        });
        colorEditor.querySelectorAll('input[type="color"]').forEach(input => {
            input.style.setProperty('background-color', currentPickerColors.buttonBg, 'important');
            input.style.setProperty('border-color', currentPickerColors.borderColor, 'important');
        });
    }

    let currentTheme = getCookie('theme') || 'light';
    if (!themes.some(t => t.value === currentTheme)) {
        currentTheme = 'light';
        setCookie('theme', currentTheme, 365);
    }
    themeSelector.value = currentTheme;
    updateThemePicker();
    applyControlsMenuState(true);

    function updateEditButtonState() {
        if (themeSelector.value === 'light') {
            editButton.disabled = true;
            editButton.style.opacity = '0.5';
            editButton.style.cursor = 'not-allowed';
            editButton.style.backgroundColor = '#555';
            editButton.style.borderColor = '#666';
        } else {
            editButton.disabled = false;
            editButton.style.opacity = '1';
            editButton.style.cursor = 'pointer';
            editButton.style.backgroundColor = '#333';
            editButton.style.borderColor = '#444';
        }
    }

    function applyTheme() {
        const selectedTheme = themeSelector.value;
        setCookie('theme', selectedTheme, 365);

        document.body.classList.remove(...themes.map(t => `${t.value}-mode`));
        document.body.classList.add(`${selectedTheme}-mode`);

        const colors = selectedTheme === 'light'
            ? { pageBg: '#ffffff', textColor: '#000000' }
            : customColors[selectedTheme]
                ? { ...generateShades(customColors[selectedTheme].pageBg, 'background'), ...generateShades(customColors[selectedTheme].textColor, 'text') }
                : { ...generateShades(getDefaultColors(selectedTheme).pageBg, 'background'), ...generateShades(getDefaultColors(selectedTheme).textColor, 'text') };

        styleSheet.textContent = generateThemeCSS(colors);
        removeEarlyTheme();
        overlayRect.style.backgroundColor = selectedTheme === 'light' ? '' : colors.pageBg;

        updateEditButtonState();
        applyThemePickerColors(colors);
        updateColorEditor();
        updateThemePicker();
        fixExpanders();
        applyGradients();
        debouncedHighlightTrueFalse();
    }

    function applyGradients() {
        if (themeSelector.value === 'light') return;
        document.querySelectorAll('div.a-box.a-first.a-box-title:not([data-gradient-applied])').forEach(el => {
            el.style.background = `linear-gradient(to right, ${textColorWith20Opacity}, ${hexToRGBA(gradientHueShifted, 0.7)}) !important`;
            el.setAttribute('data-gradient-applied', 'true');
        });
        document.querySelectorAll('ul.a-unordered-list.a-nostyle.a-horizontal').forEach(el => {
            el.style.background = 'transparent !important';
            el.setAttribute('data-gradient-applied', 'true');
        });
    }

    function updateColorEditor() {
        const selectedTheme = themeSelector.value;
        const colors = selectedTheme === 'light' ? getDefaultColors(selectedTheme) : customColors[selectedTheme] || getDefaultColors(selectedTheme);
        colorEditor.querySelector('#pageBg').value = colors.pageBg;
        colorEditor.querySelector('#textColor').value = colors.textColor;
        const colorEditorTitle = colorEditor.querySelector('h3');
        if (colorEditorTitle) {
            colorEditorTitle.innerText = `Edit Colors for ${themes.find(theme => theme.value === selectedTheme).text} Mode`;
        }
    }

    function getDefaultColors(theme) {
        const defaults = {
            light: { pageBg: '#ffffff', textColor: '#000000' },
        noir: { pageBg: '#121212', textColor: '#ffffff' },
        batman: { pageBg: '#121212', textColor: '#ffeb3b' },
        matrix: { pageBg: '#121212', textColor: '#3DFE3D' },
        terminator: { pageBg: '#121212', textColor: '#ff3535' },
        pink: { pageBg: '#121212', textColor: '#f255db' },
        space: { pageBg: '#13172f', textColor: '#fd774a' },
        custom: { pageBg: '#F5F5F5', textColor: '#1C2526' }
        };
        return defaults[theme] || defaults.light;
    }

    function setupInputFocusListeners() {
        document.querySelectorAll('input:not([type="submit"]), textarea, .a-input, .a-textarea, [class*="a-input"], [class*="a-textarea"]').forEach(input => {
            if (!input.dataset.focusListener) {
                input.addEventListener('focus', () => {
                    input.style.outline = 'none';
                    if (themeSelector.value !== 'light') {
                        const colors = customColors[themeSelector.value] || getDefaultColors(themeSelector.value);
                        const textColor = colors.textColor || '#ffffff';
                        const hsl = hexToHSL(textColor);
                        const glowColor = hslToHex(hsl.h, Math.min(hsl.s + 20, 100), Math.min(hsl.l + 20, 100));
                        input.style.boxShadow = `0 0 8px ${glowColor}`;
                    }
                });
                input.addEventListener('blur', () => {
                    input.style.boxShadow = 'none';
                });
                input.dataset.focusListener = 'true';
            }
        });
    }

    editButton.addEventListener('click', () => {
        if (themeSelector.value === 'light') return;
        syncColorEditorPosition();
        if (isFloatingVisible(colorEditor)) {
            hideFloatingElement(colorEditor);
            setCookie('colorEditorState', 'none', 365);
        } else {
            hideFloatingElement(themePickerMenu);
            showFloatingElement(colorEditor);
            setCookie('colorEditorState', 'block', 365);
        }
        updateColorEditor();
    });

    document.addEventListener('click', (event) => {
        if (isFloatingVisible(colorEditor) && !colorEditor.contains(event.target) && !editButton.contains(event.target)) {
            hideFloatingElement(colorEditor);
            setCookie('colorEditorState', 'none', 365);
        }
    });

    const pageBgInput = colorEditor.querySelector('#pageBg');
    const textColorInput = colorEditor.querySelector('#textColor');

    function updateStyles() {
        const selectedTheme = themeSelector.value;
        if (selectedTheme !== 'light') {
            customColors[selectedTheme] = {
                pageBg: pageBgInput.value,
                textColor: textColorInput.value
            };
            setCookie('customColors', customColors, 365);
            applyTheme();
        }
    }

    pageBgInput.addEventListener('input', updateStyles);
    textColorInput.addEventListener('input', updateStyles);

    colorEditor.querySelector('#resetBackground').addEventListener('click', () => {
        const selectedTheme = themeSelector.value;
        if (selectedTheme !== 'light') {
            const defaultColors = getDefaultColors(selectedTheme);
            customColors[selectedTheme] = customColors[selectedTheme] || {};
            customColors[selectedTheme].pageBg = defaultColors.pageBg;
            setCookie('customColors', customColors, 365);
            applyTheme();
            updateColorEditor();
        }
    });

    colorEditor.querySelector('#resetText').addEventListener('click', () => {
        const selectedTheme = themeSelector.value;
        if (selectedTheme !== 'light') {
            const defaultColors = getDefaultColors(selectedTheme);
            customColors[selectedTheme] = customColors[selectedTheme] || {};
            customColors[selectedTheme].textColor = defaultColors.textColor;
            setCookie('customColors', customColors, 365);
            applyTheme();
            updateColorEditor();
        }
    });

    themeSelector.addEventListener('change', applyTheme);

    function getTrueFalsePill(td) {
        return Array.from(td.children).find(child => child.classList && child.classList.contains('darkmods-tf-pill')) || null;
    }

    function wrapTrueFalseValue(td) {
        let pill = getTrueFalsePill(td);
        if (!pill) {
            pill = document.createElement('span');
            pill.className = 'darkmods-tf-pill';
            while (td.firstChild) {
                pill.appendChild(td.firstChild);
            }
            td.appendChild(pill);
        }
        return pill;
    }

    function unwrapTrueFalseValue(td) {
        const pill = getTrueFalsePill(td);
        if (pill) {
            while (pill.firstChild) {
                td.insertBefore(pill.firstChild, pill);
            }
            pill.remove();
        }
        td.classList.remove('highlight-true', 'highlight-false');
    }

    function setTrueFalseHighlight(td, type) {
        wrapTrueFalseValue(td);
        td.classList.remove('highlight-true', 'highlight-false');
        td.classList.add(type === 'true' ? 'highlight-true' : 'highlight-false');
    }

    function highlightTrueFalse() {
        document.querySelectorAll('table.a-keyvalue, table[class*="keyvalue"]').forEach(table => {
            table.querySelectorAll('tr').forEach(row => {
                const th = row.querySelector('th');
                const td = row.querySelector('td');
                if (th && td) {
                    const thText = th.textContent.trim().toLowerCase();
                    const tdText = td.textContent.replace(/\s+/g, '').toLowerCase();
                    const tdTextClean = tdText.replace(/[^a-z]/g, '');
                    if (thText.includes('sortowalna') || thText.includes('sortable') || thText.includes('sort')) {
                        if (tdText === 'true' || tdTextClean === 'true' || tdText === 'prawda' || tdTextClean === 'prawda') {
                            setTrueFalseHighlight(td, 'true');
                        } else if (tdText === 'false' || tdTextClean === 'false' || tdText === 'fałsz' || tdTextClean === 'fałsz') {
                            setTrueFalseHighlight(td, 'false');
                        } else {
                            unwrapTrueFalseValue(td);
                        }
                    }
                }
            });
        });
    }

    let debounceTimeout;
    function debouncedHighlightTrueFalse() {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(highlightTrueFalse, 50);
    }

    function fixExpanders() {
        document.querySelectorAll('.a-expander-header, .sidebar-expander-header, .a-link-section-expander').forEach(expander => {
            if (!expander.dataset.expanderFixed) {
                expander.style.cursor = 'pointer';
                expander.style.userSelect = 'none';
                const toggleExpander = () => {
                    const isExpanded = expander.getAttribute('aria-expanded') === 'true';
                    expander.setAttribute('aria-expanded', !isExpanded);
                    const content = expander.nextElementSibling;
                    if (content && content.classList.contains('a-expander-content')) {
                        content.style.display = isExpanded ? 'none' : 'block';
                    }
                }
                expander.addEventListener('click', toggleExpander);
                expander.dataset.expanderFixed = 'true';
            }
        });
    }

    function initialize() {
        applyTheme();
        setupInputFocusListeners();
        highlightTrueFalse();
        debouncedHighlightTrueFalse();
        setTimeout(debouncedHighlightTrueFalse, 1000);
        fixExpanders();
        applyGradients();
        updateControlsPosition();
    }

    let dynamicContentTimeout;
    const pageObserver = new MutationObserver(() => {
        debouncedUpdateControlsPosition();

        if (document.querySelector('table.a-keyvalue, table[class*="keyvalue"]')) {
            debouncedHighlightTrueFalse();
        }

        clearTimeout(dynamicContentTimeout);
        dynamicContentTimeout = setTimeout(() => {
            if (document.querySelector('div.a-box.a-first.a-box-title, ul.a-unordered-list.a-nostyle.a-horizontal, .a-expander-header, .sidebar-expander-header, .a-link-section-expander')) {
                debouncedHighlightTrueFalse();
                fixExpanders();
                applyGradients();
            }
        }, 500);
    });
    runWhenBodyReady(() => {
        document.body.appendChild(controlsContainer);
        document.body.appendChild(overlayRect);
        (document.head || document.documentElement).appendChild(styleSheet);
        initialize();
        pageObserver.observe(document.body, { childList: true, subtree: true });
    });
})();
