const FSApi = {
    application: "webext.fsa.app",
    _port: null,
    _i: 0,
    get connected() {
        return !!this._port;
    },
    createId() {
        this._i = (this._i + 1) % (1000 - 100);
        return `${Date.now()}-${Math.round(100 + this._i)}`;
    },
    resolves: {},
    parts: {},
    data: {
        originPermission: {},
    },
    async port() {
        if (!this._port) {
            this._port = browser.runtime.connectNative(this.application);
            util.addListener(this._port.onDisconnect, (port) => {
                util.log('disconnect', port);
                this.disconnect();
            });
            util.addListener(this._port.onMessage, (response) => {
                util.log('response', response);
                let id = response.id;
                if (!this.resolves[id]) return;
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
                delete this.resolves[id];
            });
        }
        return this._port;
    },
    async init() {
        await this.crypto.loadKey();
        let contentScriptOptions = await util.getSetting("content_script_match");
        await this.contentScriptsRegister(contentScriptOptions);
    },
    action: {
        get t() {
            return FSApi;
        },
        async request(m) {
            let port = await this.t.port();
            let id = this.t.createId();
            m.id = id;
            if (m.origin) delete m.origin;
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
        async read(message) {
            let data = message.data;
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
            if (!data.encode && data.data) {
                data.data = await util.base64Encode(data.data);
                data.encode = 'base64';
                message.data = data;
            }
            return await this.request(message);
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
            options.title = {
                'showDirectoryPicker': `Select where ${originInfo} can ${options.mode || 'read'}`,
                'showOpenFilePicker': `Open ${options.multiple ? 'files' : 'file'} for ${originInfo}`,
                'showSaveFilePicker': `Save as file from ${originInfo}`,
            }[message.action];

            let id = options.id || '';
            if (options.startIn && 'object' === typeof (options.startIn)) {
                let handle = options.startIn;
                if (handle.kind && handle._meta?.cpath) {
                    try {
                        let path = await this.t.normalPath(await this.t.crypto.decrypt(handle._meta.cpath));
                        if (handle.kind == FileSystemHandleKindEnum.FILE) {
                            options.startIn = await this.t.dirname(path);
                            options.initialfile = await this.t.basename(path);
                        } else {
                            options.startIn = path;
                        }
                    } catch (e) {
                        console.warn(e);
                    }
                } else {
                    // XXX
                }
            }
            if (!options.startIn) {
                let config = await util.getSiteConfig(origin, 'startIn', {});
                if (config[id]?.path) {
                    options.startIn = config[id].path;
                } else if (Object.keys(config).length > 0) {
                    options.startIn = Object.values(config).sort((a, b) => b.atime - a.atime)[0].path;
                }
            }
            message.data = options;
            let response = await this.request(message);
            if (response.code == 200 && response.data) {
                let path = await this.t.normalPath(Array.isArray(response.data) ? response.data[0] : response.data);
                if (['showOpenFilePicker', 'showSaveFilePicker'].includes(message.action)) path = await this.t.basename(path);
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
        async setPermission(message) {
            let options = Object.assign({ origin: message.origin }, message.data || {})
            return util.wrapResponse(await this.t.setPermission(options));
        },
        async removePermission(message) {
            let options = Object.assign({ origin: message.origin }, message.data || {})
            return util.wrapResponse(await this.t.removePermission(options));
        },
        async contentScriptsRegister(message) {
            return util.wrapResponse(await this.t.contentScriptsRegister(message.data));
        },
        async encrypt(message) {
            return util.wrapResponse(await this.t.crypto.encrypt(message.data));
        },
        async decrypt(message) {
            return util.wrapResponse(await this.t.crypto.decrypt(message.data));
        },
    },
    async onMessage(message, sender, sendResponse) {
        if ('function' === typeof this.action[message.action]) {
            return await this.action[message.action](message, sender);
        } else {
            switch (message.action) {
                case 'showDirectoryPicker':
                case 'showOpenFilePicker':
                case 'showSaveFilePicker':
                    return await this.action.picker(message, sender);
                default:
                    return await this.action.request(message);
            }
        }
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
        }
    },
    _constants: null,
    async constants(reload = false) {
        if (reload || !this._constants) {
            try {
                this._constants = this.tryGetConstants();
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
    async normalPath(path) {
        path = path || '';
        return ((await this.separator()) == '\\' ? path.replace(/\\/g, '/') : path).replace(/\/{2,}/, '/');
    },
    async basename(path) {
        let separators = await this.separator(true);
        return path.replace(new RegExp(`^.*[${separators}]`), '');
    },
    async dirname(path) {
        let separators = await this.separator(true);
        return path.replace(new RegExp(`[${separators}][^${separators}]*$`), '');
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
        let level = path.split(new RegExp(`(?<=^/)|(?=[/])`));
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
            let paths = path.split(new RegExp(`(?<=^/)|(?=[/])`)).reduce((p, a, i) => (p.push((p[i - 1] || "") + a), p), []);
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
    async contentScriptsRegister(options) {
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
            let [base64, iv] = data.split(":");
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
