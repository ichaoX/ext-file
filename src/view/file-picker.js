let initFilePicker = async (message) => {
    let action = message.action;
    let options = message.data || {};
    if (!options.mode) options.mode = action === 'showSaveFilePicker' ? FileSystemPermissionModeEnum.READWRITE : FileSystemPermissionModeEnum.READ;
    let modeText = options.mode === FileSystemPermissionModeEnum.READ ? 'view' : 'edit';
    renderText('perm-mode', modeText);
    renderText('perm-mode-detail', `${modeText} (${options.mode})`);
    renderText('perm-mode-detail', modeText, true);
    // XXX
    {
        let $title = $container.querySelector(`[data-text="title"]`);
        let $origin = $title.querySelector(`[data-text="origin"]`);
        let $mode = $title.querySelector(`[data-text="perm-mode-detail"]`);
        if (options.titleTemplate) {
            $title.textContent = "";
            for (let chunk of options.titleTemplate.split(/(\{[^}]+\})/)) {
                if (chunk === '{origin}' && !$origin.isConnected) {
                    $title.appendChild($origin);
                } else if (chunk === '{mode}' && !$mode.isConnected) {
                    $title.appendChild($mode);
                } else {
                    $title.insertAdjacentText('beforeend', chunk);
                }
            }
        }
    }

    if (self.__fs_init) {
        let fs_options = {
            scope: self,
            debug: util.log.bind(util),
            warn: console.warn,
            sendMessage: async (action, data) => {
                // XXX
                if (action == 'fs.queryPermission' && data?.mode === FileSystemPermissionModeEnum.READ) {
                    return PermissionStateEnum.GRANTED;
                }
                return await util.sendMessage(action, data);
            },
            exportInternalTools: true,
        };
        self.__fs_init(fs_options);
    }

    let $location = $container.querySelector(`.location input`);
    let $name = $container.querySelector(`.select-items input[name="name"]`);
    let $types = $container.querySelector(`.select-items select[name="types"]`);
    let $list = $container.querySelector(".file-list .list-data");
    let $select = $container.querySelector(`[data-action="select"]`);
    let verifyData = null;

    let renderFileList = async () => {
        $list.textContent = "";
        let allowTypes = $types.value ? JSON.parse($types.value) : true;
        let renderItem = (handle) => {
            let $item = document.createElement('div');
            $item.classList.add('list-item', handle.kind);
            let name = handle.name;
            if (handle.kind === FileSystemHandleKindEnum.FILE && (
                action === 'showDirectoryPicker' || !(
                    allowTypes === true ||
                    allowTypes.some(ext => name.toLowerCase().endsWith(ext))
                ))
            ) {
                $item.classList.add('disabled');
                return;
            }
            let $name = document.createElement('div');
            $name.classList.add('name');
            let $size = document.createElement('div');
            let $mtime = document.createElement('div');
            $name.textContent = name;
            $name.title = name;
            $item.appendChild($name);
            $item.appendChild($size);
            $item.appendChild($mtime);
            $list.appendChild($item);
            if (handle.kind === FileSystemHandleKindEnum.FILE) {
                setTimeout(async () => {
                    // XXX
                    if (!$item.isConnected) return;
                    let fileSize = (size) => {
                        let i = Math.floor(Math.log(size || 1) / Math.log(1024));
                        return (size / Math.pow(1024, i)).toFixed(2) * 1 + ['B', 'KB', 'MB', 'GB', 'TB'][i];
                    };
                    try {
                        let file = await handle.getFile({ _allowNonNative: true });
                        $size.title = `${file.size} bytes`;
                        $size.textContent = fileSize(file.size);
                        let mtime = (new Date(file.lastModified)).toLocaleString('en-GB');
                        $mtime.textContent = mtime;
                        $mtime.title = mtime;
                    } catch (e) {
                        console.warn(e);
                    }
                }, 100);
            }
        };
        let dir = $location.value;
        try {
            $list.classList.add('loading');
            let dirHandle = await __FILE_SYSTEM_TOOLS__.createFileSystemHandle(dir, FileSystemHandleKindEnum.DIRECTORY);
            dir = await __FILE_SYSTEM_TOOLS__.meta(dirHandle).path();
            $location.value = dir;
            renderSelectedItem();
            for await (let handle of dirHandle.values()) {
                if ($location.value != dir) break;
                util.log(handle);
                renderItem(handle)
            }
        } catch (e) {
            console.error(e);
            alert(e?.message || e);
        } finally {
            if ($location.value == dir) {
                $list.classList.remove('loading');
            }
        }
    };
    let renderSelectedItem = async () => {
        $select.disabled = true;
        let value = null;
        let name = "";
        const dir = $location.value;
        try {
            switch (action) {
                case 'showOpenFilePicker': {
                    let names = [...$list.querySelectorAll('.list-item.selected .name')].map($n => $n.title);
                    value = await Promise.all(names.map(name => {
                        return __FILE_SYSTEM_TOOLS__.joinName(dir, name);
                    }));
                    $list.classList[value.length > 0 ? 'add' : 'remove']('selected');
                    if (value.length == 0) {
                        value = null;
                    } else if (value.length == 1) {
                        name = names[0];
                    } else {
                        name = names.map(e => `"${e}"`).join(" ");
                    }
                    break;
                }
                case 'showDirectoryPicker': {
                    value = $location.value;
                    if (await util.sendMessage('fs.isdir', { path: value })) {
                        name = await __FILE_SYSTEM_TOOLS__.basename(value);
                        if (!name) name = value;
                    } else {
                        value = null;
                    }
                    break;
                }
                case 'showSaveFilePicker': {
                    if (!verifyData) {
                        verifyData = async (value) => {
                            if (await util.sendMessage('fs.exists', { path: value })) {
                                if (!confirm(`"${value}" already exists.\nDo you want to replace it?`)) {
                                    throw 'abort';
                                }
                            }
                        };
                    }
                    let names = [...$list.querySelectorAll('.list-item.selected .name')].map($n => $n.title);
                    if (names.length > 0) {
                        $name.value = names[0];
                    }
                    if (!!$name.value && !!$location.value) {
                        name = $name.value;
                        if (!names.length) name = name.trim();
                        value = await __FILE_SYSTEM_TOOLS__.joinName($location.value, name);
                    }
                    break;
                }
            }
        } catch (e) {
            console.warn(e);
            value = null;
        }
        if ($location.value != dir) return;
        _resolveData['select'] = async () => {
            if (verifyData) await verifyData(value);
            return value;
        };
        $select.disabled = !value;
        $name.value = value ? name : "";
    };

    if (options.multiple) $container.classList.add('multiple');
    if (Array.isArray(options.types)) {
        console.debug(options.types);
        $types.textContent = '';
        let excludeAcceptAllOption = !!options.excludeAcceptAllOption;
        try {
            for (let type of options.types) {
                if (!type.accept) {
                    excludeAcceptAllOption = false;
                    continue;
                }
                let types = [];
                for (let mime in type.accept) {
                    let ext = type.accept[mime];
                    if (!ext || !(ext = Array.isArray(ext) ? ext : [ext]) || ext.length == 0) {
                        excludeAcceptAllOption = false;
                        continue;
                    }
                    types.push(...ext.filter(e => e.startsWith('.')).map(e => e.toLowerCase()));
                }
                if (types.length === 0) continue;
                let description = `${type.description || ''} (${types.join(', ')})`;
                let $option = document.createElement('option');
                $option.textContent = description;
                $option.value = JSON.stringify(types);
                $types.appendChild($option);
            }
        } catch (e) {
            console.error(e);
            excludeAcceptAllOption = false;
        }
        if (!excludeAcceptAllOption) {
            let $option = document.createElement('option');
            $option.textContent = 'All Files';
            $option.value = '';
            $types.appendChild($option);
        }
        $types.addEventListener('change', renderFileList);
    }
    if (action === 'showSaveFilePicker') {
        $name.readOnly = false;
        if (options.suggestedName && typeof options.suggestedName === 'string') {
            $name.value = options.suggestedName;
        }
    }
    $location.value = options.startIn;
    renderFileList();
    $container.querySelector('.location .up').addEventListener('click', async () => {
        $location.value = await __FILE_SYSTEM_TOOLS__.dirname($location.value);
        renderFileList();
    });
    $name.addEventListener('input', () => {
        [...$list.querySelectorAll('.list-item.selected')].map($n => $n.classList.remove('selected'));
        if ($name.value.trim() != "") $select.disabled = false;
    });
    $name.addEventListener('change', () => {
        [...$list.querySelectorAll('.list-item.selected')].map($n => $n.classList.remove('selected'));
        renderSelectedItem();
    });
    $container.querySelector(`.select-items .clear`).addEventListener('click', () => {
        [...$list.querySelectorAll('.list-item.selected')].map($n => $n.classList.remove('selected'));
        $name.value = "";
        renderSelectedItem();
    });
    $list.addEventListener('click', async (event) => {
        let $n = event.target;
        if (!($n instanceof HTMLElement)) return;
        let $item = $n.closest('.list-item');
        if (!$item || $item.classList.contains('disabled')) return;
        let name = $item.querySelector('.name').title;
        if ($item.classList.contains('directory')) {
            if ($container.classList.contains('multiple') && $list.classList.contains('selected')) return;
            $location.value = await __FILE_SYSTEM_TOOLS__.joinName($location.value, name);
            renderFileList();
        } else if ($item.classList.contains('file')) {
            if ($item.classList.contains('selected')) {
                $item.classList.remove('selected');
            } else {
                if (!options.multiple) [...$list.querySelectorAll('.list-item.selected')].map($n => $n.classList.remove('selected'));
                $item.classList.add('selected');
            }
            renderSelectedItem();
        }
    });
    $location.addEventListener('change', renderFileList);
    $container.querySelector('.location .goto').addEventListener('click', renderFileList);
};
