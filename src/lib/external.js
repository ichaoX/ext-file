if (self.__fs_init) {

    const extensionId = "file@example.com";

    const scope = self;
    const debug = (...args) => {
        if (typeof FS_DEBUG_ENABLED === "undefined" || !FS_DEBUG_ENABLED) return;
        let i = args.length;
        while (args[--i] === undefined && i >= 0) args.pop();
        console.debug(...args);
    };

    let sendMessage = async (action, data) => {
        try {
            action = `ext:${action}`;
            console.log('request', action, data);
            let response = await browser.runtime.sendMessage(extensionId, { action, data, origin: scope.origin || location.origin }, {});
            if (response.code !== 200) {
                console.warn(response);
                throw response.data || response;
            }
            console.log('response', response);
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

    let config = {
        scope,
        debug,
        sendMessage,
    };

    self.__fs_init(config);

}