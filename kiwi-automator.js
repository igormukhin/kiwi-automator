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

    const energyForStars = {
      1: 3,
      2: 7,
      3: 10
    };

    const mission_Water = {
        continent: 'icebreaker',
        mission: 'Water',
        companion: { s: 0, i: 5, d: 1, c: 4, l: 10 }
    };

    const mission_Bear = {
        continent: 'icebreaker',
        mission: 'Bear',
        companion: { s: 0, i: 3, d: 1, c: 6, l: 10 }
    };

    /**
     * Engi missions: pripyat/Wheel, shark/Bite, icebreaker/Water, volcano/Ararat, anubis/Oasis
     * Medic missions: icebreaker/Bear
     *
     * NOTE: After changing the mission, remember to get the results of the previous mission manually. It will not
     * happen automatically.
     */
    const autosendToMission = {
        enabled: true,
        continent: 'icebreaker',
        mission: 'Bear',
        stars: 3,
        starsOnLowEnergy: 1,
        winMoneyReward: 10,
        sendButtonText: 'Send',
        closeButtonText: 'Close',
        characterOnMissionText: 'Character on mission'
    };

    const autobuyEnergy = {
        enabled: true,
        buyIfEnergyLessThen: 3,
        buyIfMoneyMoreThen: 100,
        price: 50
    };

    let currentEnergy = null;
    let currentMoney = null;
    let db = null;

    console.log('Staring KiwiAutomator...');
    setTimeout(start, waitBeforeStartMillis);

    function start() {
        // init db
        db = new Dexie("kiwi_automator");
        db.version(1).stores({
            permaLog: '++id'
        });

        // start operations
        runOperations([ initEnergy, initMoney,
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
        console.log('KiwiAutomator has nothing to do. May be not enough energy or money...');
        setupSlowRefresh();
        return Promise.reject();
    }

    function openMissionWindow() {
        if (!autosendToMission.enabled) {
            return Promise.resolve();
        }

        const deferred = $.Deferred();
        console.log('Opening mission dialog...');

        setTimeout(function () {
            // open continent
            const pointBtn = document.querySelector('section.map .map__point.point-' + autosendToMission.continent
                + ' .map__point__options .button');
            if (!pointBtn) {
                console.log('cant find continent');
                deferred.reject();
                return;
            }
            simulateClick(pointBtn);

            setTimeout(function () {
                // open mission dialog
                const $missionBtn = $('div.tasks.' + autosendToMission.continent +
                    ' .tasks__item .avatar:has(.name span:contains(\'' + autosendToMission.mission + '\'))');
                if (!$missionBtn.length) {
                    console.log('cant find mission');
                    deferred.reject();
                    return;
                }
                $missionBtn.trigger('click');

                setTimeout(function () {
                    // check mission here
                    const $title = $('div.tasks__window.avatar .tasks__info__top h4:contains(\'' + autosendToMission.mission + '\')');
                    if (!$title.length) {
                        console.log('Failure: Mission is not correct!');
                        setupSlowRefresh();
                        deferred.reject();
                        return;
                    }

                    console.log('Mission window opened');

                    // continue the execution chain
                    deferred.resolve();
                }, 1000)
            }, 1000);
        }, 10);

        return deferred.promise();
    }

    function detectOnMission() {
        if (!autosendToMission.enabled) {
            return Promise.resolve();
        }

        const deferred = $.Deferred();
        console.log('Checking if character is on the mission...');

        // check wrong mission
        const $taskWindow = $('div.tasks__window.avatar');
        const $onMissionText = $taskWindow.find('.bottom'
            + ' .completed__text:contains(\'' + autosendToMission.characterOnMissionText + '\')');
        if ($onMissionText.length) {
            console.log('Detected character is on OTHER mission! You have to finish other mission manually!');
            setupSlowRefresh();
            return Promise.reject();
        }

        // check if waiting
        const $waiting = $taskWindow.find('.prize_container.processing');
        const $prizeCont = $taskWindow.find('.prize_container');
        if ($waiting.length || !$prizeCont.length) {
            console.log('Detected character on mission');

            let secsLeft = null;
            const $timer = $taskWindow.find('.timer__text');
            if ($timer.length) {
                const timeStr = $timer.text();
                if (timeStr.indexOf(':') !== -1) {
                    secsLeft = 60 * parseInt(timeStr.substring(3, 5));
                } else {
                    secsLeft = parseInt(timeStr);
                }
                //console.log('Seconds to mission end =', secsLeft);
            }

            if (secsLeft >= 60) {
                // wait until 1 minute left and then reload page
                let waitForSecs = secsLeft - 60;
                if (waitForSecs === 0) {
                    waitForSecs = 45;
                }

                console.log('Waiting mission end for ' + waitForSecs + ' secs.');
                setTimeout(function () {
                    setupFastRefresh();
                    deferred.reject();
                }, waitForSecs * 1000);
                return deferred.promise();
            }

            // under minute time left or even results is here
            // wait for close button to come up
            console.log('Waiting for results to come up');
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
                        permaLog('Mission FAILED.');
                    } else if ($success.length) {
                        permaLog('Mission SUCCESS. Reward: '
                            + $reward.find('.prize_item .name').text()
                            + ' ' + $reward.find('.prize_item .time').text());
                    } else {
                        permaLog('Mission result not found?!?!?!');
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
            console.log('Character is not on mission');

            // continue the execution chain
            deferred.resolve();
        }

        return deferred.promise();
    }

    function sendToMission() {
        let stars = null;
        if (autosendToMission.enabled) {
            if (currentEnergy >= energyForStars[autosendToMission.stars]) {
                stars = autosendToMission.stars;
            } else if (autosendToMission.starsOnLowEnergy > 0
                    && currentEnergy >= energyForStars[autosendToMission.starsOnLowEnergy]) {
                stars = autosendToMission.starsOnLowEnergy;
            }
        }
        if (stars === null) {
            return Promise.resolve();
        }

        const deferred = $.Deferred();
        console.log('Sending to mission...');

        // select stars
        const $starsBtn = $('div.tasks__window.avatar .stars_list:nth-child(' + stars + ')');
        if (!$starsBtn.length) {
            console.log('cant find stars');
            deferred.reject();
            return deferred.promise();
        }
        $starsBtn.trigger('click');

        setTimeout(function () {
            // sending to mission
            const $sendBtn = $('div.tasks__window.avatar .button:contains(\'' + autosendToMission.sendButtonText + '\')');
            if (!$sendBtn.length) {
                console.log('cant find send button');
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

    function buyEnergy() {
        if (autobuyEnergy.enabled
            && currentEnergy < autobuyEnergy.buyIfEnergyLessThen
            && currentMoney > autobuyEnergy.buyIfMoneyMoreThen) {
            const deferred = $.Deferred();
            console.info('Buying energy...');

            closeMissionWindow().done(() => {
                console.info('Buying energy after mission dialogs are closed...');

                // click plus button
                const $sendBtn = $('header.header .energy .button--plus');
                if (!$sendBtn.length) {
                    console.error('can\'t find energy plus button');
                    deferred.reject();
                    return;
                }
                $sendBtn.trigger('click');

                setTimeout(() => {
                    // buying energy
                    const $buyBtn = $('.purchase .buy-energy .buy-energy__purchase > .button--progress');
                    if (!$buyBtn.length) {
                        console.error('can\'t find purchase energy button');
                        deferred.reject();
                        return;
                    }

                    simulateClick($buyBtn[0], 'touchstart');
                    setTimeout(() => {
                        const $animStarted = $buyBtn.find('.button__animation.animation_inprogress');
                        if (!$animStarted.length) {
                            console.error('can\'t buy energy. Button does not react!');
                            deferred.resolve();
                            return;
                        }

                        permaLog('Energy purchased');
                        deferred.reject();

                    }, 200);

                }, 1000);
            });

            return deferred.promise();
        } else {
            return Promise.resolve();
        }
    }

    function initEnergy() {
        currentEnergy = readCurrentEnergy();
        if (currentEnergy == null) {
            console.log('Can\'t read energy. Kiwi does not load? Not signed in?');
            return false;
        }
        console.log('currentEnergy=', currentEnergy);

        return Promise.resolve();
    }

    function readCurrentEnergy() {
        const elem = document.querySelector('header.header .energy .value');
        if (elem == null) return;
        const value = elem.textContent;
        return parseInt(value.slice(0, -1)); // remove % and parse
    }

    function initMoney() {
        currentMoney = readCurrentMoney();
        if (currentMoney == null) {
            console.log('Can\'t read money. Kiwi does not load? Not signed in?');
            return false;
        }
        console.log('currentMoney=', currentMoney);

        return Promise.resolve();
    }

    function readCurrentMoney() {
        const elem = document.querySelector('header.header .points .value');
        if (elem == null) return;
        const value = elem.textContent;
        return parseInt(value); // remove % and parse
    }

    function runOperations(funcs) {
        const chain = new ExecutionChain();

        for (const func of funcs) {
            chain.submit(func, requestRefresh);
        }
    }

    function requestRefresh() {
        setTimeout(function () {
            window.location.reload(false);
        }, refreshDelayMillis);

        // TODO: somehow it is always started 2 times
        console.log('Scheduled page reload in ' + (refreshDelayMillis / 1000) + ' secs');
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
     *         console.log('Completed');
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

    function permaLog(msg) {
        console.log(msg);
        db.permaLog.put({ msg: msg, time: new Date() });
    }

    window.ka_report = function () {
        const report = { permanents: [], days: {}, missions: {}, tail: [],
            summary: { money: 0, permanents: 0 }};
        let mission = null;
        const tailLength = 20;

        db.permaLog.each(log => {
            //console.log(log.time, log.msg);
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
            console.log('Report:', report);
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

        return 'Report will be printed.';
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
            console.log('Deleted.');
        });

        return 'Deleting...';
    };

})(console, window, document, jQuery);
