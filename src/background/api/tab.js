const action = {
    update(options) {
        if (!options.tabId) return;
        let tabId = options.tabId;
        if (options.title !== undefined) {
            let details = { tabId, title: options.title };
            if (browser.pageAction) browser.pageAction.setTitle(details);
        }
        if (options.icon !== undefined) {
            let details = { tabId, path: options.icon };
            if (browser.pageAction) browser.pageAction.setIcon(details);
        }
        // XXX blank
        if (browser.pageAction) browser.pageAction.show(tabId);
    },
    disable(tabId) {
        if (browser.pageAction) browser.pageAction.hide(tabId);
    },
    onClicked(handler) {
        if (browser.pageAction) browser.pageAction.onClicked.addListener(handler);
    },
};

const Tab = {
    originMap: {},
    register(url, tabId, frameId = 0) {
        if (!url || tabId <= 0) return;
        let origin = (new URL(url)).origin;
        if (!this.originMap[tabId]) {
            this.originMap[tabId] = {};
            if (frameId > 0) {
                browser.webNavigation.getAllFrames({ tabId }).then(frameInfos => {
                    // XXX origin
                    frameInfos.forEach(frameInfo => Tab.register(frameInfo.url, tabId, frameInfo.frameId));
                });
            }
        }
        this.originMap[tabId][frameId] = origin;
    },
    onChange(tabId) {
        if (Array.isArray(tabId)) {
            tabId.forEach(id => this.onChange(id));
            return;
        }
        if (!this.originMap[tabId]) return;
        let origins = Object.values(this.originMap[tabId]);
        origins = Array.from(new Set(origins));
        let hasPermission = origins.find(origin => FSApi.hasPermission(origin));
        if (hasPermission) {
            action.update({ tabId });
        } else {
            action.disable(tabId);
        }
    },
    onRemoved(tabId) {
        delete this.originMap[tabId];
    },
    getFrameOrigin(tabId, frameId = 0) {
        if (!this.originMap[tabId]) return false;
        return this.originMap[tabId][frameId];
    },
    originThrotte: {},
    onOriginUpdated(origin, delay = 500) {
        if (delay && this.originThrotte[origin]) return;
        if (this.originThrotte[origin]) {
            clearTimeout(this.originThrotte[origin]);
            delete this.originThrotte[origin];
        }
        this.originThrotte[origin] = setTimeout(() => {
            delete this.originThrotte[origin];
            let tabIds = [];
            for (let tabId in this.originMap) {
                for (let frameId in this.originMap[tabId]) {
                    if (this.originMap[tabId][frameId] == origin) {
                        tabIds.push(parseInt(tabId));
                        break;
                    }
                }
            }
            this.onChange(tabIds);
        }, delay || 0);
    },
    async onMessage(message, sender, sendResponse) {
        if ('function' === typeof this.action[message.action]) {
            return await this.action[message.action](message, sender);
        }
        throw 'Not implemented';
    },
    action: {
        get t() {
            return Tab;
        },
        async queryPermissions(message) {
            let tabId = message.data.tabId;
            let result = {};
            let map = this.t.originMap[tabId];
            if (map) {
                for (let frameId in map) {
                    let origin = map[frameId];
                    if (!result[origin]) {
                        result[origin] = {
                            granted: FSApi.hasPermission(origin),
                            permission: FSApi.getOriginPermission(origin, PermissionStateEnum.GRANTED),
                            frameIds: [],
                        };
                    }
                    result[origin].frameIds.push(frameId);
                }
            }
            return util.wrapResponse(result);
        },
    },
};

try {
    util.addListener(browser.webNavigation.onCommitted, (details) => {
        // XXX origin
        Tab.register(details.url, details.tabId, details.frameId);
        Tab.onChange(details.tabId);
        if (details.frameId === 0) FSApi.onUnload(details.tabId);
    });
} catch (e) {
    console.warn(e);
}

util.addListener(browser.tabs.onRemoved, (tabId, removeInfo) => {
    Tab.onRemoved(tabId);
    FSApi.onUnload(tabId);
});

/*
(async () => {
    let tabInfos = await browser.tabs.query({});
    tabInfos.forEach(async tabInfo => {
        let frameInfos = await browser.webNavigation.getAllFrames({ tabId: tabInfo.id });
        // XXX origin
        if (!frameInfos.length) Tab.register(tabInfo.url, tabInfo.id);
        else frameInfos.forEach(frameInfo => Tab.register(frameInfo.url, tabInfo.id, frameInfo.frameId));
    });
})();
*/
