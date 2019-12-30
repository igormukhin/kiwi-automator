// ==UserScript==
// @name         Warface Blackwood Battlepass Helper
// @namespace    igor.mukhin@gmx.de
// @version      1.0.1
// @author       Igor Mukhin
// @match        https://pc.warface.com/battlepass/
// @require      https://code.jquery.com/jquery-3.4.1.min.js
// @require      https://unpkg.com/dexie@2.0.4/dist/dexie.js
// -require      file:///D:/igor.mukhin/projects-jetbrain/kiwi-automator/blackwood-helper.js
// @grant        none
// ==/UserScript==

// Features for main page:
// - Remove the spider's animation
// - Highlight daily task menu item if the task is not completed
// - Highlight personal crates menu item if user has crates
// - Show energy on the research menu item and highlights the menu item if the user has enough energy to start research
// - Shows unused skill points

(function(console, window, document, $, localStorage) {
    'use strict';

    const waitBeforeStartMillis = 100;

    let db = null;
    let apiBaseUrl = 'not_initialized';
    let wallets; // .personal_boxes (int), .skill_points (int)
    let research; // .energy (int)
    let dailyTask; // .is_complete (boolean)

    console.log('Initiating Blackwood helper...');
    setTimeout(start, waitBeforeStartMillis);

    async function start() {
        apiBaseUrl = 'https://' + window.location.hostname + '/minigames';

        // init db
        initDatabase();

        // start operations
        try {
            // wait for spider to appear
            await waitUntil(0, 100, 50, () => $('.navigation__spider').length > 0);
            console.log('Spider detected, continuing...');

            await fixSpider();
            await fetchState();
            await handleResearch();
            await decorateLabels();
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

    async function fixSpider() {
        //$('.navigation__spider').hide();
        $('body').append('<style>\n' +
            '.navigation__spider:before { animation: none; }\n' +
            '.navigation__spider:after { animation: none; }\n' +
            '</style>');
    }

    async function fetchState() {
        let response = await $.get(apiBaseUrl + '/battlepass/wallets');
        if (response.state !== 'Success') throw 'Error fetching wallets';
        wallets = response.data;

        response = await $.get(apiBaseUrl + '/battlepass/research/list');
        if (response.state !== 'Success') throw 'Error fetching research';
        research = response.data;

        response = await $.get(apiBaseUrl + '/battlepass/daily/user-task');
        if (response.state !== 'Success') throw 'Error fetching daily task';
        dailyTask = response.data;
    }

    async function decorateLabels() {
        $('.navigation__item.type--talents').append('&nbsp;<span>(' + wallets.skill_points + ')</span>');

        if (wallets.personal_boxes > 0) {
            $('.navigation__item.type--box').css({ 'color': 'red' });
        }

        if (!dailyTask.is_complete) {
            $('.navigation__item.type--daily').css({ 'color': 'red' });
        }

        const $research = $('.navigation__item.type--research');
        $research.append('&nbsp;<span>(' + research.energy + '%)</span>');
        if (research.energy >= getBestResearch().energy_required) {
            $('.navigation__item.type--research').css({ 'color': 'red' });
        }
    }

    function getBestResearch() {
        let maxResearch = null;
        for (const item of research.researches) {
            if (maxResearch == null || item.energy_required > maxResearch.energy_required) {
                maxResearch = item;
            }
        }
        return maxResearch;
    }

    async function handleResearch() {
        let operation = getBestResearch();
        console.log(operation, research.energy);
        if (operation.user_research) {
            if (!operation.user_research.time_left) {
                // if operation finished take reward
                const response = await $.post(apiBaseUrl + '/battlepass/research/take-rewards',
                    { 'research_id' : operation.id });
                // Example: {"data":[{"type":"experience","item":{"count":35},"title":"Experience"}],"state":"Success"}

                // persist results
                console.log(response);
                if (response.state === 'Success') {
                    let result = { 'award': 'nothing' };
                    if (response.data.length) {
                        result = {
                            'award': response.data[0].type,
                            'count': response.data[0].item ? response.data[0].item.count : null
                        };
                    }
                    await persistResult(result);
                    reloadPage();
                }
            }

        } else if (research.energy >= operation.energy_required) {
            // if enough energy, start operation
            await $.post(apiBaseUrl + '/battlepass/research/start', { 'research_id' : operation.id });
            reloadPage();
        }
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
