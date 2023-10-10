console.log('background start');

let asyncMessage = (handler) => {
    let result;
    try {
        result = handler();
    } catch (e) {
        result = { code: 500, data: e };
    }
    if (!result) return;
    return (async () => {
        try {
            result = await result;
        } catch (e) {
            console.warn(e);
            result = { code: 500, data: e };
        }
        if (typeof structuredClone === 'undefined' && result.code !== 200 && result.data instanceof Error) {
            result.data = "" + result.data;
        }
        return result;
    })();
};

util.addListener(browser.runtime.onMessage, (message, sender, sendResponse) => {
    return asyncMessage(() => {
        message.data = message.data || {};
        let action = message.action.split(".", 2);
        util.log('message', message);
        switch (action[0]) {
            case 'fs':
                message.action = action[1];
                return FSApi.onMessage(message, sender, sendResponse);
            case 'ext:fs':
                message.action = action[1];
                return FSApi.onMessageExternal(message, sender, sendResponse);
            case 'tab':
                message.action = action[1];
                return Tab.onMessage(message, sender, sendResponse);
        }
    });
});

util.addListener(browser.runtime.onMessageExternal, (message, sender, sendResponse) => {
    return asyncMessage(() => {
        message.data = message.data || {};
        let action = message.action.split(".", 2);
        util.log('message', message);
        switch (action[0]) {
            case 'ext:fs':
                message.action = action[1];
                return FSApi.onMessageExternal(message, sender, sendResponse);
        }
    });
});

util.addListener(browser.runtime.onInstalled, async (details) => {
    console.log(details);
    try {
        await FSApi.tryGetConstants();
        FSApi.disconnect();
    } catch (e) {
        console.warn(e);
        setTimeout(() => {
            browser.tabs.create({
                url: browser.runtime.getURL('/view/doc.html#app'),
            });
        }, 2000);
    }
});
