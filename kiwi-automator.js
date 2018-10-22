// ==UserScript==
// @name         Kiwi Companion Automator
// @namespace    igor.mukhin@gmx.de
// @version      0.1.8
// @description  Automatically sends Warface KIWI Companion to missions, buys energy if needed. Configure before use!
// @author       Igor Mukhin
// @match        https://wf.my.com/kiwi
// @match        https://wf.my.com/create
// @require      https://code.jquery.com/jquery-3.3.1.min.js
// @require      https://unpkg.com/dexie@latest/dist/dexie.js
// -require      file:///D:/igor.mukhin/projects-jetbrain/kiwi-automator/kiwi-automator.js
// @grant        none
// ==/UserScript==

(function(console, window, document, $, localStorage) {
    'use strict';

    const waitBeforeStartMillis = 1500;

    let refreshDelayMillis = 1000;
    const fastRefreshDelayMillis = 100;
    const slowRefreshDelayMillis = 10 * 60 * 1000; // 15 mins

    // IMPORTANT: Edit here for your language
    const localization = {
        sendButtonText: 'Send',
        closeButtonText: 'Close',
        permanent: 'Permanent' /* Навсегда */
    };

    // For Lucky and Athlete
    const starsAttrs = {
        1: { energyCost: 3, durationMin: 15 },
        2: { energyCost: 7, durationMin: 30 },
        3: { energyCost: 10, durationMin: 60 }
    };
    const successMoneyReward = 10;
    const energyPurchasePrice = 50;

    // TODO: this data should be in the personal database.
    // The program should read the current state of attributes and save it to the database.
    // The data will be used for reporting.
    const myCompanionAttrs = [
        { after_id: 0, attrs: { s: 0, i: 5, d: 1, c: 4, l: 10 } },
        { after_id: 1905, attrs: { s: 0, i: 3, d: 1, c: 6, l: 10 } },
        { after_id: 4149, attrs: { s: 0, i: 3, d: 1, c: 10, l: 6 } },
        { after_id: 4486, attrs: { s: 0, i: 7, d: 1, c: 4, l: 8 } }
    ];

    /**
     * Engi missions: pripyat/Wheel, shark/Bite, icebreaker/Water, volcano/Ararat, anubis/Oasis
     * Medic missions: icebreaker/Bear
     * Rifleman: pripyat/School, anubis/Sphinx
     */
    const missions = {
        icebreaker_North: {
            chain: 'icebreaker',
            title: 'North',
            profile: 's' // strength (rifleman)
        },
        icebreaker_Water: {
            chain: 'icebreaker',
            title: 'Water',
            profile: 'i' // intellect (engi)
        },
        icebreaker_Bear: {
            chain: 'icebreaker',
            title: 'Bear',
            profile: 'c' // charisma (med)
        },
        icebreaker_Rift: {
            chain: 'icebreaker',
            title: 'Rift',
            profile: 'd' // dexterity (sniper)
        },
        anubis_Sphinx: {
            chain: 'anubis',
            title: 'Sphinx',
            profile: 's' // strength (rifleman)
        },
        anubis_Oasis: {
            chain: 'anubis',
            title: 'Oasis',
            profile: 'i' // intellect (engi)
        },
        pripyat_School: {
            chain: 'pripyat',
            title: 'School',
            profile: 's' // strength (rifleman)
        },
        pripyat_Death: {
            chain: 'pripyat',
            title: 'Death',
            profile: 'd' // dexterity (sniper)
        },
        pripyat_1986: {
            chain: 'pripyat',
            title: '1986',
            profile: 'c' // charisma (med)
        },
        pripyat_Wheel: {
            chain: 'pripyat',
            title: 'Wheel',
            profile: 'i' // intellect (engi)
        },
        shark_Hammer: {
            chain: 'shark',
            title: 'Hammer',
            profile: 's' // strength (rifleman)
        },
        shark_Meat: {
            chain: 'shark',
            title: 'Meat',
            profile: 'd' // dexterity (sniper)
        },
        shark_Bite: {
            chain: 'shark',
            title: 'Bite',
            profile: 'i' // intellect (engi)
        },
        volcano_Taupo: {
            chain: 'volcano',
            title: 'Taupo',
            profile: 's' // strength (rifleman)
        },
        volcano_Ararat: {
            chain: 'volcano',
            title: 'Ararat',
            profile: 'i' // intellect (engi)
        }
    };

    /*
    Выводы и предположения о распределении очков характеристих (level-50/Лаки/Атлет):
    - Количество звезд миссии не влияет на Шанс Успешного Прохода (ШУС)
    - ШУС при профильной характеристике 0 или 1 и при удаче 10 составляет приблиз. 70%
    - ШУС при профильной характеристике > 2 и при удаче 10 составляет около 50%.
      При профильной шестерке было 55%.
    - Пока единственный предмет навсегда выпал на профильной шестерке. Вероятно профильная
      характеристика увеличивает шанс на получение предмета навсегда.

      - Number of stars does not affect success rate [SR] (SR of 1-star mission is the same as for 3-star mission)
      - To achieve the best SR you need low mission attribute (for rifleman missions you need strength <= 2).
          But that decreases chances for permanent rewards.
      - To get more permanent rewards you need a high mission attribute (for rifleman missions you need strength >= 7)
          But that decreases success rate.
      - Chances of getting permanent reward from 1-star mission are very low (approx. 1 in 1000)
      -
     */

    const threeStarTasks = [ missions.volcano_Ararat, missions.anubis_Oasis, missions.shark_Bite, missions.pripyat_Wheel ];
    const oneStarTasks = [ missions.shark_Hammer /*, missions.icebreaker_North, missions.pripyat_School, missions.anubis_Sphinx */ ];
    const threeStarRate = 0; // 0..1

    function isEnoughEnergyForStars(stars) {
        return currentEnergy() >= starsAttrs[stars].energyCost;
    }

    const autosendToMission = {
        enabled: false,
        taskSupplier: () => {
            if (isEnoughEnergyForStars(3) && Math.random() < threeStarRate) {
                return { mission: randomItem(threeStarTasks), stars: 3 };
            } else {
                return { mission: randomItem(oneStarTasks), stars: 1 };
            }
        }
    };

    const autobuyEnergy = {
        enabled: false,
        buyIfEnergyLessThen: 3,
        buyIfMoneyMoreThen: 50
    };

    const autoCrafting = {
        enabled: true, /* will enable the feature that opens crates and claims their contents */
        openCrates: true, /* will open (start) crates. Deactivate if you wish to upgrade crates. */
        checkEveryMins: 0 /* minutes between checks */
    };

    let kiwiState = null;
    let currentEnergy = () => kiwiState.user.info.cheerfulness;
    let currentMoney = () => kiwiState.user.info.points;
    let db = null;
    let refreshAlreadySetUp = false;

    setTimeout(start, waitBeforeStartMillis);

    async function start() {
        // init db
        initDatabase();

        // start operations
        try {
            await handleCraftingCrates();

            //await fetchState();
            //await waitForMissionResults();
            //await buyEnergy();
            //await sendToMission();

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

    async function fetchState() {
        try {
            let data = await $.get('https://wf.my.com/minigames/bp4/info/compose' +
                '?methods=settings.avatar,user.info,settings.main,main.fund,tasks.active_tasks');

            kiwiState = data.data;
            if (data.state === 'Success') {
                //console.info(kiwiState);
                console.info('State fetched. Money:', currentMoney(), 'Energy:', currentEnergy());
            } else {
                console.error('Fetched non success data', JSON.stringify(data));
                throw new Error('Fetched non success data');
            }
        } catch (e) {
            console.error('Failed to load kiwi state');
            setupSlowRefresh();
            throw e;
        }
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

        let mgTokenSet = false;
        async function renewMgToken() {
            if (!mgTokenSet) {
                const user = await $.get('https://wf.my.com/minigames/user/info');
                if (user.state === 'Success') {
                    const mgToken = user.data.token;
                    // I don't know where setCookie comes from
                    setCookie('mg_token', mgToken);
                } else {
                    console.error('Fetched non success data', JSON.stringify(user));
                }
                mgTokenSet = true;
            }
        }

        let domeSomething = false;
        try {
            const data = await $.get('https://wf.my.com/minigames/bp4/craft/user-craft-info');
            if (data.state === 'Success') {
                for (const chest of data.data.user_chests) {
                    if (chest.state === 'new' && autoCrafting.openCrates) {
                        renewMgToken();
                        await $.post('https://wf.my.com/minigames/bp4/craft/start', { 'chest_id' : chest.id });
                        domeSomething = true;
                        console.info('%cStarted crafting ' + chest.type + ' create',
                            'color: lightblue; font-weight: bold');

                    } else if (chest.state === 'awaiting' && chest.ended_at < 0) {
                        renewMgToken();
                        let openResponse = await $.post('https://wf.my.com/minigames/bp4/craft/open',
                            { 'chest_id' : chest.id, 'paid': 0 });
                        // {"state":"Success","data":{"resource":{"level":2,"amount":30}}}
                        if (openResponse.state = 'Success') {
                            const reward = openResponse.data.resource;
                            const msg = 'Crafting: crate=' + chest.type + ": reward=" + reward.level + '/' + reward.amount;
                            domeSomething = true;
                            await permaLog(msg);
                            if (reward.level >= 4) {
                                await sendMail('Kiwi Automator: Crating reward', msg);
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

    async function openMissionWindow(chain, missionTitle) {
        const $openChainBtn = $('section.map .map__point.point-' + chain + ' .map__point__options .button');
        if (!$openChainBtn.length) {
            return new Error('can\'t find start chain button for chain ' + chain);
        }
        $openChainBtn.trigger('click');

        // wait for a chain window
        await waitUntil(500, 1000, 10, () => !!$('div.tasks.' + chain).length);

        if (missionTitle != null) {
            // open mission dialog
            const $missionBtn = $('div.tasks.' + chain +
                ' .tasks__item .avatar:has(.name span:contains(\'' + missionTitle + '\'))');
            if (!$missionBtn.length) {
                return new Error('can\'t find mission ' + missionTitle);
            }
            $missionBtn.trigger('click');

            // wait for a window with the mission title
            await waitUntil(500, 1000, 10, () => {
                const $title = $('div.tasks__window.avatar .tasks__info__top h4:contains(\'' + missionTitle + '\')');
                return !!$title.length;
            });
        }
    }

    async function getCurrentStars(task) {
        let response = await $.get('https://wf.my.com/minigames/bp4/info/tasks?chain=' + task.chain);

        // response.data.tasks.[colId].[taskId].current_star
        // ... .remaining_time
        for (const col_id in response.data.tasks) {
            let col = response.data.tasks[col_id];
            for (let mission_id in col) {
                let mission = col[mission_id];
                if (mission.id === task.task_id) {
                    return mission.current_star;
                }
            }
        }

        throw new Error('mission not found');
    }

    async function waitForMissionResults() {
        let task = kiwiState.tasks.active_tasks.find(t => t.type === 'avatar');
        if (!task) {
            return;
        }

        let currentStars = await getCurrentStars(task);

        let completeTime = task.started_at + starsAttrs[currentStars].durationMin * 60;
        let waitTimeSec = Math.floor(completeTime - (new Date().getTime() / 1000));
        if (waitTimeSec >= 60) {
            await openMissionWindow(task.chain, null);

            let waitLess = (waitTimeSec - 15);
            console.info('On mission ' + task.chain + '/' + task.title
                + '. Awaiting completion for ' + waitLess + ' secs.');

            await delay(waitLess * 1000);

            setupFastRefresh();

        } else {
            await openMissionWindow(task.chain, task.title);
            await processMissionResults(task);

        }

        // don't continue the chain
        return Promise.reject();
    }

    async function processMissionResults(task) {
        console.info('Waiting for mission results to come up');

        const $taskWindow = $('div.tasks__window.avatar');
        await waitUntil(0, 1000, 120, () => {
            const $reward = $taskWindow.find('.avatar__reward');
            const $closeBtn = $reward.find('.button:contains(\'' + localization.closeButtonText + '\')');
            return !!$closeBtn.length;
        });

        const $reward = $taskWindow.find('.avatar__reward');
        const $failed = $reward.find('.failed');
        const $success = $reward.find('.success');
        if ($failed.length) {
            await permaLog('Mission FAILED.', 'color: #7B241C; font-weight: bold;');

        } else if ($success.length) {
            const prize = $reward.find('.prize_item .name').text()
                        + ' ' + $reward.find('.prize_item .time').text();
            await permaLog('Mission SUCCESS. Reward: ' + prize, 'color: #196F3D; font-weight: bold;');

            if (prize.indexOf(localization.permanent) !== -1) {
                await sendMail('Kiwi: Got reward: ' + prize, prize);
            }

        }
    }

    async function buyEnergy() {
        if (autobuyEnergy.enabled
            && currentEnergy() < autobuyEnergy.buyIfEnergyLessThen
            && currentMoney() > autobuyEnergy.buyIfMoneyMoreThen) {

            console.info('Buying energy...');

            try {
                let data = await $.post('https://wf.my.com/minigames/bp4/user/buy-energy');
                // {"state":"Success","data":{"energy":{"from_energy":1,"to_energy":100,"points":1889}}}

                if (data.state === 'Success') {
                    await permaLog('Energy purchased');
                    // don't continue the chain
                    return Promise.reject();
                } else {
                    throw new Error('Fetched non success data' + JSON.stringify(data));
                }

            } catch (e) {
                setupSlowRefresh();
                throw e;
            }
        }
    }

    async function sendToMission() {
        let task = null;
        if (autosendToMission.enabled) {
            task = autosendToMission.taskSupplier();
        }
        if (task === null) {
            return;
        }

        await openMissionWindow(task.mission.chain, task.mission.title);
        await doSendToCurrentMission(task.stars);

        await permaLog('Sent to mission: ' + task.mission.chain + '/' + task.mission.title + '/' + task.stars);
        // don't continue the chain
        return Promise.reject();
    }

    async function doSendToCurrentMission(stars) {
        // select stars
        const $taskWindow = $('div.tasks__window.avatar');
        const $starsBtn = $taskWindow.find('.stars_list:nth-child(' + stars + ')');
        if (!$starsBtn.length) {
            throw new Error('can\'t find stars');
        }
        $starsBtn.trigger('click');

        await delay(500);

        // sending to mission
        const $sendBtn = $taskWindow.find('.button:contains(\'' + localization.sendButtonText + '\')');
        if (!$sendBtn.length) {
            throw new Error('can\'t find send button');
        }
        $sendBtn.trigger('click');

        await delay(500);
    }

    function nothingToDo() {
        console.info('KiwiAutomator has nothing to do. May be not enough energy or money...');
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

    /**
     * Use localStorage.getItem('jsbin.ID') to get the report url.
     */
    const jsbinIdLSName = 'jsbin.ID';
    async function publishPermaLogChanges() {
        try {
            let report = await collectFastReport();

            let id = localStorage.getItem(jsbinIdLSName);
            if (!id) {
                id = (await $.ajax('https://api.jsonbin.io/b', {
                    'data': JSON.stringify(report),
                    'type': 'POST',
                    'processData': false,
                    'contentType': 'application/json'
                })).id;
                localStorage.setItem(jsbinIdLSName, id);

            } else {
                await $.ajax('https://api.jsonbin.io/b/' + id, {
                    'data': JSON.stringify(report),
                    'type': 'PUT',
                    'processData': false,
                    'contentType': 'application/json'
                });
            }

        } catch (e) {
            console.error(e);
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

    window.ka_testmail = async function () {
        return sendMail('test from kiwi', 'test from <b>kiwi</b>');
    };

    // for testing
    window.ka_publishPermaLogChanges = publishPermaLogChanges;

    async function collectFastReport() {
        const report = { tail: [] };

        await db.permaLog.reverse().limit(50).each(log => {
            report.tail.push(log);
        });

        return report;
    }

    const CHAINS = ['pripyat', 'shark', 'icebreaker', 'volcano', 'anubis'];

    window.ka_completions = async function () {
        const missions = [];
        for (const chain of CHAINS) {
            let response = await $.get('https://wf.my.com/minigames/bp4/info/tasks?chain=' + chain);

            for (const col_id in response.data.tasks) {
                let col = response.data.tasks[col_id];
                for (let mission_id in col) {
                    let mission = col[mission_id];
                    if (mission.type === 'avatar') {
                        mission.chain = chain;
                        missions.push(mission);
                    }
                }
            }
        }

        missions.sort((a, b) => a.tasks_completed - b.tasks_completed);

        const report = [];
        for (const mission of missions) {
            report.push({
                chain: mission.chain,
                title: mission.title,
                kind: mission.kind,
                completed: mission.tasks_completed
            });
        }

        console.info(report);
        return report;
    };

    window.ka_report = async function (opts) {
        opts = $.extend({}, { tailSize: 20, since: null, before: null, stars: null }, opts);

        const report = { permanents: [], days: {}, missions: {}, tail: [],
            summary: { money: 0, runs: 0, wins: 0, permanents: 0 }};
        let mission = null;

        await db.permaLog.each(log => {
            //console.info(log.time, log.msg);
            if (opts.since && log.id < opts.since) {
                return;
            } else if (opts.before && log.id >= opts.since) {
                return;
            }

            const msg = log.msg;
            //const day = log.time.toLocaleDateString("de-DE", { month: '2-digit', day: '2-digit'});
            const day = ('0' + (log.time.getMonth() + 1)).slice(-2) + '.'
                + ('0' + log.time.getDate()).slice(-2);

            report.days[day] = report.days[day] || { won: 0, lost: 0, total: 0, rate: 0, money: 0, energyBuys: 0 };
            const dayStats = report.days[day];
            if (msg.indexOf('Energy purchased') !== -1) {
                dayStats.energyBuys++;
                dayStats.money -= energyPurchasePrice;

            } else if (msg.indexOf('Sent to mission: ') === 0) {
                mission = msg.substring('Sent to mission: '.length);

            } else if (msg.indexOf('SUCCESS') !== -1 || msg.indexOf('FAILED') !== -1) {
                const missionStars = extractStarsFromMissionName(mission);
                if (opts.stars && opts.stars !== missionStars) {
                    // ignore
                } else if (msg.indexOf('SUCCESS') !== -1) {
                    dayStats.won++;
                    dayStats.money += successMoneyReward;
                    dayStatsUpdated(dayStats);

                    let numOfPermanents = 0;
                    let reward = msg.substring(msg.indexOf('Reward') + 8);
                    if (reward.indexOf(localization.permanent) !== -1) {
                        numOfPermanents++;
                        report.permanents.push({day: day, reward: reward, mission: mission});
                    }

                    updateMissionStats(1, numOfPermanents);
                    updateTail(log.time, mission, 'SUCCESS', reward);

                } else if (msg.indexOf('FAILED') !== -1) {
                    dayStats.lost++;
                    dayStatsUpdated(dayStats);
                    updateMissionStats(0, 0);
                    updateTail(log.time, mission, 'FAILED', null);
                }
            }
        });

        for (const day in report.days) {
            const dayStats = report.days[day];
            report.summary.money += dayStats.money;
            report.summary.runs += dayStats.total;
            report.summary.wins += dayStats.won;
        }
        report.summary.permanents = report.permanents.length;

        function dayStatsUpdated(dayStats) {
            const fraction = dayStats.won / (dayStats.won + dayStats.lost);
            dayStats.rate = fraction.toLocaleString('de', {style: 'percent'});
            dayStats.total = dayStats.won + dayStats.lost;
        }

        function updateMissionStats(won, numOfPermanents) {
            if (mission != null) {
                report.missions[mission] = report.missions[mission] || {won: 0, total: 0, rate: 0, permanents: 0};
                const missionStats = report.missions[mission];
                missionStats.won += won;
                missionStats.total++;
                const rate = missionStats.won / missionStats.total;
                missionStats.rate = rate.toLocaleString('de', {style: 'percent'});
                missionStats.permanents += numOfPermanents;
            }
        }

        function updateTail(time, mission, result, reward) {
            if (report.tail.length >= opts.tailSize) {
                report.tail.shift();
            }

            let formattedTime = time.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' })
                + " " + time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit'});
            let text = formattedTime + ' ' + mission + ' ' + result + (reward ? ' ' + reward : '');

            report.tail.push(text);
        }

        console.info('Report:', report);
        return report;
    };

    function extractStarsFromMissionName(name) {
        if (!name) {
            return null;
        }

        return parseInt(name.substring(name.indexOf('/', name.indexOf('/') + 1) + 1));
    }


    window.ka_crafting_report = async function () {
        const report = { };

        await db.permaLog.each(log => {
            //console.info(log.time, log.msg);
            const msg = log.msg;

            if (msg.indexOf('Crafting:') !== 0) {
                return;
            }

            const result = extractCraftingResult(msg);
            report[result.type] = report[result.type] || { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
            report[result.type]['' + result.level]++;
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

        console.info('Report:', report);
        return report;
    };

    window.ka_deleteLogs = async function (fromId, toId) {
        if (!fromId) {
            throw new Error('Error: syntax window.ka_deleteLogs(fromId [, toId])');
        }
        toId = toId || fromId;

        if (toId < fromId) {
            throw new Error('Error: fromId greater than toID');
        }

        let statement = db.permaLog.where('id').between(fromId, toId, true, true);
        await statement.delete();

        return 'Deletion completed';
    };

    window.ka_randoms = function(chance, length) {
        let str = '';
        const chanceN = chance / 100;
        for (let i = 0; i < length; i++) {
            str += (Math.random() <= chanceN ? 'X' : '-');
        }
        return str + " " + (((str.match(/X/g) || []).length) / length).toLocaleString('de', {style: 'percent'});
    };

    function randomItem(items) {
        return items[Math.floor(Math.random() * items.length)];
    }

    /**
     * Simulates weapon crafting.
     */
    window.ka_crafting = function(platinumChance, slots, level5inPlatinumChance, daysToCraft, totalPlayers, winNumber) {
        platinumChance = platinumChance || (1/13);
        slots = slots || 8;
        level5inPlatinumChance = level5inPlatinumChance || (1/50);
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

})(console, window, document, jQuery, localStorage);
