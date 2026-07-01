// ==UserScript==
// @name         Amazon FC Research 6-Month Selector
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Dodaje przycisk do wyboru zakresu dat 6 miesięcy w Amazon FC Research
// @author       yafiarbe
// @match        https://fcresearch-eu.aka.amazon.com/*
// @match        http://fcresearch-eu.aka.amazon.com/*
// @match        https://qi-fcresearch-eu.corp.amazon.com/*
// @match        http://qi-fcresearch-eu.corp.amazon.com/*
// @exclude      http://fcresearch-eu.aka.amazon.com/?toteDetails=1
// @updateURL    https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Amazon-FC-Research-6-Month-Selector-0.2.user.js
// @downloadURL  https://raw.githubusercontent.com/MarseleXXL/tampermonkey-scripts/main/Amazon-FC-Research-6-Month-Selector-0.2.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function addButton() {
        // Szukamy listy zawierającej tekst "Historia inwentarza"
        const targetUl = Array.from(document.querySelectorAll('ul.a-unordered-list.a-nostyle.a-horizontal'))
            .find(ul => ul.textContent.includes('Historia inwentarza'));

        if (!targetUl || document.getElementById('sixMonthButton')) return;

        const li = document.createElement('li');
        li.innerHTML = `
            <span class="a-list-item">
                <span class="a-button a-button-base">
                    <span class="a-button-inner">
                        <button id="sixMonthButton" class="a-button-text" type="button">
                            6 Miesięcy
                        </button>
                    </span>
                </span>
            </span>
        `;

        targetUl.appendChild(li);

        document.getElementById('sixMonthButton').addEventListener('click', async function() {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);

            const formatDate = (date) => {
                return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
            };

            const startInput = document.getElementById('searchStart');
            const endInput = document.getElementById('searchEnd');

            if (startInput && endInput) {
                startInput.value = formatDate(startDate);
                endInput.value = formatDate(endDate);

                // Symulujemy wprowadzanie danych
                startInput.dispatchEvent(new Event('input', { bubbles: true }));
                endInput.dispatchEvent(new Event('input', { bubbles: true }));

                // Małe opóźnienie przed kliknięciem
                await new Promise(resolve => setTimeout(resolve, 100));

                const searchBtn = document.querySelector('button.a-button-text:not(#sixMonthButton)');
                if (searchBtn) {
                    searchBtn.click();
                }
            }
        });
    }

    // Uruchamiamy pierwsze dodanie przycisku
    addButton();

    // Obserwujemy zmiany w DOM
    const observer = new MutationObserver((mutations) => {
        addButton();
    });

    // Rozpoczynamy obserwację całego dokumentu
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();