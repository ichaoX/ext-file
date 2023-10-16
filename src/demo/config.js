/**
 * manifest.json:
 *     "content_security_policy": "script-src 'self' blob:; object-src 'self';",
 */
let FS_CONFIG = {
    WORKER_ENABLED: true,
    /*
    WORKER_SCRIPTS: [
        browser.runtime.getURL('/assets/file-system-access.js?'),
    ],
    */
    EXPORSE_NAMESPACE: '__FS',
};
