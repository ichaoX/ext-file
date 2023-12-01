if (self.importScripts) {
    let scope = self;

    let __baseURI = undefined;
    let __fetch = scope.fetch;
    let __importScripts = scope.importScripts;
    let __postMessage = scope.postMessage;
    let __addEventListener = scope.addEventListener;
    let __removeEventListener = scope.removeEventListener;
    let __debug = scope.console?.debug?.bind(scope.console);
    let __warn = scope.console?.warn?.bind(scope.console);

    const getConfig = (name = null, def = undefined, type = null) => {
        if ('undefined' !== typeof FS_CONFIG && FS_CONFIG) {
            if (name === null) {
                return FS_CONFIG;
            } else if (FS_CONFIG.hasOwnProperty(name) && (!type || type === typeof FS_CONFIG[name])) {
                return FS_CONFIG[name];
            }
        }
        return def;
    };
    let debug = (...args) => {
        if (!getConfig('DEBUG_ENABLED')) return;
        let i = args.length;
        while (args[--i] === undefined && i >= 0) args.pop();
        if (__debug) __debug(...args);
    };
    let warn = __warn;

    debug('worker start');

    scope.fetch = (resource, ...options) => {
        debug('fetch', resource, ...options);
        if (typeof resource === 'string') {
            resource = (new URL(resource, __baseURI)).href;
        }
        return __fetch(resource, ...options);
    };
    scope.importScripts = (...urls) => {
        debug('importScripts', ...urls);
        urls = urls.map(url => (new URL(url, __baseURI)).href);
        return __importScripts(...urls);
    };

    let actionName = '_fsAction';

    let port = {
        resolves: {},
        _i: 0,
        _w: Math.round(Math.random() * 1000),
        createId() {
            this._i = (this._i + 1) % (1000 - 100);
            return `worker_${this._w}-${Date.now()}-${Math.round(100 + this._i)}`;
        },
        async request(m) {
            let id = this.createId();
            let message = {
                id,
                [actionName]: 'sendMessage',
                data: m,
            };
            return await new Promise((resolve, reject) => {
                this.resolves[id] = resolve;
                try {
                    __postMessage(message);
                } catch (e) {
                    delete this.resolves[id];
                    reject(e);
                }
            });
        },
        onMessage(response) {
            if (response && response[actionName]) {
                let options = response.data;
                switch (response[actionName]) {
                    case 'script':
                        let url = options?.url;
                        if (!url) break;
                        try {
                            if (!__baseURI) __baseURI = url;
                            importScripts(url);
                            dispatchMessageEvent(true);
                        } catch (e) {
                            warn(e);
                            // XXX
                            (async () => {
                                try {
                                    debug('eval', url);
                                    let code = await (await sendMessage('page.fetch', { url })).text();
                                    if (code) code = `//# sourceURL=${url}\n${code}`;
                                    (new scope.Function(code))();
                                } catch (e) {
                                    warn(e);
                                } finally {
                                    dispatchMessageEvent(true);
                                }
                            })();
                        }
                        break;
                    case 'response':
                        let id = response.id;
                        if (!this.resolves[id]) return;
                        this.resolves[id](response);
                        delete this.resolves[id];
                }
                return true;
            }
        },
    };

    let messageData = {
        loaded: false,
        context: scope,
        events: [],
        onmessage: null,
        listeners: [],
    };
    let dispatchMessageEvent = function (event) {
        if (event === true) {
            messageData.loaded = true;
            for (let event of messageData.events) {
                try {
                    dispatchMessageEvent.bind(messageData.context)(event);
                } catch (e) {
                    warn(e);
                }
            }
            messageData.events = [];
            return;
        }
        if (!messageData.loaded) {
            messageData.context = this;
            messageData.events.push(event);
            return;
        }
        // XXX
        if (messageData.onmessage) {
            try {
                messageData.onmessage.bind(this)(event);
            } catch (e) {
                warn(e);
            }
        }
        // FIXME
        for (let listener of messageData.listeners) {
            try {
                listener[0].bind(this)(event);
            } catch (e) {
                warn(e);
            }
        }
    };

    scope.postMessage = function (data, ...args) {
        // XXX
        if (data && data[actionName]) {
            warn('block self.postMessage', [data, ...args]);
            return;
        }
        return __postMessage(data, ...args);
    };
    __addEventListener.bind(scope)('message', function (event) {
        if (port.onMessage(event.data)) return;
        dispatchMessageEvent.bind(true)(event);
    });
    scope.addEventListener = function (type, listener, ...args) {
        if (type === 'message') {
            messageData.listeners.push([listener, ...args]);
        } else {
            __addEventListener.bind(this)(type, listener, ...args);
        }
    };
    scope.removeEventListener = function (type, listener, ...args) {
        if (type === 'message') {
            for (let i in messageData.listeners) {
                // FIXME
                if (messageData.listeners[i][0] === listener) {
                    messageData.listeners.splice(i, 1);
                    break;
                }
            }
            messageData.listeners.push([listener, ...args]);
        } else {
            __removeEventListener.bind(this)(type, listener, ...args);
        }
    };
    Object.defineProperty(scope, 'onmessage', {
        enumerable: false,
        configurable: true,
        set(value) {
            messageData.onmessage = value;
        },
        get() {
            return messageData.onmessage;
        },
    });

    let sendMessage = async (action, data) => {
        try {
            let response = await port.request({ action, data });
            if (response.code !== 200) {
                warn(response);
                throw response.data || response;
            }
            return response.data;
        } catch (e) {
            if (e && e.trace) {
                debug(e.trace);
                e = e.message;
            }
            throw e instanceof Error ? scope.Error(e.message) : e;
        }
    }

    if (self.__fs_init) {
        let fs_options = {
            scope,
            debug,
            warn,
            sendMessage,
            get baseURI() {
                return __baseURI;
            },
        };
        self.__fs_init(fs_options);
    }

}
