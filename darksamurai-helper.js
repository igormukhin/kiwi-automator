// ==UserScript==
// @name         Warface Dark Samurai Battlepass Helper
// @namespace    igor.mukhin@gmx.de
// @version      1.0.1
// @author       Igor Mukhin
// @match        https://pc.warface.com/battlepass
// @require      https://code.jquery.com/jquery-3.4.1.min.js
// @require      https://unpkg.com/dexie@2.0.4/dist/dexie.js
// -require      file:///D:/igor.mukhin/projects-jetbrain/kiwi-automator/darksamurai-helper.js
// @grant        none
// ==/UserScript==

// Features for main page:
// - Auto open win crates

(function(console, window, document, $, localStorage) {
    'use strict';

    const waitBeforeStartMillis = 100;
    const PAGE_RELOAD_TIMEOUT = 1000 * 60 * 10;

    let db = null;
    let apiBaseUrl = 'not_initialized';
    let wallets;

    console.log('Initiating Warface Battlepass helper...');
    setTimeout(start, waitBeforeStartMillis);

    async function start() {
        apiBaseUrl = 'https://' + window.location.hostname + '/minigames';

        // init db
        initDatabase();

        // start operations
        try {
            // wait for some element of the page to appear
            await waitUntil(0, 100, 50, () => $('.bp-page__tabs').length > 0);
            console.log('Battlepass page detected, continuing...');

            await fetchState();
            await handleWinCrates();

            setTimeout(() => reloadPage(), PAGE_RELOAD_TIMEOUT);
        } catch (e) {
            if (e && e.message) {
                console.error(e);
            }
        }
    }

    function initDatabase() {
        db = new Dexie('blackwood');
        db.version(1).stores({
            results: '++id'
        });
    }

    async function persistResult(data) {
        const record = jQuery.extend({ time: new Date() }, data);
        await db.results.put(record);
    }

    async function fetchState() {
        // https://pc.warface.com/minigames/battlepass/wallets
        // {"data":{"hard":39,"soft":605,"victory":4,"victory_vip":4},"state":"Success"}

        let response = await $.get(apiBaseUrl + '/battlepass/wallets');
        if (response.state !== 'Success') throw 'Error fetching wallets';
        wallets = response.data;
    }

    async function handleWinCrates() {
        let shouldReload = false;
        if (wallets.victory >= 5) {
            await openCrate(6, 3);
            shouldReload = true;
        }

        if (wallets.victory_vip >= 5) {
            await openCrate(5, 4);
            shouldReload = true;
        }

        if (shouldReload) {
            reloadPage();
        }
    }

    async function openCrate(crateId, currencyId) {
        const response = await $.post(apiBaseUrl + '/battlepass/box/open',
            { 'id' : crateId, 'count': 1, 'currency': currencyId });
        console.log(response);
    }

    async function waitUntil(initialDelay, retryDelay, maxRetries, conditionFunc) {
        for (let retry = 0; retry < maxRetries; retry++) {
            await delay(retry === 0 ? initialDelay : retryDelay);

            let result = conditionFunc();
            if (result) {
                return result;
            }
        }

        throw new Error('No more tries.');
    }

    async function delay(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    function reloadPage() {
        window.location.reload();
    }

})(console, window, document, jQuery, localStorage);
