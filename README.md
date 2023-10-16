# Firefox File System Access Extension

This extension brings the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) to Firefox that helps web apps such as [vscode.dev](https://vscode.dev) read and write local files and folders.

![Access Control](.github/images/access_control.png)

## Main features

* Implemented `showOpenFilePicker()`, `showDirectoryPicker()`, `showSaveFilePicker()` and related interfaces.

* On the options page you can customize the page matching and configure the API features.

## Notes

* The local file operations required by this extension cannot be performed in the browser, and a [helper app](app) needs to be installed to assist in the related work.
