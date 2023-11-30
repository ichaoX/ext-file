if (self.__fs_init) {

    const scope = self;
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
    const debug = (...args) => {
        if (!getConfig('DEBUG_ENABLED')) return;
        let i = args.length;
        while (args[--i] === undefined && i >= 0) args.pop();
        console.debug(...args);
    };
    const AsyncFunction = (async () => { }).constructor;
    const AsyncGeneratorFunction = (async function* () { }).constructor;
    const getWrapped = o => o.wrappedJSObject;
    const cloneIntoScope = (o, deep = true) => {
        if (!deep) {
            return cloneInto(o, scope, { cloneFunctions: true });
        }
        switch (typeof o) {
            case 'function':
                if (o.wrappedJSObject) return o;
                if (o.constructor === AsyncFunction) return wrapAsyncFunction(o);
                if (o.constructor === AsyncGeneratorFunction) return wrapAsyncGeneratorFunction(o);
                return cloneIntoScope(o, false);
            case 'object':
                if (!o) return o;
                // XXX __proto__
                if (o.wrappedJSObject) return o;
                let result = cloneIntoScope(o, false);
                for (let k in o) {
                    if (typeof o[k] === 'function' && o[k].constructor !== Function) {
                        result.wrappedJSObject[k] = cloneIntoScope(o[k], true);
                    }
                }
                Object.getOwnPropertySymbols(o).forEach((k) => result.wrappedJSObject[k] = cloneIntoScope(o[k], true));
                /*
                if (o.__proto__ && o.__proto__.wrappedJSObject) result.wrappedJSObject.__proto__ = o.__proto__;
                */
                return result;
            default:
                return o;
        }
    };
    const exportIntoScope = (name, o) => {
        scope.wrappedJSObject[name] = cloneIntoScope(o);
        // exportFunction(f, scope, { defineAs: name })
    };
    const setProto = (o, proto, wrappedJSObjectOnly = false) => {
        if (proto) {
            if (!wrappedJSObjectOnly) o.__proto__ = proto;
            o.wrappedJSObject.__proto__ = proto;
        }
        return o;
    };
    const wrapPromise = (p, clone = true) => new scope.Promise(async (resolve, reject) => {
        try {
            let result = await p;
            if (clone) result = cloneIntoScope(result);
            resolve(result);
        } catch (e) {
            debug(e);
            reject(e);
        }
    });
    const wrapAsyncFunction = (f) => {
        return cloneIntoScope(function (...args) {
            return wrapPromise(f.bind(this)(...args));
        });
    };
    const wrapAsyncGeneratorFunction = (g) => {
        return cloneIntoScope(function (...args) {
            let generator = g.bind(this)(...args);
            let wrapProp = (prop) => {
                return async function (...args) {
                    let result = await generator[prop](...args);
                    let value = result.value;
                    delete result.value;
                    result = cloneIntoScope(result);
                    result.wrappedJSObject.value = cloneIntoScope(value);
                    return result;
                };
            };
            let generatorProp = cloneIntoScope({
                next: wrapProp('next'),
                return: wrapProp('return'),
                throw: wrapProp('throw'),
                [Symbol.asyncIterator]() {
                    return generatorProp;
                },
            });
            return setProto(cloneIntoScope({}), generatorProp);
        });
    };
    let sendMessage = async (action, data) => {
        try {
            let response = await browser.runtime.sendMessage({ action, data, origin: scope.origin || location.origin });
            if (response.code !== 200) {
                console.warn(response);
                throw response.data || response;
            }
            return response.data;
        } catch (e) {
            if (e && e.trace) {
                // XXX
                debug(e.trace);
                e = e.message;
            }
            throw e instanceof Error ? scope.Error(e.message) : cloneIntoScope(e);
        }
    }
    let workerScripts = [
        browser.runtime.getURL('/lib/enum.js'),
        browser.runtime.getURL('/lib/api/fs.js'),
        browser.runtime.getURL('/lib/worker.js'),
    ];

    let fs_options = {
        scope,
        getConfig,
        debug,
        getWrapped,
        cloneIntoScope,
        exportIntoScope,
        setProto,
        sendMessage,
        workerScripts,
    };

    self.__fs_init(fs_options);

}