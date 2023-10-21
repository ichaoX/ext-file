# Firefox File System Access Extension

This extension brings the [File System Access API](https://wicg.github.io/file-system-access/) to Firefox that helps web apps such as [vscode.dev](https://vscode.dev) read and write local files and folders.

![Access Control](.github/images/access_control.png)

## Main features

* Implemented `showOpenFilePicker()`, `showDirectoryPicker()`, `showSaveFilePicker()` and related interfaces.

* Set to enable specific File System Access features on matching web pages.

* Provides File System Access API for other compatible WebExtensions.

## Notes

* The local file operations required by this extension cannot be performed in the browser, and a [helper app](app) needs to be installed to assist in the related work.

* The optional Code Editor feature is provided by the [Code Editor](https://addons.mozilla.org/firefox/addon/code-editor/) extension.
