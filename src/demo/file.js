let $textarea = document.querySelector('textarea');
let $dir = document.querySelector('select.dir');
let $name = document.querySelector('input.name');
let $state = document.querySelector('output.state');
let $fileName = document.querySelector('output.file');
let $dirName = document.querySelector('output.dir');

let dirHandle, dirHandle0, fileHandle, file, writeable;

let refreshForm = () => {
    let scope = {
        dirHandle,
        fileHandle,
        writeable,
    };
    [...document.querySelectorAll('[data-var]')].map(e => {
        e.disabled = !scope[e.getAttribute('data-var')];
    });
};

let readFile = async (fileHandle) => {
    $fileName.value = fileHandle.name;
    console.time("readFile");
    try {
        file = await fileHandle.getFile();
        $textarea.value = await file.text();
        console.log(`size: ${file.size}`);
    } finally {
        console.timeEnd("readFile");
    }
};

let readDir = async (dirHandle) => {
    $dirName.value = dirHandle.name;
    $dir.textContent = "";
    {
        let option = document.createElement("option");
        option.value = '.';
        option.textContent = '.';
        option.selected = true;
        $dir.appendChild(option);
    }
    if (dirHandle0) {
        let level = (await dirHandle0.resolve(dirHandle));
        if (level && level.length > 0) {
            $dirName.value = dirHandle0.name + "/" + level.join('/');
            let option = document.createElement("option");
            option.value = '..';
            option.textContent = '..';
            $dir.appendChild(option);
        }
    }
    console.time("readDir");
    try {
        let i = 0;
        for await (let [key, handle] of dirHandle) {
            // console.debug(key, handle);
            let option = document.createElement("option");
            option.value = key;
            option.textContent = key + (handle.kind == 'directory' ? '/' : '');
            $dir.appendChild(option);
            i++;
        }
        console.log(`num: ${i}`);
    } finally {
        console.timeEnd("readDir");
    }
};

document.body.addEventListener('click', async (event) => {
    let target = event.target;
    if (target.nodeName !== 'BUTTON') return;
    let action = target.textContent.trim();
    try {
        switch (action) {
            case 'openFile': {
                [fileHandle] = await showOpenFilePicker({ id: "demo" });
                await readFile(fileHandle);
                return;
            }
            case 'openFiles': {
                const r = await showOpenFilePicker({
                    id: "demo",
                    multiple: true,
                    types: [
                        {
                            description: 'Text Files',
                            accept: {
                                'text/plain': ['.txt', '.text'],
                                'text/html': ['.html', '.htm'],
                            }
                        },
                        {
                            description: 'Images',
                            accept: {
                                'image/*': ['.png', '.gif', '.jpeg', '.jpg'],
                            }
                        },
                        {
                            accept: {
                                'image/svg+xml': '.svg',
                            }
                        },
                        {
                            accept: {
                                'image/svg+xml': [],
                            }
                        },
                        /*
                        {
                            accept: {
                                'image/svg+xml': 'bad,'
                            }
                        },
                        */
                    ],
                    excludeAcceptAllOption: true,
                });
                console.info(r);
                [fileHandle] = r;
                await readFile(fileHandle);
                return;
            }
            case 'saveAs': {
                fileHandle = await showSaveFilePicker({ id: "demo2", suggestedName: 'test.txt', });
                await readFile(fileHandle);
                return;
            }

            case 'moveFile': {
                let args = [];
                try {
                    args.push(await showDirectoryPicker({ id: "demo-move" }));
                } catch (e) {
                    console.log('skip dirHandle', e);
                }
                args.push(prompt('new name'));
                await fileHandle.move(...args);
                await readFile(fileHandle);
                return;
            }
            case 'moveDir': {
                let args = [];
                try {
                    args.push(await showDirectoryPicker({ id: "demo-move" }));
                } catch (e) {
                    console.log('skip dirHandle', e);
                }
                args.push(prompt('new name'));
                await dirHandle.move(...args);
                await readDir(dirHandle);
                return;
            }

            case 'removeFile': {
                await fileHandle.remove();
                fileHandle = null;
                return;
            }
            case 'removeDir': {
                await dirHandle.remove();
                dirHandle = null;
                return;
            }
            case 'removeDirRecursive': {
                await dirHandle.remove({ recursive: true });
                dirHandle = null;
                return;
            }

            case 'openDir': {
                dirHandle0 = dirHandle = await showDirectoryPicker({ id: "demo-dir1" });
                await readDir(dirHandle);
                return;
            }
            case 'newFile': {
                fileHandle = await dirHandle.getFileHandle($name.value, { create: true });
                await readDir(dirHandle);
                await readFile(fileHandle);
                return;
            }
            case 'newDir': {
                dirHandle = await dirHandle.getDirectoryHandle($name.value, { create: true });
                await readDir(dirHandle);
                return;
            }
            case 'removeEntry': {
                await dirHandle.removeEntry($name.value);
                await readDir(dirHandle);
                return;
            }
            case 'removeEntryRecursive': {
                await dirHandle.removeEntry($name.value, { recursive: true });
                await readDir(dirHandle);
                return;
            }

            case 'createWritable': {
                writeable = await fileHandle.createWritable();
                return;
            }
            case 'createWritableKeepExistingData': {
                writeable = await fileHandle.createWritable({ keepExistingData: true });
                return;
            }
            case 'seek': {
                let position = prompt("position");
                await writeable.seek(position);
                $state.value = `SEEK: ${parseInt(position)}`;
                return;
            }
            case 'truncate': {
                let size = prompt("size");
                await writeable.truncate(size);
                $state.value = "TRUNCATED";
                return;
            }
            case 'write': {
                await writeable.write($textarea.value);
                $state.value = "WRITED";
                return;
            }
            case 'close': {
                await writeable.close();
                writeable = null;
                $state.value = "CLOSED";
                if (fileHandle) await readFile(fileHandle);
                return;
            }
            case 'abort': {
                await writeable.abort('reason');
                writeable = null;
                $state.value = "ABORTED";
                if (fileHandle) await readFile(fileHandle);
                return;
            }

            case 'workerReadFile': {
                worker.postMessage({
                    action,
                    data: fileHandle,
                });
                return;
            }
            case 'workerReadDir': {
                worker.postMessage({
                    action,
                    data: dirHandle,
                });
                return;
            }
        }
    } catch (e) {
        console.warn(e);
        alert("" + e);
    } finally {
        refreshForm();
    }
});

$dir.addEventListener('change', async (event) => {
    try {
        let key = event.target.value;
        // console.log(key);
        let handle;
        switch (key) {
            case ".": {
                handle = dirHandle;
                break;
            }
            case "..": {
                if (!dirHandle0) return;
                let level = await dirHandle0.resolve(dirHandle);
                console.info(level);
                handle = dirHandle0;
                while (level.length > 1) {
                    handle = await handle.getDirectoryHandle(level.shift());
                }
                break;
            }
            default: {
                try {
                    handle = await dirHandle.getFileHandle(key);
                } catch (e) {
                    handle = await dirHandle.getDirectoryHandle(key);
                }
                break;
            }
        }
        if (handle.kind === "file") {
            fileHandle = handle;
            await readFile(fileHandle);
        } else {
            dirHandle = handle;
            await readDir(dirHandle);
        }
    } catch (e) {
        console.warn(e);
        alert("" + e);
    } finally {
        refreshForm();
    }
});

refreshForm();

let worker = new Worker('worker0.js');
worker.addEventListener("message", (message) => {
    console.debug(message, message.data);
});
