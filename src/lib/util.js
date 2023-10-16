const util = {
    addListener(event, listener, ...extra) {
        if (!event) {
            console.trace('Event does not exist!');
            return;
        }
        event.addListener(listener, ...extra);
        let destroy = () => {
            if (event.hasListener(listener)) {
                event.removeListener(listener);
            }
        };
        this.destroy(destroy);
        return {
            destroy,
        };
    },
    _context: 'global',
    _contexts: {},
    context(context) {
        if (context !== undefined) {
            let _context = this._context;
            this._context = context;
            return _context;
        } else {
            if (!this._contexts[this._context]) this._contexts[this._context] = {};
            return this._contexts[this._context];
        }
    },
    destroy(callback = null) {
        let context = this.context();
        if (!context.destroyList) context.destroyList = [];
        if (callback) {
            context.destroyList.push(callback);
        } else {
            while (callback = context.destroyList.pop()) {
                try {
                    callback();
                } catch (e) {
                    console.warn(e);
                }
            }
        }
        return this;
    },
    async toDataURL(blob) {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(blob);
        });
    },
    async url2Blob(url, options = {}) {
        // XXX
        let response = await fetch(url, options);
        if (!options.ignoreFail && !response.ok) throw response;
        return await response.blob();
    },
    async base64Encode(data) {
        let url = await this.toDataURL(data);
        return url.slice(url.indexOf(',') + 1);
    },
    async base64Decode(base64, type = '') {
        return await this.url2Blob(`data:${type};base64,${base64}`);
    },
    _storageArea: browser.storage.sync ? 'sync' : 'local',
    _storagePrefix: '',
    _defaultConfig: {
        content_script_match: {
            matches: [
                "https://*/*",
                "*://*.localhost/*",
                "*://127.0.0.1/*"
            ],
            // excludeMatches: [],
            // includeGlobs: [],
            // excludeGlobs: [],
            allFrames: true,
            js: [{
                code: `/**
 * @type {FS_CONFIG}
 */
let FS_CONFIG = {
    API_ENABLED: !!self.isSecureContext,
    CLONE_ENABLED: ['vscode.dev'].includes(location.hostname),
    WORKER_ENABLED: ['vscode.dev'].includes(location.hostname),
    FILE_SIZE_LIMIT: 30 * 1024 ** 2,
    FILE_CACHE_EXPIRE: 5 * 60,
};
`,
            }],
        },
    },
    async getSetting(key, def = null, area = null) {
        if (!area) area = this._storageArea;
        let newkey = `${this._storagePrefix}${key}`;
        return (await browser.storage[area].get({ [newkey]: def || this._defaultConfig[key] || null }))[newkey];
    },
    async setSetting(key, data, area = null) {
        if (!area) area = this._storageArea;
        key = `${this._storagePrefix}${key}`;
        return await browser.storage[area].set({ [key]: data });
    },
    async getSiteConfig(origin, type, def = null) {
        return await this.getSetting(`${type}:${origin}`, def, 'local');
    },
    async setSiteConfig(origin, type, data) {
        return await this.setSetting(`${type}:${origin}`, data, 'local');
    },
    async sendMessage(action, data) {
        try {
            let response = await browser.runtime.sendMessage({ action, data });
            return this.unwrapResponse(response);
        } catch (e) {
            throw e;
        }
    },
    wrapResponse(data = null, code = 200) {
        return { data, code };
    },
    unwrapResponse(response) {
        if (response?.code !== 200) {
            console.warn(response);
            throw response?.data || response;
        }
        return response.data;
    },
    debug: false,
    get log() {
        return this.debug ? console.debug.bind(console) : () => null;
    },
};
