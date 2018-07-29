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

    let refreshDelayMillis = 15 * 1000;
    const fastRefreshDelayMillis = 100;
    const slowRefreshDelayMillis = 600 * 1000;

    /**
     * Engi missions: pripyat/Wheel, shark/Bite, icebreaker/Water, volcano/Ararat, anubis/Oasis
     *
     * NOTE: After changing the mission, remember to get the results of the previous mission manually. It will not
     * happen automatically.
     */
    const autosendToMission = {
        enabled: true,
        continent: 'icebreaker',
        mission: 'Water',
        minEnergy: 3,
        stars: 1,
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
            buyEnergy,
            openMissionWindow, detectOnMission, sendToMission,
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

                    console.log('Mission windows opened');

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

            // close dialog
            //var $closeBtn = $('section > .screen > .screen__inner > .close');
            //$closeBtn.trigger('click');

        } else {
            console.log('Character is not on mission');

            // continue the execution chain
            deferred.resolve();
        }

        return deferred.promise();
    }

    function sendToMission() {
        if (autosendToMission.enabled
            && currentEnergy >= autosendToMission.minEnergy) {
        } else {
            return Promise.resolve();
        }

        const deferred = $.Deferred();
        console.log('Sending to mission...');

        // select stars
        const $starsBtn = $('div.tasks__window.avatar .stars_list:nth-child(' + autosendToMission.stars + ')');
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
            permaLog('Sent to mission: ' + autosendToMission.continent + '/' + autosendToMission.mission + '/'
                    + autosendToMission.stars);

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

    function buyEnergy() {
        if (autobuyEnergy.enabled
            && currentEnergy < autobuyEnergy.buyIfEnergyLessThen
            && currentMoney > autobuyEnergy.buyIfMoneyMoreThen) {
            const deferred = $.Deferred();
            console.log('Buying energy...');

            setTimeout(() => {
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
                        if (!$buyBtn.length) {
                            console.error('can\'t buy energy. Button does not react!');
                            deferred.resolve();
                            return;
                        }

                        permaLog('Energy purchased');
                        deferred.reject();

                    }, 200);

                }, 1000);
            }, 10);

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
        var lastPromise = $.when();
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
        const report = { permanents: [], days: {},
            summary: { netGained: 0, permanents: 0 }};

        db.permaLog.each(log => {
            //console.log(log.time, log.msg);
            const msg = log.msg;
            const day = log.time.toLocaleDateString("de-DE", { month: '2-digit', day: '2-digit'});

            if (msg.indexOf('Permanent') !== -1) {
                report.permanents.push({ day: day, reward: msg.substring(msg.indexOf('Reward') + 8) });
            }

            report.days[day] = report.days[day] || { won: 0, lost: 0, winRate: 0, netGained: 0 };
            const dayStats = report.days[day];
            if (msg.indexOf('Energy purchased') !== -1) {
                dayStats.netGained -= autobuyEnergy.price;
            } else if (msg.indexOf('SUCCESS') !== -1) {
                dayStats.won++;
                dayStats.netGained += autosendToMission.winMoneyReward;
                dayStatsUpdated(dayStats);
            } else if (msg.indexOf('FAILED') !== -1) {
                dayStats.lost++;
                dayStatsUpdated(dayStats);
            }

        }).then(() => {
            for (const day in report.days) {
                const dayStats = report.days[day];
                report.summary.netGained += dayStats.netGained;
            }
            report.summary.permanents = report.permanents.length;

        }).then(() => {
            console.log('Report:', report);
        });

        function dayStatsUpdated(dayStats) {
            const fraction = dayStats.won / (dayStats.won + dayStats.lost);
            dayStats.winRate = fraction.toLocaleString("de", {style: "percent"});
        }

        return "Report will be printed.";
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
