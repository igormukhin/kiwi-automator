// ==UserScript==
// @name         Kiwi Companion Automator
// @namespace    igor.mukhin@gmx.de
// @version      0.1.8
// @description  Automatically sends Warface KIWI Companion to missions, buys energy if needed. Configure before use!
// @author       Igor Mukhin
// @match        https://wf.my.com/kiwi
// @require      http://code.jquery.com/jquery-3.3.1.min.js
// @require      https://unpkg.com/dexie@latest/dist/dexie.js
// -require      file:///D:/igor.mukhin/projects-jetbrain/kiwi-automator/kiwi-automator.js
// @grant        none
// ==/UserScript==

(function(console, window, document, $) {
    'use strict';

    const waitBeforeStartMillis = 1000;

    let refreshDelayMillis = 5 * 1000;
    const fastRefreshDelayMillis = 100;
    const slowRefreshDelayMillis = 600 * 1000;

    const starsAttrs = {
        1: { energyCost: 3, durationMin: 15 },
        2: { energyCost: 7, durationMin: 30 },
        3: { energyCost: 10, durationMin: 60 }
    };

    // engi (intellect: 5, luck: 10)
    const mission_Water = {
        continent: 'icebreaker',
        mission: 'Water',
        companion: { s: 0, i: 5, d: 1, c: 4, l: 10 }
    };

    // med (charisma: 6, luck: 10)
    const mission_Bear = {
        continent: 'icebreaker',
        mission: 'Bear',
        companion: { s: 0, i: 3, d: 1, c: 6, l: 10 }
    };

    // rifleman (strength: 0, luck: 10)
    const mission_Sphinx = {
        continent: 'anubis',
        mission: 'Sphinx',
        companion: { s: 0, i: 3, d: 1, c: 6, l: 10 }
    };

    // rifleman (strength: 0, luck: 10)
    const mission_School = {
        continent: 'pripyat',
        mission: 'School',
        companion: { s: 0, i: 3, d: 1, c: 6, l: 10 }
    };

    /**
     * Engi missions: pripyat/Wheel, shark/Bite, icebreaker/Water, volcano/Ararat, anubis/Oasis
     * Medic missions: icebreaker/Bear
     * Rifleman: pripyat/School, anubis/Sphinx
     *
     * NOTE: After changing the mission, remember to get the results of the previous mission manually. It will not
     * happen automatically.
     */
    const autosendToMission = {
        enabled: true,
        continent: 'pripyat',
        mission: 'School',
        stars: 1,
        starsOnLowEnergy: 1,
        winMoneyReward: 10,
        sendButtonText: 'Send',
        closeButtonText: 'Close',
        characterOnMissionText: 'Character on mission',
        gettingResultsText: 'Getting results'
    };

    const autobuyEnergy = {
        enabled: true,
        buyIfEnergyLessThen: 3,
        buyIfMoneyMoreThen: 100,
        price: 50
    };

    let kiwiState = null;
    let currentEnergy = () => kiwiState.user.info.cheerfulness;
    let currentMoney = () => kiwiState.user.info.points;
    let db = null;
    let refreshAlreadySetUp = false;

    start();

    function start() {
        // init db
        db = new Dexie("kiwi_automator");
        db.version(1).stores({
            permaLog: '++id'
        });

        // start operations
        runOperations([ initialDelay, fetchState,
            openMissionWindow, detectOnMission, buyEnergy, sendToMission,
            nothingToDo ]);
    }

    function setupFastRefresh() {
        refreshDelayMillis = fastRefreshDelayMillis;
    }

    function setupSlowRefresh() {
        refreshDelayMillis = slowRefreshDelayMillis;
    }

    function nothingToDo() {
        console.info('KiwiAutomator has nothing to do. May be not enough energy or money...');
        setupSlowRefresh();
        return Promise.reject();
    }

    function openMissionWindow() {
        //if (!autosendToMission.enabled) {
        //    return Promise.resolve();
        //}

        const deferred = $.Deferred();
        //console.info('Opening mission dialog...');

        setTimeout(function () {
            // open continent
            const pointBtn = document.querySelector('section.map .map__point.point-' + autosendToMission.continent
                + ' .map__point__options .button');
            if (!pointBtn) {
                console.error('cant find continent');
                deferred.reject();
                return;
            }
            simulateClick(pointBtn);

            setTimeout(function () {
                // open mission dialog
                const $missionBtn = $('div.tasks.' + autosendToMission.continent +
                    ' .tasks__item .avatar:has(.name span:contains(\'' + autosendToMission.mission + '\'))');
                if (!$missionBtn.length) {
                    console.error('cant find mission');
                    deferred.reject();
                    return;
                }
                $missionBtn.trigger('click');

                setTimeout(function () {
                    // check mission here
                    const $title = $('div.tasks__window.avatar .tasks__info__top h4:contains(\'' + autosendToMission.mission + '\')');
                    if (!$title.length) {
                        console.error('Failure: Mission is not correct!');
                        setupSlowRefresh();
                        deferred.reject();
                        return;
                    }

                    //console.info('Mission window opened');

                    // continue the execution chain
                    deferred.resolve();
                }, 500)
            }, 500);
        }, 10);

        return deferred.promise();
    }

    function detectOnMission() {
        //if (!autosendToMission.enabled) {
        //    return Promise.resolve();
        //}

        const deferred = $.Deferred();
        //console.info('Checking if character is on the mission...');

        // check wrong mission
        const $taskWindow = $('div.tasks__window.avatar');
        const $onMissionText = $taskWindow.find('.bottom'
            + ' .completed__text:contains(\'' + autosendToMission.characterOnMissionText + '\')');
        if ($onMissionText.length) {
            console.warn('Detected character is on OTHER mission! You have to finish other mission manually!');
            setupSlowRefresh();
            return Promise.reject();
        }

        // check if on mission waiting
        const $waiting = $taskWindow.find('.prize_container.processing');
        const $rewardCont = $taskWindow.find('.avatar__reward');
        const $gettingResults = $taskWindow.find('.bottom'
            + ' .completed__text:contains(\'' + autosendToMission.gettingResultsText + '\')');
        if ($waiting.length || $rewardCont.length || $gettingResults.length) {
            console.info('Detected character on mission');

            let secsLeft = null;
            const $timer = $taskWindow.find('.timer__text');
            if ($timer.length) {
                const timeStr = $timer.text();
                if (timeStr.indexOf(':') !== -1) {
                    secsLeft = 60 * parseInt(timeStr.substring(3, 5));
                } else {
                    secsLeft = parseInt(timeStr);
                }
                //console.info('Seconds to mission end =', secsLeft);
            }

            if (secsLeft != null && secsLeft >= 60) {
                // wait until 1 minute left and then reload page
                let waitForSecs = secsLeft - 60;
                if (waitForSecs === 0) {
                    waitForSecs = 45;
                }

                console.info('Waiting mission end for ' + waitForSecs + ' secs.');
                setTimeout(function () {
                    setupFastRefresh();
                    deferred.reject();
                }, waitForSecs * 1000);
                return deferred.promise();
            }

            // under minute time left or even results are here
            // wait for close button to come up
            console.info('Waiting for mission results to come up');
            let intervalTimes = 0;
            const intervalDuration = 1000;
            const intervalMaxTimes = 120;
            const intervalId = setInterval(function () {
                const $reward = $taskWindow.find('.avatar__reward');
                const $closeBtn = $reward.find('.button:contains(\'' + autosendToMission.closeButtonText + '\')');
                if ($closeBtn.length) {
                    const $failed = $reward.find('.failed');
                    const $success = $reward.find('.success');
                    if ($failed.length) {
                        permaLog('Mission FAILED.', 'color: #7B241C; font-weight: bold;');
                    } else if ($success.length) {
                        permaLog('Mission SUCCESS. Reward: '
                            + $reward.find('.prize_item .name').text()
                            + ' ' + $reward.find('.prize_item .time').text(), 'color: #196F3D; font-weight: bold;');
                    } else {
                        permaLog('Error: Mission result not found');
                    }

                    //setupFastRefresh();
                    clearInterval(intervalId);
                    deferred.reject();
                    return;
                }

                intervalTimes++;
                // too many repetitions
                if (intervalTimes > intervalMaxTimes) {
                    permaLog('Waited for mission results for too long.');
                    setupFastRefresh();
                    deferred.reject();
                }
            }, intervalDuration);

        } else {
            console.info('Character is not on mission');

            // continue the execution chain
            deferred.resolve();
        }

        return deferred.promise();
    }

    function sendToMission() {
        let stars = null;
        if (autosendToMission.enabled) {
            if (currentEnergy() >= starsAttrs[autosendToMission.stars].energyCost) {
                stars = autosendToMission.stars;
            } else if (autosendToMission.starsOnLowEnergy > 0
                && currentEnergy() >= starsAttrs[autosendToMission.starsOnLowEnergy].energyCost) {
                stars = autosendToMission.starsOnLowEnergy;
            }
        }
        if (stars === null) {
            return Promise.resolve();
        }

        const deferred = $.Deferred();
        //console.info('Sending to mission...');

        // select stars
        const $starsBtn = $('div.tasks__window.avatar .stars_list:nth-child(' + stars + ')');
        if (!$starsBtn.length) {
            console.error('cant find stars');
            deferred.reject();
            return deferred.promise();
        }
        $starsBtn.trigger('click');

        setTimeout(function () {
            // sending to mission
            const $sendBtn = $('div.tasks__window.avatar .button:contains(\'' + autosendToMission.sendButtonText + '\')');
            if (!$sendBtn.length) {
                console.error('cant find send button');
                deferred.reject();
                return;
            }

            $sendBtn.trigger('click');
            permaLog('Sent to mission: ' + autosendToMission.continent + '/' + autosendToMission.mission + '/' + stars);

            // don't continue the chain
            deferred.reject();
        }, 1000);

        return deferred.promise();
    }

    function simulateClick(elem, evtName) {
        const evt = new MouseEvent(evtName || 'click', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        elem.dispatchEvent(evt);
    }

    /*
    function closeMissionWindow() {
        const deferred = $.Deferred();

        // close continent dialog
        var $closeBtn = $('section > .screen > .screen__inner > .close');
        $closeBtn.trigger('click');

        setTimeout(() => {
            deferred.resolve();
        }, 200);

        return deferred.promise();
    }
    */

    function buyEnergy() {
        if (autobuyEnergy.enabled
            && currentEnergy() < autobuyEnergy.buyIfEnergyLessThen
            && currentMoney() > autobuyEnergy.buyIfMoneyMoreThen) {

            const deferred = $.Deferred();
            console.info('Buying energy...');

            $.post('https://wf.my.com/minigames/bp4/user/buy-energy').done((data) => {

                if (data.state === 'Success') {
                    console.info(JSON.stringify(data));
                    permaLog('Energy purchased');
                    deferred.reject();
                } else {
                    setupSlowRefresh();
                    console.error('Fetched non success data', JSON.stringify(data));
                    deferred.reject();
                }

            }).fail(() => {
                setupSlowRefresh();
                console.error('Failed to buy energy');
                deferred.reject();
            });

            return deferred.promise();
        } else {
            return Promise.resolve();
        }
    }

    function initialDelay() {
        const deferred = $.Deferred();

        setTimeout(() => {
            //console.info('Staring KiwiAutomator...');
            deferred.resolve();
        }, waitBeforeStartMillis);

        return deferred.promise();
    }

    function fetchState() {
        const deferred = $.Deferred();

        $.get('https://wf.my.com/minigames/bp4/info/compose?methods=settings.avatar,user.info,settings.main,main.fund,tasks.active_tasks')
            .done((data) => {
                kiwiState = data.data;
                if (data.state === 'Success') {
                    //console.info(kiwiState);
                    console.info('State fetched. Money:', currentMoney(), 'Energy:', currentEnergy());
                    deferred.resolve();
                } else {
                    console.error('Fetched non success data', JSON.stringify(data));
                    setupSlowRefresh();
                    deferred.reject();
                }
            }).fail(() => {
                console.error('Failed to load init data');
                deferred.reject();
            });

        return deferred.promise();
    }

    function runOperations(funcs) {
        const chain = new ExecutionChain();

        for (const func of funcs) {
            chain.submit(func, requestRefresh);
        }
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

    /**
     * Executes submitted jobs in order.
     *
     * Useful for async jobs. Async jobs should return a promise.
     * After the promise is resolved, the next job will be executed.
     *
     * Use .submit(job) to add a new job.
     *
     * Example of a async job:
     *
     * executionChain.submit(function() {
     *     var deferred = $.Deferred();
     *     setTimeout(function () {
     *         console.info('Completed');
     *         deferred.resolve();
     *     }, 2000);
     *     return deferred.promise();
     * });
     *
     * @returns {ExecutionChain}
     * @constructor
     */
    function ExecutionChain() {
        let lastPromise = $.when();
        this.submit = function (job, onFail) {
            if (!$.isFunction(job)) {
                throw "not a function: " + job;
            }
            lastPromise = lastPromise.then(job, function () {
                onFail();
                return Promise.reject();
            });
        };
        return this;
    }

    function permaLog(msg, css) {
        if (css) {
            console.info('%c' + msg, css);
        } else {
            console.info(msg);
        }

        db.permaLog.put({ msg: msg, time: new Date() });
    }

    window.ka_report = function () {
        const report = { permanents: [], days: {}, missions: {}, tail: [],
            summary: { money: 0, permanents: 0 }};
        let mission = null;
        const tailLength = 20;

        db.permaLog.each(log => {
            //console.info(log.time, log.msg);
            const msg = log.msg;
            //const day = log.time.toLocaleDateString("de-DE", { month: '2-digit', day: '2-digit'});
            const day = ('0' + (log.time.getMonth() + 1)).slice(-2) + '.'
                + ('0' + log.time.getDate()).slice(-2);

            report.days[day] = report.days[day] || { won: 0, lost: 0, total: 0, rate: 0, money: 0, energyBuys: 0 };
            const dayStats = report.days[day];
            if (msg.indexOf('Energy purchased') !== -1) {
                dayStats.energyBuys++;
                dayStats.money -= autobuyEnergy.price;

            } else if (msg.indexOf('Sent to mission: ') === 0) {
                mission = msg.substring('Sent to mission: '.length);

            } else if (msg.indexOf('SUCCESS') !== -1) {
                dayStats.won++;
                dayStats.money += autosendToMission.winMoneyReward;
                dayStatsUpdated(dayStats);

                let numOfPermanents = 0;
                let reward = msg.substring(msg.indexOf('Reward') + 8);
                if (reward.indexOf('Permanent') !== -1) {
                    numOfPermanents++;
                    report.permanents.push({ day: day, reward: reward });
                }

                updateMissionStats(1, numOfPermanents);
                updateTail(log.time, mission, 'SUCCESS', reward);

            } else if (msg.indexOf('FAILED') !== -1) {
                dayStats.lost++;
                dayStatsUpdated(dayStats);
                updateMissionStats(0, 0);
                updateTail(log.time, mission, 'FAILED', null);
            }

        }).then(() => {
            for (const day in report.days) {
                const dayStats = report.days[day];
                report.summary.money += dayStats.money;
            }
            report.summary.permanents = report.permanents.length;

        }).then(() => {
            console.info('Report:', report);
        });

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
            if (report.tail.length >= tailLength) {
                report.tail.shift();
            }

            let formattedTime = time.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' })
                    + " " + time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit'});
            let text = formattedTime + ' ' + mission + ' ' + result + (reward ? ' ' + reward : '');

            report.tail.push(text);
        }

        return 'Generating report...';
    };

    window.ka_deleteLogs = function (fromId, toId, msgFilter) {
        if (!fromId) {
            return 'Error: syntax window.ka_deleteLogs(fromId [, toId][, msgFilter])';
        }
        toId = toId || fromId;

        if (toId < fromId) {
            return 'Error: fromId greater than toID';
        }

        let statement = db.permaLog.where('id').between(fromId, toId, true, true);
        //if (msgFilter) {
        //    statement = statement.equalsIgnoreCase()
        //}
        statement.delete().then(() => {
            console.info('Deleted.');
        });

        return 'Deleting...';
    };

})(console, window, document, jQuery);
