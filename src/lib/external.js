if (self.__fs_init && self.importScripts) {
    const __fs_init = self.__fs_init;
    self.__fs_init = (fs_options = {}, ...args) => {
        Object.assign(fs_options, { isExternal: true });
        return __fs_init(fs_options, ...args);
    };
} else if (self.__fs_init) {

    const extensionId = "file@example.com";

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

    let extMessage = getConfig('EXTENSION_TIP', 'Using the "File System Access API" requires the "File System Access" extension (https://addons.mozilla.org/en-US/firefox/addon/file-system-access/) and helper app to be installed.');

    let sendMessage = async (action, data) => {
        try {
            action = `ext:${action}`;
            // console.log('request', action, data);
            let response;
            try {
                response = await browser.runtime.sendMessage(extensionId, { action, data, origin: scope.origin || location.origin }, {});
            } catch (e) {
                if (typeof extMessage === "string" && extMessage
                    && /Receiving end does not exist/i.test((e && e.message) || "")
                ) {
                    let message = `${extMessage} \n\nError details: \n${e.message}`;
                    throw new Error(message);
                }
                throw e;
            }
            if (response.code !== 200) {
                console.warn(response);
                throw response.data || response;
            }
            extMessage = false;
            // console.log('response', response);
            return response.data;
        } catch (e) {
            if (e && e.trace) {
                // XXX
                debug(e.trace);
                e = e.message;
            }
            throw e instanceof Error ? scope.Error(e.message) : e;
        }
    }

    let fs_options = {
        scope,
        getConfig,
        debug,
        sendMessage,
        isExternal: true,
    };

    self.__fs_init(fs_options);

}
