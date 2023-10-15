/**
 * manifest.json:
 *     "content_security_policy": "script-src 'self' blob:; object-src 'self';",
 */
let FS_WORKER_ENABLED = true;
let FS_WORKER_SCRIPTS = [
    browser.runtime.getURL('/assets/file-system-access.js'),
];
// let FS_CLONE_ENABLED = true;

let FS_EXPORT_API_NAME = '__FS';
