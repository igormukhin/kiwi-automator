// ==UserScript==
// @name         Warface Crafting Automation
// @namespace    igor.mukhin@gmx.de
// @version      0.2.0
// @description  Automatically opens Warface crafting resource crates.
// @author       Igor Mukhin
// @match        https://wf.my.com/minigames/bpservices
// @require      https://code.jquery.com/jquery-3.3.1.min.js
// @require      https://unpkg.com/dexie@2.0.4/dist/dexie.js
// -require      file:///D:/igor.mukhin/projects-jetbrain/kiwi-automator/warface-crafter.js
// @grant        none
// ==/UserScript==

(function(console, window, document, localStorage, $) {
    'use strict';

    const waitBeforeStartMillis = 1500;

    let refreshDelayMillis = 1000;
    const fastRefreshDelayMillis = 100;
    const slowRefreshDelayMillis = 10 * 60 * 1000;

    const autoCrafting = {
        enabled: true, /* will enable the feature that opens crates and claims their contents */
        openCrates: true, /* will open (start) crates. Deactivate if you wish to upgrade crates. */
        checkEveryMins: 0 /* minutes between checks */
    };

    let db = null;
    let refreshAlreadySetUp = false;

    setTimeout(start, waitBeforeStartMillis);

    async function start() {
        // init db
        initDatabase();

        // start operations
        try {
            await handleCraftingCrates();

            nothingToDo();
        } catch (e) {
            if (e && e.message) {
                console.error(e);
            }
        }

        requestRefresh();
    }

    function initDatabase() {
        db = new Dexie("kiwi_automator");
        db.version(1).stores({
            permaLog: '++id'
        });
    }

    async function handleCraftingCrates() {
        if (!autoCrafting.enabled) {
            return;
        }

        const lastTime = parseInt(localStorage.getItem('crafting.last'));
        if (lastTime && (lastTime + (autoCrafting.checkEveryMins * 60 * 1000)) > new Date().getTime()) {
            return;
        }
        localStorage.setItem('crafting.last', new Date().getTime().toString());

        console.log('Handling crafting creates...');

        let mgTokenSet = true;
        async function renewMgToken() {
            if (!mgTokenSet) {
                const user = await $.get('https://wf.my.com/minigames/craft/api/user-info');
                if (user.state === 'Success') {
                    const mgToken = user.data.token;
                    document.cookie = 'mg_token=' + mgToken + '; path=/';
                } else {
                    console.error('Fetched non success data', JSON.stringify(user));
                }
                mgTokenSet = true;
            }
        }

        let domeSomething = false;
        try {
            const data = await $.get('https://wf.my.com/minigames/craft/api/user-info');
            if (data.state === 'Success') {
                for (const chest of data.data.user_chests) {
                    if (chest.state === 'new' && autoCrafting.openCrates) {
                        await renewMgToken();
                        await $.post('https://wf.my.com/minigames/minigames/craft/api/start', { 'chest_id' : chest.id });
                        domeSomething = true;
                        console.info('%cStarted crafting ' + chest.type + ' create',
                            'color: lightblue; font-weight: bold');

                    } else if (chest.state === 'awaiting' && chest.ended_at < 0) {
                        await renewMgToken();
                        let openResponse = await $.post('https://wf.my.com/minigames/craft/api/open',
                            { 'chest_id' : chest.id, 'paid': 0 });
                        // {"state":"Success","data":{"resource":{"level":2,"amount":30}}}
                        if (openResponse.state === 'Success') {
                            const reward = openResponse.data.resource;
                            const msg = 'Crafting: crate=' + chest.type + ": reward=" + reward.level + '/' + reward.amount;
                            domeSomething = true;
                            await permaLog(msg);
                            if (reward.level >= 4) {
                                await sendMail('Warface: Crating reward', msg);
                            }
                        }
                    }
                }
            } else {
                console.error('Fetched non success data', JSON.stringify(data));
            }
        } catch (e) {
            console.error('Failed to handle crafting creates', e);
        }

        if (domeSomething) {
            // don't continue the chain
            return Promise.reject();
        }
    }

    function nothingToDo() {
        console.info('Warface crafter has nothing to do.');
        setupSlowRefresh();
    }

    function setupFastRefresh() {
        refreshDelayMillis = fastRefreshDelayMillis;
    }

    function setupSlowRefresh() {
        refreshDelayMillis = slowRefreshDelayMillis;
    }

    function requestRefresh() {
        if (!refreshAlreadySetUp) {
            refreshAlreadySetUp = true;

            setTimeout(function () {
                window.location.reload(false);
            }, refreshDelayMillis);

            console.info('Scheduled page reload in ' + (refreshDelayMillis / 1000) + ' secs');
        }
    }

    async function permaLog(msg, css) {
        if (css) {
            console.info('%c' + msg, css);
        } else {
            console.info(msg);
        }

        await db.permaLog.put({ msg: msg, time: new Date() });

        await publishPermaLogChanges();
    }

    // noinspection JSUnusedLocalSymbols
    async function delay(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    /**
     * Before use, configure and run in the browser console:
     *
     * localStorage.setItem('mails.apiKey', 'YOUR API KEY');
     * localStorage.setItem('mails.from', 'YOUR EMAIL');
     * localStorage.setItem('mails.to', 'YOUR EMAIL');
     */
    async function sendMail(subject, bodyHtml) {
        const apiKey = localStorage.getItem('mails.apiKey');
        const from = localStorage.getItem('mails.from');
        const to = localStorage.getItem('mails.to');

        if (!apiKey || !from || !to) {
            console.warn('E-Mail sending not configured.');
            return;
        }

        let data = await $.post('https://api.elasticemail.com/v2/email/send', {
            apikey: apiKey,
            subject: subject,
            from: from,
            to: to,
            bodyHtml: bodyHtml,
            isTransactional: true
        });

        if (!data.success) {
            console.error('Error sending email', JSON.stringify(data));
        }
    }

    window.wf_testmail = async function () {
        return sendMail('test from email crafter', 'test email from <b>crafter</b>');
    };

    const CRATE_TYPES = ['common', 'silver', 'gold', 'platinum'];

    function getCrateTypeIndex(createTypeName) {
        return CRATE_TYPES.indexOf(createTypeName);
    }

    window.wf_report = async function (opts) {
        opts = $.extend({}, { tailSize: 20, since: null, before: null }, opts);

        const report = { tail: [], byType: {}, total: 0, totalByType: [0, 0, 0, 0], frequencyByType: [0, 0, 0, 0] };

        await db.permaLog.each(log => {
            //console.info(log.time, log.msg);
            if (opts.since && log.id < opts.since) {
                return;
            } else if (opts.before && log.id >= opts.since) {
                return;
            }

            const msg = log.msg;

            if (msg.indexOf('Crafting:') !== 0) {
                return;
            }

            const result = extractCraftingResult(msg);
            updateByType(result);

            updateTail(log.time, msg);

            report.total++;
            report.totalByType[getCrateTypeIndex(result.type)]++;
        });

        CRATE_TYPES.forEach(function (type, index) {
            const rate = report.totalByType[index] / report.total;
            const rate3 = (report.byType[type] || { 3: 0 })[3] / report.totalByType[index];
            const rate4 = (report.byType[type] || { 4: 0 })[4] / report.totalByType[index];
            const rate5 = (report.byType[type] || { 5: 0 })[5] / report.totalByType[index];
            report.frequencyByType[index] =
                rate.toLocaleString('de', {style: 'percent'})
                + " III=" + rate3.toLocaleString('de', {style: 'percent'})
                + " IV=" + rate4.toLocaleString('de', {style: 'percent'})
                + " V=" + rate5.toLocaleString('de', {style: 'percent'})
            ;
        });

        function extractCraftingResult(msg) {
            // Crafting: crate=silver: reward=2/25
            const firstEqual = msg.indexOf('=');
            const type = msg.substring(firstEqual + 1, msg.indexOf(':', firstEqual));
            const slashPos = msg.indexOf('/');
            const level = parseInt(msg.substring(msg.indexOf('=', firstEqual + 1) + 1, slashPos));
            const amount = parseInt(msg.substring(slashPos + 1));
            return { type: type, level: level, amount: amount };
        }

        function updateTail(time, msg) {
            if (report.tail.length >= opts.tailSize) {
                report.tail.shift();
            }


            let formattedTime = time.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' })
                + " " + time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit'});
            let text = formattedTime + ' ' + msg;

            report.tail.push(text);
        }

        function updateByType(result) {
            report.byType[result.type] = report.byType[result.type] || { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
            report.byType[result.type]['' + result.level]++;
        }

        console.info('Report:', report);
        return report;
    };

    window.ka_crafting = function(platinumChance, slots, level5inPlatinumChance, daysToCraft, totalPlayers, winNumber) {
        platinumChance = platinumChance || (1/10);
        slots = slots || 8;
        level5inPlatinumChance = level5inPlatinumChance || (3/100);
        daysToCraft = daysToCraft || 180;
        totalPlayers = totalPlayers || 10000;
        winNumber = winNumber || 5;

        function tryCraftingIn(maxDays) {
            let wins = 0;
            let day = 1;
            for (; day <= maxDays; day++) {
                let cases = 0;
                for (let slot = 0; slot < slots; slot++) {
                    if (Math.random() < platinumChance) {
                        cases++;
                    }
                }
                for (let pcase = 0; pcase < cases; pcase++) {
                    if (Math.random() < level5inPlatinumChance) {
                        wins++;
                    }
                }
            }
            return wins;
        }

        let craftedPlayers = 0;
        let totalWins = 0;
        for (let player = 0; player < totalPlayers; player++) {
            const wins = tryCraftingIn(daysToCraft);
            totalWins += wins;
            if (wins >= winNumber) {
                craftedPlayers++;
            }
            if (player % 1000 === 0) {
                console.info('Calculated for', player, 'players');
            }
        }

        console.log('Weapons were crafted by', craftedPlayers, 'players from', totalPlayers,
            '(', (craftedPlayers / totalPlayers).toLocaleString('de', {style: 'percent'}), ')',
            'Average wins:', (totalWins / totalPlayers));
    };


})(console, window, document, localStorage, jQuery);
