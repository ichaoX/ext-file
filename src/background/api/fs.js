const FSApi = {
    application: "webext.fsa.app",
    _port: null,
    _i: 0,
    get connected() {
        return !!this._port;
    },
    env: {
        version: browser.runtime.getManifest().version,
    },
    createId() {
        this._i = (this._i + 1) % (1000 - 100);
        return `${Date.now()}-${Math.round(100 + this._i)}`;
    },
    resolves: {},
    parts: {},
    data: {
        originPermission: {},
        originPrompt: {},
        settings: {},
        limitPrompt: new Map(),
        temp: new Map(),
        unloadListeners: new Map(),
    },
    _helperAppTipsExpire: 0,
    async port() {
        if (!this._port) {
            this._port = browser.runtime.connectNative(this.application);
            util.addListener(this._port.onDisconnect, (port) => {
                console.warn('disconnect', port);
                if (this.data.settings.app_tips && this._helperAppTipsExpire < Date.now()) {
                    this._helperAppTipsExpire = Date.now() + 60 * 1000;
                    setTimeout(async () => {
                        let url = browser.runtime.getURL('/view/doc.html');
                        let fullUrl = `${url}#requires-app`;
                        try {
                            let tabs = await browser.tabs.query({
                                url,
                            });
                            if (tabs.length > 0) {
                                if (!tabs.find(tab => tab.active)) {
                                    await browser.tabs.update(tabs[0].id, {
                                        active: true,
                                        url: fullUrl,
                                    });
                                }
                                return;
                            }
                        } catch (e) {
                            console.warn(e);
                        }
                        browser.tabs.create({
                            url: fullUrl,
                        });
                    }, 2000);
                }
                this.disconnect();
            });
            util.addListener(this._port.onMessage, (response) => {
                util.log('response', response);
                // this._helperAppTipsExpire = 0;
                let id = response.id;
                if (!this.resolves[id]) return;
                try {
                    if (this.parts[id]) {
                        response.data = this.parts[id].data + response.data;
                        delete this.parts[id];
                    }
                    if (response.code == 206 && response.next_id) {
                        this.parts[response.next_id] = response;
                        this.resolves[response.next_id] = this.resolves[id];
                    } else {
                        if (response.encode == 'json') {
                            response.data = JSON.parse(response.data);
                            delete response.encode;
                        }
                        this.resolves[id](response);
                    }
                } catch (e) {
                    console.warn(e);
                    let message = { code: 400, data: "" + e };
                    this.resolves[id](message);
                    if (this.parts[id]) delete this.parts[id];
                } finally {
                    delete this.resolves[id];
                }
            });
        }
        return this._port;
    },
    async init() {
        await this.crypto.loadKey();
        let contentScriptOptions = await util.getSetting("content_script_match");
        await this.contentScriptsRegister(contentScriptOptions);
        await Promise.all([
            'prompt_tab',
            'internal_file_picker',
            'app_tips',
        ].map(async (k) => {
            this.data.settings[k] = await util.getSetting(k);
        }));
    },
    action: {
        get t() {
            return FSApi;
        },
        async request(m) {
            if (m.data) {
                if ([
                    'exists',
                    'stat',
                    'read',
                    'write',
                    'touch',
                    'truncate',
                ].includes(m.action)) {
                    await this._tempInfo(m);
                }
                let data = m.data;
                for (let k of Object.keys(data)) {
                    if (data.hasOwnProperty(k) && k.startsWith('_')) {
                        let v = data[k];
                        if (v !== undefined && v !== null) {
                            return this._406;
                        } else {
                            delete data[k];
                        }
                    }
                }
            }
            let port = await this.t.port();
            let id = this.t.createId();
            m.id = id;
            if (m.origin) delete m.origin;
            if (m.hasOwnProperty('isTrusted')) delete m.isTrusted;
            util.log('request', m);
            return await new Promise((resolve, reject) => {
                this.t.resolves[id] = resolve;
                try {
                    port.postMessage(m);
                } catch (e) {
                    delete this.t.resolves[id];
                    reject(e);
                }
            });
        },
        _FEATURE_UNAVAILABLE: util.wrapResponse('Please update the helper app to use this feature.', 501),
        _406: util.wrapResponse('Not Acceptable', 406),
        async read(message) {
            let data = message.data;
            if (data.mode) {
                if (data.mode === 'chunk') {
                    if (!await this.t.isFeatureAvailable('read_chunk')) return this._FEATURE_UNAVAILABLE;
                    delete data.mode;
                } else {
                    return this._406;
                }
            }
            let encoded = !!data.encode;
            if (!encoded) {
                data.encode = 'base64';
                message.data = data;
            }
            let response = await this.request(message);
            if (response.code === 200 && !encoded) response.data = await util.base64Decode(response.data);
            return response;
        },
        async write(message) {
            let data = message.data;
            if (data.mode) {
                if (['new', 'chunk', 'append'].includes(data.mode)) {
                    if (!await this.t.isFeatureAvailable(`write_${data.mode}`)) return this._FEATURE_UNAVAILABLE;
                    data.mode = {
                        new: 'wb',
                        chunk: 'r+b',
                        append: 'ab',
                    }[data.mode];
                } else {
                    return this._406;
                }
            }
            if (!data.encode && data.data) {
                data.data = await util.base64Encode(data.data);
                data.encode = 'base64';
                message.data = data;
            }
            return await this.request(message);
        },
        async _tempInfo(message, pathKey = 'path', required = false) {
            let tid = message.data?._tid;
            if (!tid) {
                if (required) throw 'empty tid';
                return;
            }
            let info = this.t.data.temp.get(tid);
            if (!info || message.origin !== info.origin || (pathKey !== null && message.data[pathKey] !== info.path)) throw 'Invalid tid';
            if (pathKey !== null) {
                message.data[pathKey] = info.tempfile;
            }
            delete message.data._tid;
            return info;
        },
        async temp(message, sender) {
            let data = message.data;
            let map = this.t.data.temp;
            switch (message.subaction) {
                case 'copy':
                case 'new': {
                    let options = {};
                    if (message.subaction === 'copy') options.path = data.path;
                    let tempfile = util.unwrapResponse(await this.request({
                        action: 'mktemp',
                        data: options,
                    }));
                    if (!tempfile) throw 'Invalid tempfile';
                    let tid = this.t.createId();
                    let info = {
                        origin: message.origin,
                        path: data.path,
                        tempfile,
                        dispose: async (clear = true) => {
                            if (clear) {
                                util.unwrapResponse(await this.request({
                                    action: 'rm',
                                    data: {
                                        path: info.tempfile,
                                    },
                                }));
                            }
                            if (info.removeListener) info.removeListener();
                            map.delete(tid);
                        },
                    };
                    let tabId = sender?.tab?.id;
                    if (tabId > 0) {
                        let key = this.t.addUnloadListener(tabId, async () => {
                            await info.dispose();
                        });
                        info.removeListener = () => this.t.removeUnloadListener(tabId, key);
                    }
                    map.set(tid, info);
                    return util.wrapResponse(tid);
                }
                case 'move': {
                    let info = await this._tempInfo(message, null, true);
                    let path = data.path || info.path;
                    if (!path) throw 'Invalid path';
                    let response = await this.request({
                        action: 'mv',
                        data: {
                            src: info.tempfile,
                            dst: path,
                            overwrite: true,
                        },
                    });
                    if (response.code == 200) await info.dispose(false);
                    return response;
                }
                case 'drop': {
                    let info = await this._tempInfo(message, null, true);
                    await info.dispose();
                    return util.wrapResponse();
                }
                default: {
                    return this._406;
                }
            }
        },
        async scandir(message) {
            let data = message.data;
            if (data.path) {
                // FIX: dir C:*.*
                data.path = data.path.replace(/(\/)?$/, '/');
            }
            return await this.request(message);
        },
        async showDirectoryPicker(...args) {
            return await this.picker(...args);
        },
        async showOpenFilePicker(...args) {
            return await this.picker(...args);
        },
        async showSaveFilePicker(...args) {
            return await this.picker(...args);
        },
        async picker(message, sender) {
            let origin = message.origin;
            let originInfo;
            if (sender && sender.url && sender.tab) {
                originInfo = `<${origin}>[${sender.tab.id}:${sender.frameId}]`
            } else
                if (!originInfo) originInfo = origin || 'this site';

            let options = message.data || {};
            options = Object.assign({}, options);
            let titleTemplate = {
                'showDirectoryPicker': `Select where {origin} can {mode}`,
                'showOpenFilePicker': `Open ${options.multiple ? 'files' : 'file'} for {origin}`,
                'showSaveFilePicker': `Save as file from {origin}`,
            }[message.action];
            options.title = titleTemplate.replace(/\{(mode|origin)\}/g, (match, name) => {
                if (name == 'mode') return options.mode || 'read';
                if (name == 'origin') return originInfo;
                return name;
            });

            let id = options.id || '';
            let startIn = null;
            if (options.startIn && 'object' === typeof (options.startIn)) {
                let handle = options.startIn;
                if (handle.kind && handle._meta?.cpath) {
                    try {
                        let path = await this.t.parsePath(handle._meta.cpath);
                        if (handle.kind == FileSystemHandleKindEnum.FILE) {
                            startIn = await this.t.dirname(path);
                            options.initialfile = await this.t.basename(path);
                        } else {
                            startIn = path;
                        }
                    } catch (e) {
                        console.warn(e);
                    }
                } else {
                    // XXX
                }
            }
            if (!startIn) {
                let config = await util.getSiteConfig(origin, 'startIn', {});
                if (config[id]?.path) {
                    startIn = config[id].path;
                } else if (options.startIn && 'string' === typeof options.startIn) {
                    startIn = options.startIn;
                } else if (Object.keys(config).length > 0) {
                    startIn = Object.values(config).sort((a, b) => b.atime - a.atime)[0].path;
                }
            }
            if (startIn) {
                // XXX: C:
                startIn = startIn.replace(/^([a-z]:)$/i, '$1/');
            }
            options.startIn = startIn;
            message.data = options;
            let response = { code: 503, data: null };
            if (this.t.data.settings.internal_file_picker != 'always') {
                response = await this.request(message);
            }
            if (response.code >= 500) {
                let response1 = await this.request({
                    action: 'abspath',
                    data: {
                        path: options.startIn,
                        startIn: true,
                    },
                });
                if (response1.code == 200) {
                    message.data.startIn = response1.data;
                    message.data.titleTemplate = titleTemplate;
                    await this._makePrompt(message, sender, {
                        type: 'file-picker',
                        origin,
                        makeResolves(resolve) {
                            return {
                                select: (r) => {
                                    resolve(r);
                                    return true;
                                },
                            };
                        },
                        onResolve(r) {
                            response = {
                                code: 200,
                                data: r || '',
                            };
                        },
                        onReject(e) {
                            response = {
                                code: 400,
                                data: '' + e,
                            };
                        },
                    });
                } else if (!response.data) {
                    response = response1;
                }
            }
            if (response.code == 200 && response.data) {
                let path = await this.t.normalPath(Array.isArray(response.data) ? response.data[0] : response.data);
                if (['showOpenFilePicker', 'showSaveFilePicker'].includes(message.action)) path = await this.t.dirname(path);
                let config = await util.getSiteConfig(origin, 'startIn', {});
                config[id] = {
                    path,
                    atime: Date.now(),
                };
                let maxHistory = 32;
                if (Object.keys(config).length > maxHistory) {
                    config = Object.fromEntries(Object.entries(config).sort((a, b) => b[1].atime - a[1].atime).slice(0, maxHistory))
                }
                await util.setSiteConfig(origin, 'startIn', config);
            }
            return response;
        },
        async getEnv(message) {
            let data = message.data || {};
            let result = Object.assign({}, this.t.env);
            if (data.app) {
                if (this.t.connected) {
                    result.app = await this.t.constants();
                } else {
                    try {
                        result.app = await this.t.tryGetConstants();
                    } catch (e) {
                        console.warn(e);
                        result.error = "" + e;
                    }
                }
            }
            result.connected = this.t.connected;
            return util.wrapResponse(result);
        },
        async getState() {
            return util.wrapResponse({
                connected: this.t.connected,
            });
        },
        async disconnect() {
            if (this.t.connected) {
                let id = this.t.createId();
                let p = new Promise((resolve) => {
                    this.t.resolves[id] = resolve;
                });
                this.t.disconnect();
                await p;
            }
            return util.wrapResponse(true);
        },
        async separator() {
            return util.wrapResponse((await this.t.constants()).separator);
        },
        async queryPermission(message) {
            let options = Object.assign({ origin: message.origin }, message.data || {})
            return util.wrapResponse(await this.t.queryPermission(options));
        },
        async requestPermission(message, sender) {
            let promptType = this.t.data.settings.prompt_tab;
            if (promptType === 'never') return util.wrapResponse(null);
            let data = message.data || {};
            let origin = message.origin;
            let promptKey = JSON.stringify([origin, data.path, data.mode || FileSystemPermissionModeEnum.READ]);
            let limitPrompt = this.t.data.limitPrompt;
            let now = Date.now();
            let promptData = limitPrompt.get(promptKey) || { lastTime: 0, blockTime: 0 };
            let isLimit = promptData.lastTime > now - 60 * 1000;
            promptData.lastTime = now;
            limitPrompt.set(promptKey, promptData);
            if (!isLimit && promptType === 'auto' && sender.id === browser.runtime.id && message.isTrusted !== false) return util.wrapResponse(null);
            if (await this.t.queryPermission({
                path: data.path,
                mode: data.mode,
                origin,
            }) === PermissionStateEnum.GRANTED) return util.wrapResponse(PermissionStateEnum.GRANTED);
            if (promptData.blockTime > now - 60 * 1000) {
                console.info('blockPrompt', promptKey);
                return util.wrapResponse(PermissionStateEnum.PROMPT);
            }
            return util.wrapResponse(await this._makePrompt(message, sender, {
                type: 'request-permission',
                origin,
                getValue: async (end = false) => {
                    let state = await this.t.queryPermission({
                        path: data.path,
                        mode: data.mode,
                        origin,
                    });
                    if (end || state === PermissionStateEnum.GRANTED) return { done: true, data: PermissionStateEnum.GRANTED };
                    // TODO blockPrompt
                    return { done: false };
                },
                makeResolves: (resolve) => {
                    return {
                        authorize: async () => {
                            try {
                                await this.t.setPermission({
                                    origin,
                                    path: data.path,
                                    mode: data.mode,
                                    state: PermissionStateEnum.GRANTED,
                                });
                                return true;
                            } finally {
                                resolve();
                            }
                        },
                        [isLimit ? 'block' : '_block']: () => {
                            let promptData = limitPrompt.get(promptKey) || { lastTime: 0, blockTime: 0 };
                            try {
                                promptData.blockTime = Date.now();
                                limitPrompt.set(promptKey, promptData);
                                return true;
                            } finally {
                                resolve();
                            }
                        },
                    };
                },
            }));
        },
        async _makePrompt(message, sender, options = {}) {
            let origin = options.origin;
            let getValue = options.getValue || ((end, value) => ({ done: end, data: value }));
            let url = browser.runtime.getURL("/view/prompt.html") + `?origin=${encodeURIComponent(origin)}`;
            let originPrompt = this.t.data.originPrompt;
            if (originPrompt[origin]) {
                (async () => {
                    let tabs = await browser.tabs.query({ url, active: true });
                    if (tabs.length == 0) {
                        tabs = await browser.tabs.query({ url, active: false });
                        if (tabs.length > 0) {
                            await browser.tabs.update(tabs[0].id, { active: true });
                        }
                    }
                })();
            }
            while (originPrompt[origin]) {
                await originPrompt[origin].promise;
                let { done, data } = await getValue();
                if (done) return data;
            }
            let id = this.t.createId();
            let resolve;
            let viewTab = async () => {
                return await browser.tabs.update(sender.tab.id, { active: true });
            };
            let promise = new Promise(r => (resolve = (data) => {
                if (originPrompt?.[origin].id == id) {
                    delete originPrompt[origin];
                }
                r(data);
                setTimeout(viewTab, 100);
            }));
            originPrompt[origin] = {
                type: options.type,
                id,
                promise,
                resolve,
                message,
                sender,
                resolves: {
                    cancel: () => {
                        resolve();
                        return true;
                    },
                    viewTab: () => {
                        viewTab();
                        return false;
                    },
                    ...options.makeResolves(resolve),
                },
            };
            let openTab = true;
            // XXX: onRemoved
            if (sender.tab && sender.tab.id > 0) {
                let tabOrigin = Tab.getFrameOrigin(sender.tab.id);
                if (tabOrigin !== 'null' && tabOrigin !== origin) {
                    openTab = false;
                    resolve();
                    console.warn(`tab removed "${tabOrigin}"!="${origin}"`);
                }
            }
            let result;
            try {
                if (openTab) {
                    await new Promise((r) => setTimeout(r, 200));
                    await browser.tabs.create({ url, active: true });
                }
                result = await promise;
                if (options.onResolve) await options.onResolve(result);
            } catch (e) {
                console.warn(e);
                if (options.onReject) await options.onReject(e);
            } finally {
                let { data } = await getValue(true, result);
                return data;
            }
        },
        async setPermission(message) {
            let options = Object.assign({ origin: message.origin }, message.data || {})
            return util.wrapResponse(await this.t.setPermission(options));
        },
        async removePermission(message) {
            let options = Object.assign({ origin: message.origin }, message.data || {})
            return util.wrapResponse(await this.t.removePermission(options));
        },
        async getPrompt(message) {
            let data = message.data || {};
            let p = this.t.data.originPrompt[data.origin];
            let result = null;
            if (p) {
                result = {
                    id: p.id,
                    type: p.type,
                    message: p.message,
                    sender: p.sender,
                    resolveKeys: Object.keys(p.resolves),
                };
            }
            return util.wrapResponse(result);
        },
        async resolvePrompt(message, sender) {
            let data = message.data || {};
            let p = this.t.data.originPrompt[data.origin];
            if (!(p && data.id === p.id)) return util.wrapResponse('Expired', 410);
            let autoClose = await p.resolves[data.key](data.data);
            if (autoClose && sender && sender.frameId == 0 && sender.url.startsWith(browser.runtime.getURL('/')) && sender.tab) {
                setTimeout(async () => {
                    try {
                        await browser.tabs.remove([sender.tab.id]);
                    } catch (e) {
                        util.log(e);
                    }
                }, 50);
            }
            return util.wrapResponse(autoClose);
        },
        async updateOptions(message) {
            let settings = message.data;
            if (settings.content_script_match) await this.t.contentScriptsRegister(settings.content_script_match);
            for (let k in settings) {
                let v = settings[k];
                await util.setSetting(k, v);
                this.t.data.settings[k] = v;
            }
            return util.wrapResponse(null);
        },
        async encrypt(message) {
            return util.wrapResponse(await this.t.crypto.encrypt(message.data));
        },
        async decrypt(message) {
            return util.wrapResponse(await this.t.crypto.decrypt(message.data));
        },
    },
    externalAction: {
        get t() {
            return FSApi;
        },
        _PERM_MODE: {
            showDirectoryPicker: { returnPath: true },
            separator: {},
            getEnv: {},
            queryPermission: { args: { path: null } },
            requestPermission: { args: { path: null } },
            // XXX: path = dirname(readablePath)
            isdir: { args: { path: null } },

            getKind: { args: { path: FileSystemPermissionModeEnum.READ } },
            scandir: { args: { path: FileSystemPermissionModeEnum.READ } },
            exists: { args: { path: FileSystemPermissionModeEnum.READ } },
            stat: { args: { path: FileSystemPermissionModeEnum.READ } },
            read: { args: { path: FileSystemPermissionModeEnum.READ } },

            touch: { args: { path: FileSystemPermissionModeEnum.READWRITE } },
            write: { args: { path: FileSystemPermissionModeEnum.READWRITE } },
            truncate: { args: { path: FileSystemPermissionModeEnum.READWRITE } },
            temp: { args: { path: FileSystemPermissionModeEnum.READWRITE } },
            'temp.drop': {},
            mkdir: { args: { path: FileSystemPermissionModeEnum.READWRITE } },
            rm: { args: { path: FileSystemPermissionModeEnum.READWRITE } },
            mv: {
                args: {
                    src: FileSystemPermissionModeEnum.READWRITE,
                    dst: FileSystemPermissionModeEnum.READWRITE,
                },
            },
        },
        _403: util.wrapResponse('Forbidden', 403),
        async _action(message, sender) {
            let context = this.t.action;
            if ('function' === typeof context[message.action]) {
                return await context[message.action](message, sender);
            } else {
                return await context.request(message, sender);
            }
        },
        async _hasPermission(message, pathKey = 'path', mode = FileSystemPermissionModeEnum.READ) {
            let data = message.data || {};
            return data[pathKey] && (await this.t.queryPermission({
                path: data[pathKey],
                mode,
                origin: message.origin,
            }) === PermissionStateEnum.GRANTED);
        },
        async _decryptAndVerifyArgs(message, args = {}) {
            if (args) {
                let data = Object.assign({}, message.data || {});
                message.data = data;
                for (let key in args) {
                    if (data[key]) data[key] = await this.t.parsePath(data[key]);
                    let mode = args[key];
                    if (mode !== null) {
                        if (!await this._hasPermission(message, key, mode)) return false;
                    }
                }
            }
            return true;
        },
        async _encryptPath(path) {
            if (!path) return path;
            if (Array.isArray(path)) {
                return await Promise.all(path.map(e => this._encryptPath(e)));
            }
            path = await this.t.normalPath(path);
            return await this.t.crypto.encrypt(path);
        },
        async _encryptResponse(response, handler = null) {
            if (response.code === 200) {
                if (handler) response.data = await handler(response.data);
                response.data = await this._encryptPath(response.data);
            }
            return response;
        },
        async _verifyAndRequest(message, sender) {
            let action = message.action || '';
            let pattern = this._PERM_MODE[action];
            if (message.subaction) {
                let action0 = `${action}.${message.subaction}`;
                if (this._PERM_MODE.hasOwnProperty(action0)) {
                    pattern = this._PERM_MODE[action0];
                }
            }
            if (pattern) {
                message = Object.assign({}, message);
                if (!await this._decryptAndVerifyArgs(message, pattern.args)) return this._403;
            }
            let r = await this._action(message, sender);
            if (pattern && pattern.returnPath) r = await this._encryptResponse(r);
            return r;
        },
        async setPermission(message, sender) {
            let data = message.data || {};
            let mode = data.state === PermissionStateEnum.GRANTED ? data.mode : null;
            let promptType = this.t.data.settings.prompt_tab;
            if (promptType === 'never'
                || (promptType === 'auto'
                    && sender.id === browser.runtime.id
                    && message.isTrusted !== false
                )) mode = null;
            if (!await this._decryptAndVerifyArgs(message, { path: mode })) return this._403;
            return await this._action(message);
        },
        async showOpenFilePicker(message, sender) {
            let origin = message.origin;
            let result = await this._action(message, sender);
            return await this._encryptResponse(result, async (paths) => {
                if (Array.isArray(paths)) await Promise.all(paths.map(async (path) => {
                    if (!path) return;
                    await this.t.setPermission({
                        path,
                        state: PermissionStateEnum.GRANTED,
                        mode: FileSystemPermissionModeEnum.READ,
                        origin,
                    });
                }));
                return paths;
            });
        },
        async showSaveFilePicker(message, sender) {
            let origin = message.origin;
            let result = await this._action(message, sender);
            return await this._encryptResponse(result, async (path) => {
                if (path) {
                    await this.t.setPermission({
                        path,
                        state: PermissionStateEnum.GRANTED,
                        mode: FileSystemPermissionModeEnum.READWRITE,
                        origin,
                    });
                }
                return path;
            });
        },
        async resolvePath(message) {
            if (!await this._decryptAndVerifyArgs(message, { path: null, root: null })) return this._403;
            let data = message.data || {};
            let result;
            let isPath = false;
            switch (message.subaction) {
                case 'basename': {
                    result = await this.t.basename(data.path);
                    break;
                }
                case 'dirname': {
                    if (!await this._hasPermission(message, 'path')) return this._403;
                    result = await this.t.dirname(data.path);
                    isPath = true;
                    break;
                }
                case 'joinName': {
                    let { path, name } = data;
                    result = await this.t.joinName(path, name);
                    isPath = true;
                    break;
                }
                case 'diffPath': {
                    let { path, root } = data;
                    result = null;
                    let droot = root.replace(/\/?$/, '/');
                    if (root === path) {
                        result = '';
                        // XXX: empty root
                    } else if (root && path.startsWith(droot)) {
                        result = path.slice(droot.length);
                    }
                    break;
                }
                default: {
                    return util.wrapResponse(`[${data.method}] not implemented`, 501);
                }
            }
            if (isPath) result = await this._encryptPath(result);
            return util.wrapResponse(result);
        },
    },
    handleResponse(fn, detail = false) {
        return async function (...args) {
            let response;
            try {
                response = await fn.call(this, ...args);
            } catch (e) {
                response = { code: 500, data: e };
            }
            if (response?.code != 200) {
                let data = response.data;
                if (!util.debug && data && data.trace && 'string' === typeof data.message) {
                    data.message = `InternalError [${data.message.replace(/^([^:\s]+)[\s\S]*$/, '$1')}]`;
                    if (!detail) data.trace = `${data.message} …`;
                }
            }
            return response;
        }
    },
    async onMessage(message, sender, sendResponse) {
        let [action, ...subaction] = (message.action || '').split('.');
        let context = this.action;
        if (subaction.length > 0) {
            message = Object.assign({}, message || {});
            message.action = action;
            message.subaction = subaction.join('.');
        }
        return await this.handleResponse(async () => {
            if (!action.startsWith('_') && 'function' === typeof context[action]) {
                return await context[action](message, sender);
            } else {
                return await context.request(message, sender);
            }
        }, true)();
    },
    async onMessageExternal(message, sender, sendResponse) {
        message = Object.assign({}, message || {});
        let [action, ...subaction] = (message.action || '').split('.');
        let context = this.externalAction;
        // XXX
        let origin = (new URL(sender.url)).origin;
        if (!('origin' in message)) message.origin = origin;
        if (!origin || origin === "null" || origin !== message.origin) {
            console.warn(sender, message);
            return util.wrapResponse('Unauthorized', 401);
        }
        message.isTrusted = message.origin === (self.origin || location.origin);
        if (subaction.length > 0) {
            message.action = action;
            message.subaction = subaction.join('.');
        }
        return await this.handleResponse(async () => {
            if (!action.startsWith('_') && 'function' === typeof context[action]) {
                return await context[action](message, sender);
            } else if (context._PERM_MODE.hasOwnProperty(action)) {
                return await context._verifyAndRequest(message, sender);
            } else {
                return context._403;
            }
        })();
    },
    disconnect() {
        let error = 'Port disconnected';
        if (this._port) {
            let port = this._port;
            if (port.error) error = port.error;
            this._port = null;
            port.disconnect();
        }
        let response = { code: 503, data: error };
        for (let id in this.resolves) {
            this.resolves[id](response);
            delete this.resolves[id];
            if (this.parts[id]) delete this.parts[id];
        }
        this._constants = null;
    },
    _constants: null,
    async constants(reload = false) {
        if (reload || !this._constants) {
            try {
                this._constants = await this.tryGetConstants();
            } catch (e) {
                console.warn(e);
                this._constants = {
                    separator: '\\',
                };
            }
        }
        return this._constants;
    },
    async tryGetConstants() {
        return util.unwrapResponse(await this.action.request({ action: 'constants' }));
    },
    async separator(regexp = false) {
        let separator = (await this.constants()).separator;
        if (!regexp) return separator;
        return `/${separator === '\\' ? '\\\\' : ''}`;
    },
    async isFeatureAvailable(feature) {
        let v = (await this.constants()).version || '0.0.0';
        let pad = (v) => v.replace(/\d+/g, (d) => d.padStart(6, '0'));
        switch (feature) {
            case 'write_new':
            case 'write_chunk':
            case 'write_append':
            case 'read_chunk': {
                return pad(v) >= pad('0.9.4');
            }
        }
        return false;
    },
    async normalPath(path) {
        path = path || '';
        if ((await this.separator()) == '\\') path = path.replace(/\\/g, '/');
        let match = path.match(/^(\/\/[^\/]*|[a-z]:|\/)/i);
        let prefix = match && match[1] ? match[1] : '';
        path = path.slice(prefix.length);
        return prefix + path.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    },
    async basename(path) {
        let separators = await this.separator(true);
        return path.replace(new RegExp(`^.*[${separators}]`), '');
    },
    async dirname(path) {
        // XXX
        if (path === "/") return path;
        let separators = await this.separator(true);
        let result = path.replace(new RegExp(`[${separators}][^${separators}]*$`), '');
        if (result === "" && path.startsWith("/")) result = "/";
        return result;
    },
    async joinName(path, name) {
        await this.verifyName(name);
        return path.replace(/\/?$/, '/') + name;
    },
    async verifyName(name) {
        if (typeof name !== 'string' || ['', '.', '..'].includes(name) || (new RegExp(`[${await this.separator(true)}]`)).test(name)) throw new TypeError(`Name is not allowed.`);
        return true;
    },
    async parsePath(cpath) {
        let name = null;
        if (cpath && cpath.cdir) {
            name = cpath.name;
            cpath = cpath.cdir;
        }
        let path = await this.crypto.decrypt(cpath);
        if (name !== null) {
            path = await this.joinName(path, name);
        }
        return await this.normalPath(path);
    },
    getOriginPermission(origin, state = null) {
        if (!this.data.originPermission[origin]) {
            this.data.originPermission[origin] = {
                [FileSystemPermissionModeEnum.READ]: {},
                [FileSystemPermissionModeEnum.READWRITE]: {},
            };
        }
        if (state) {
            let permission = this.data.originPermission[origin];
            let result = {
                [FileSystemPermissionModeEnum.READ]: Object.entries(permission[FileSystemPermissionModeEnum.READ]).filter(([k, v]) => v == state).map(v => v[0]),
                [FileSystemPermissionModeEnum.READWRITE]: Object.entries(permission[FileSystemPermissionModeEnum.READWRITE]).filter(([k, v]) => v == state).map(v => v[0]),
            }
            return result;
        }
        return this.data.originPermission[origin];
    },
    hasPermission(origin) {
        if (!this.data.originPermission[origin]) return null;
        let pathPermission = this.data.originPermission[origin][FileSystemPermissionModeEnum.READWRITE];
        if (pathPermission && Object.values(pathPermission).find(v => v == PermissionStateEnum.GRANTED)) {
            return FileSystemPermissionModeEnum.READWRITE;
        }
        pathPermission = this.data.originPermission[origin][FileSystemPermissionModeEnum.READ];
        if (pathPermission && Object.values(pathPermission).find(v => v == PermissionStateEnum.GRANTED)) {
            return FileSystemPermissionModeEnum.READ;
        }
    },
    /**
     * C:,/ab,/cd,/ef
     * /,ab,/cd,/ef
     * //ab,/cd,/ef
     * @param {string} path
     * @returns string[]
     */
    splitPath(path) {
        let level = [];
        let match = path.match(/^(\/\/[^\/]*|[a-z]:|\/)/i);
        let prefix = match && match[1] ? match[1] : '';
        if (prefix !== "") level.push(prefix);
        path = path.slice(prefix.length);
        if (path !== "") level.push(...path.split(new RegExp(`(?=[/])`)));
        return level;
    },
    async queryPermission(options) {
        let { origin, path, mode, auto } = Object.assign({}, options);
        path = await this.normalPath(path);
        if (mode === undefined) mode = FileSystemPermissionModeEnum.READ;
        if (auto === undefined) auto = true;
        if (!Object.values(FileSystemPermissionModeEnum).includes(mode)) throw new TypeError(`Failed to read the 'mode' property`);
        if (auto && mode === FileSystemPermissionModeEnum.READ) {
            let state = await this.queryPermission(Object.assign(options, { mode: FileSystemPermissionModeEnum.READWRITE, auto: false }));
            if (state === PermissionStateEnum.GRANTED) return state;
        }
        let pathPermission = this.getOriginPermission(origin);
        let level = this.splitPath(path);
        let part = '';
        for (let dir of level) {
            part += dir;
            if (pathPermission[mode][part] && pathPermission[mode][part] !== PermissionStateEnum.PROMPT) return pathPermission[mode][part];
        }
        return PermissionStateEnum.PROMPT;
    },
    async setPermission(options) {
        let { origin, path, mode, state } = Object.assign({}, options);
        let currentState = await this.queryPermission(options);
        path = await this.normalPath(path);
        if (currentState !== state) {
            let pathPermission = this.getOriginPermission(origin);
            if (state === PermissionStateEnum.PROMPT) {
                delete pathPermission[mode][path];
            } else {
                pathPermission[mode][path] = state;
            }
            if ('undefined' !== typeof Tab && Tab.onOriginUpdated) Tab.onOriginUpdated(origin);
        }
    },
    async removePermission(options) {
        options = Object.assign({}, options);
        let { origin, path, mode, ancestor, descendant, auto } = options;
        if (!mode) {
            await this.removePermission(Object.assign(options, { mode: FileSystemPermissionModeEnum.READWRITE }));
            await this.removePermission(Object.assign(options, { mode: FileSystemPermissionModeEnum.READ }));
            return;
        }
        let pathPermission = this.getOriginPermission(origin);
        if (!path) {
            pathPermission[mode] = {};
        } else {
            path = await this.normalPath(path);
            if (auto === undefined) auto = true;
            let paths = this.splitPath(path).reduce((p, a, i) => (p.push((p[i - 1] || "") + a), p), []);
            for (let k in pathPermission[mode]) {
                if (k === path || (ancestor && paths.includes(k)) || (descendant && k.startsWith(path + '/'))) {
                    delete pathPermission[mode][k];
                }
            }
            if (auto) {
                if (ancestor && mode == FileSystemPermissionModeEnum.READ) {
                    await this.removePermission(Object.assign(options, { auto: false, mode: FileSystemPermissionModeEnum.READWRITE }));
                }
                if (descendant && mode == FileSystemPermissionModeEnum.READWRITE) {
                    await this.removePermission(Object.assign(options, { auto: false, mode: FileSystemPermissionModeEnum.READ }));
                }
            }
        }
        if ('undefined' !== typeof Tab && Tab.onOriginUpdated) Tab.onOriginUpdated(origin);
    },
    onUnload(tabId) {
        let data = this.data.unloadListeners
        let map = data.get(tabId);
        if (!map) return;
        data.delete(tabId);
        map.forEach(async (v, k) => {
            try {
                await v();
            } catch (e) {
                util.log(e);
            }
        });
    },
    addUnloadListener(tabId, f) {
        let data = this.data.unloadListeners
        let map = data.get(tabId);
        if (!map) {
            map = new Map();
            data.set(tabId, map);
        }
        let key = this.createId();
        map.set(key, f);
        return key;
    },
    removeUnloadListener(tabId, key) {
        let data = this.data.unloadListeners
        let map = data.get(tabId);
        if (!map) return;
        map.delete(key);
    },
    async contentScriptsRegister(options) {
        options = JSON.parse(JSON.stringify(options));
        let context = util.context('fs.contentScripts');
        try {
            let contentScriptOptions = Object.assign(options, {
                runAt: "document_start",
            });
            let js = [
                { file: "/lib/enum.js" },
                { file: "/lib/api/fs.js" },
                { file: "/content-script/main.js" },
            ];
            if (Array.isArray(options.js)) {
                let js0 = options.js.shift();
                if (js0 && js0.code) js.unshift(js0);
                js.push(...(options.js || []));
            }
            options.js = js;
            let registered = await browser.contentScripts.register(contentScriptOptions);
            util.destroy().destroy(registered.unregister);
        } catch (e) {
            throw e;
        } finally {
            util.context(context);
        }
    },
    crypto: {
        algorithm: 'AES-GCM',
        key: null,
        hashInitValue: 0,
        async loadKey() {
            let algorithm = { name: 'AES-GCM', length: 256 };
            let keyUsages = ['encrypt', 'decrypt'];
            let keyData = await util.getSetting("keyData", undefined, 'local');
            if (!keyData) {
                keyData = await crypto.subtle.exportKey('jwk', await crypto.subtle.generateKey(algorithm, true, keyUsages));
                await util.setSetting("keyData", keyData, 'local');
            }
            if (keyData.k) this.hashInitValue = parseInt(this.hash(keyData.k, false), 36);
            this.key = await crypto.subtle.importKey('jwk', keyData, algorithm, true, keyUsages);
        },
        async encrypt(data) {
            if (typeof data === 'string') data = this.encode(data);
            let iv = this.hash(data);
            let buffer = await crypto.subtle.encrypt({
                name: this.algorithm,
                iv: this.encode(iv),
            }, this.key, data);
            return btoa(String.fromCharCode(...new Uint8Array(buffer))) + ":" + iv;
        },
        async decrypt(data, text = true) {
            let [base64, iv] = Array.isArray(data) ? data : data.split(":");
            let result = await crypto.subtle.decrypt(
                {
                    name: this.algorithm,
                    iv: this.encode(iv),
                },
                this.key,
                Uint8Array.from(atob(base64), v => v.charCodeAt(0))
            );
            if (text) result = this.decode(result);
            return result;
        },
        encoder: new TextEncoder(),
        decoder: new TextDecoder(),
        encode(data) {
            return this.encoder.encode(data);
        },
        decode(data) {
            return this.decoder.decode(data);
        },
        hash(data, init = true) {
            if (typeof data === 'string') data = new TextEncoder().encode(data);
            return data.reduce((a, b) => (((a << 5) - a) + b) | 0, init ? this.hashInitValue : 0).toString(36);
        },
    },
};

FSApi.init();
