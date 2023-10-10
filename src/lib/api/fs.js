self.__fs_init = function (config = {}) {

    delete self.__fs_init;

    if (!(typeof FS_API_ENABLED === "undefined" || FS_API_ENABLED)) return;

    const scope = config.scope || self;
    const isWorker = !!scope.importScripts

    const debug = config.debug || console.debug.bind(console);
    const warn = config.warn || console.warn.bind(console);
    let debugHandle = async (handle, ...args) => {
        if (typeof FS_DEBUG_ENABLED === "undefined" || !FS_DEBUG_ENABLED) return;
        let path;
        switch (typeof handle) {
            case 'function':
                path = await handle();
                break;
            case 'object':
                path = await tool.meta(handle).path();
                break;
            case 'string':
                path = handle;
                break;
        }
        debug(`%c${path.replace(/%/g, '%%')}`, 'text-decoration: underline;', ...args);
    }

    const getWrapped = config.getWrapped || (o => o);
    const cloneIntoScope = config.cloneIntoScope || (o => o);
    const exportIntoScope = config.exportIntoScope || ((name, o) => { scope[name] = o });
    const setProto = config.setProto || ((o, proto) => {
        if (proto) {
            o.__proto__ = proto;
        }
        return o;
    });
    const sendMessage = config.sendMessage || (async (action, data) => {
        throw 'Not implemented'
    });

    //error
    const TypeError = scope.TypeError;
    const DOMException = scope.DOMException;

    const NotAllowedError = new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NotAllowedError');
    const NotFoundError = new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
    const InvalidModificationError = new DOMException('The object can not be modified in this way.', 'InvalidModificationError');
    const TypeMismatchError = new DOMException('The path supplied exists, but was not an entry of requested type.', 'TypeMismatchError');
    const AbortError = new DOMException('The user aborted a request.', 'AbortError');

    // debug('fs start');

    // data
    let encryptCache = {};
    let decryptCache = {};

    let fileCache = {
        timeout: 'undefined' === typeof FS_FILE_CACHE_EXPIRE ? null : FS_FILE_CACHE_EXPIRE,
        data: {},
        get(path) {
            let item = this.data[path];
            if (!item) return null;
            item.atime = Date.now();
            return item.blob;
        },
        set(path, file) {
            if (this.timeout === 0) return;
            this.data[path] = {
                atime: Date.now(),
                blob: file,
            };
            this.autoClear();
        },
        delete(path) {
            delete this.data[path];
        },
        clear() {
            let minTime = Date.now() - 1000 * this.timeout;
            for (let path in this.data) {
                if (this.data[path].atime < minTime) {
                    delete this.data[path];
                    debug('fileCache.clear', path);
                }
            }
        },
        nextExpire() {
            if (this.timeout === 0 || this.timeout === null) return;
            // XXX
            return Math.min(...Object.values(this.data).map(item => item.atime));
        },
        timeoutID: null,
        nextTimeout: 0,
        autoClear() {
            if (this.timeoutID) clearTimeout(this.timeoutID);
            this.timeoutID = null;
            let expire = this.nextExpire();
            if (!expire) return;
            this.timeoutID = setTimeout(() => {
                this.clear();
                this.autoClear();
            }, Math.max(0, (expire - Date.now())) + 5000);
        },
    };

    let createFileSystemWritableFileStream = async (handle, options) => {
        options = options || {};
        // XXX tmp file
        let cache;
        let state = StreamStateEnum.WRITABLE;
        let seekOffset = 0;
        if (options.keepExistingData) {
            let file = await handle.getFile();
            cache = new Blob([await file.arrayBuffer()]);
        } else {
            cache = new Blob([]);
        }
        let stream = {
            async seek(position) {
                await debugHandle(handle, 'FileSystemWritableFileStream.seek', position);
                await stream.write({ type: WriteCommandTypeEnum.SEEK, position });
            },
            async truncate(size) {
                await debugHandle(handle, 'FileSystemWritableFileStream.truncate', size);
                await stream.write({ type: WriteCommandTypeEnum.TRUNCATE, size });
            },
            async write(data) {
                await debugHandle(handle, 'FileSystemWritableFileStream.write', data);
                if (state !== StreamStateEnum.WRITABLE) throw new TypeError(`Cannot write to a ${state.toUpperCase()} writable stream`);
                if (!data.type) data = { type: WriteCommandTypeEnum.WRITE, data };
                if (!Object.values(WriteCommandTypeEnum).includes(data.type)) throw new TypeError(`Failed to read the 'type' property from 'WriteParams'`);
                switch (data.type) {
                    case WriteCommandTypeEnum.WRITE:
                        if (data.data === undefined) throw new DOMException(`write requires a data argument`, 'SyntaxError')
                        let writePosition = data.position !== undefined ? Math.max(0, parseInt(data.position) || 0) : seekOffset;
                        let chunk = new Blob([data.data]);
                        if (writePosition > cache.size) cache = new Blob([cache, new Uint8Array(writePosition - cache.size)]);
                        cache = new Blob([cache.slice(0, writePosition), chunk, cache.slice(writePosition + chunk.size)]);
                        // seekOffset += chunk.size;
                        seekOffset = writePosition + chunk.size;
                        break;
                    case WriteCommandTypeEnum.SEEK:
                        if (data.position === undefined) throw new DOMException(`seek requires a position argument`, 'SyntaxError')
                        seekOffset = Math.max(0, parseInt(data.position) || 0);
                        break;
                    case WriteCommandTypeEnum.TRUNCATE:
                        if (data.size === undefined) throw new DOMException(`truncate requires a size argument`, 'SyntaxError')
                        let size = Math.max(0, parseInt(data.size) || 0);
                        if (size < cache.size) cache = cache.slice(0, size);
                        if (size > cache.size) cache = new Blob([cache, new Uint8Array(size - cache.size)]);
                        if (size < seekOffset) seekOffset = size;
                        break;
                    default:
                        throw 'Not implemented'
                }
            },
        };
        let close = async function () {
            await debugHandle(handle, 'FileSystemWritableFileStream.close');
            let path = await tool.meta(handle).path();
            if (await tool.queryPermission(path, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            if (![StreamStateEnum.WRITABLE, StreamStateEnum.ERRORING].includes(state)) throw new TypeError(`Cannot close a ${state.toUpperCase()} writable stream`);
            await sendMessage('fs.write', { path, data: cache });
            state = state === StreamStateEnum.ERRORING ? StreamStateEnum.ERRORED : StreamStateEnum.CLOSED;
            cache = null;
        };
        // XXX
        let abort = async function (reason) {
            await debugHandle(handle, 'FileSystemWritableFileStream.abort', reason);
            if (![StreamStateEnum.WRITABLE, StreamStateEnum.ERRORING].includes(state)) return;
            if (state === StreamStateEnum.WRITABLE) state = StreamStateEnum.ERRORING;
            state = StreamStateEnum.ERRORED;
            cache = null;
        };
        if (scope.WritableStream) {
            let fsWritableStream = new scope.WritableStream(cloneIntoScope({
                async write(chunk, controller) {
                    await debugHandle(handle, 'writableStream.write', chunk, controller);
                    return await stream.write(chunk);
                },
                async close(controller) {
                    await debugHandle(handle, 'writableStream.close', controller);
                    return await close();
                },
                async abort(reason) {
                    await debugHandle(handle, 'writableStream.abort', reason);
                    return await abort(reason);
                },
            }));
            Object.assign(getWrapped(fsWritableStream), getWrapped(cloneIntoScope(stream)));
            return fsWritableStream;
        }
        Object.assign(stream, {
            close,
            abort,
        });
        return setProto(cloneIntoScope(stream), scope.FileSystemWritableFileStream?.prototype, true);
    }

    let _FileSystemHandleProto = setProto(cloneIntoScope({
        async isSameEntry(fileSystemHandle) {
            await debugHandle(this, 'isSameEntry', fileSystemHandle);
            let path = await tool.meta(this).path();
            if (!fileSystemHandle || !fileSystemHandle.kind) throw new TypeError(`parameter 1 is not of type 'FileSystemHandle'.`);
            return !!(fileSystemHandle.kind === this.kind && fileSystemHandle._meta?.cpath && await tool.decrypt(fileSystemHandle._meta.cpath) === path);
        },
        async queryPermission(fileSystemHandlePermissionDescriptor) {
            await debugHandle(this, 'queryPermission', fileSystemHandlePermissionDescriptor);
            let path = await tool.meta(this).path();
            fileSystemHandlePermissionDescriptor = fileSystemHandlePermissionDescriptor || {};
            if (!fileSystemHandlePermissionDescriptor.mode) fileSystemHandlePermissionDescriptor.mode = FileSystemPermissionModeEnum.READ;
            let mode = fileSystemHandlePermissionDescriptor.mode;
            let state = tool.queryPermission(path, mode);
            return state;
        },
        async requestPermission(fileSystemHandlePermissionDescriptor) {
            await debugHandle(this, 'requestPermission', fileSystemHandlePermissionDescriptor);
            let path = await tool.meta(this).path();
            fileSystemHandlePermissionDescriptor = fileSystemHandlePermissionDescriptor || {};
            if (!fileSystemHandlePermissionDescriptor.mode) fileSystemHandlePermissionDescriptor.mode = FileSystemPermissionModeEnum.READ;
            let mode = fileSystemHandlePermissionDescriptor.mode;
            let state = await tool.requestPermission(path, mode);
            return state;
        },
        // TODO https://github.com/whatwg/fs/pull/10
        async move(destination, name) {
            await debugHandle(this, 'move', destination, name);
            let meta = tool.meta(this);
            let path = await meta.path();
            if (!destination || ('string' !== typeof destination && (destination.kind !== FileSystemHandleKindEnum.DIRECTORY))) throw TypeError(`parameter 1 is not of type 'FileSystemDirectoryHandle' or 'USVString'.`);
            let newDirectory, destinationMeta;
            if (destination.kind === FileSystemHandleKindEnum.DIRECTORY) {
                destinationMeta = tool.meta(destination);
                newDirectory = await destinationMeta.path();
                if (!name) name = this.name;
            } else {
                newDirectory = await tool.dirname(path);
                name = destination;
                destination = null;
            }
            await tool.verifyName(name);
            if (await tool.requestPermission(meta, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            if (newDirectory == await tool.dirname(path) && name === this.name) return;
            let newPath = newDirectory + "/" + name;
            if (await tool.requestPermission({ path: newPath, root: destinationMeta?.root }, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            if (!await sendMessage('fs.isdir', { path: newDirectory })) throw NotFoundError;
            // if (await sendMessage('fs.exists', { path: newPath })) throw InvalidModificationError;
            try {
                await sendMessage('fs.mv', { src: path, dst: newPath, overwrite: false });
            } catch (e) {
                throw InvalidModificationError;
            }
            this._meta.cpath = await tool.encrypt(newPath);
            this.name = name;
            fileCache.delete(path);
        },
        // TODO https://github.com/whatwg/fs/pull/9
        async remove(options) {
            await debugHandle(this, 'remove', options);
            let meta = tool.meta(this);
            await tool.remove(meta, options);
        },
    }), scope.FileSystemHandle?.prototype, true);

    let _FileSystemFileHandleProto = setProto(cloneIntoScope({
        async getFile() {
            await debugHandle(this, 'getFile');
            let path = await tool.meta(this).path();
            if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            let stat = await sendMessage('fs.stat', { path });
            if (typeof FS_FILE_SIZE_LIMIT === "number" && stat.size > FS_FILE_SIZE_LIMIT) throw new DOMException(`The requested file could not be read, the file size exceeded the allowed limit.`, 'NotReadableError');
            let cache = fileCache.get(path);
            // XXX
            if (!(cache && cache.lastModified == stat.mtime && cache.size == stat.size)) {
                let blob = await sendMessage('fs.read', { path });
                cache = new File([blob], this.name, { lastModified: stat.mtime });
                fileCache.set(path, cache);
            }
            return cache;
        },
        async createWritable(options) {
            await debugHandle(this, 'createWritable', options);
            let meta = tool.meta(this);
            if (await tool.requestPermission(meta, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            return await createFileSystemWritableFileStream(getWrapped(this), options);
        },
    }), _FileSystemHandleProto);

    let _FileSystemDirectoryHandleProto = setProto(cloneIntoScope({
        keys: async function* () {
            await debugHandle(this, 'keys');
            let path = await tool.meta(this).path();
            let list = await tool.scandir(path);
            for (let path of list) {
                yield path;
            }
        },
        values: async function* () {
            await debugHandle(this, 'values');
            let gen = getWrapped(this).entries();
            while (true) {
                let i = await gen.next();
                if (i.done) break;
                yield i.value[1];
            }
        },
        entries: async function* () {
            await debugHandle(this, 'entries');
            let meta = tool.meta(this);
            let path = await meta.path();
            let root = await meta.root();
            let dpath = path;
            // TODO
            let gen = getWrapped(this).keys();
            while (true) {
                let i = await gen.next();
                if (i.done) break;
                let name = i.value;
                let path = dpath + '/' + name;
                let handle = await createFileSystemHandle(path, await tool.getKind(path), root);
                let result = cloneIntoScope([handle.name]);
                result.push(handle);
                yield result;
            }
        },
        async getDirectoryHandle(name, options) {
            await debugHandle(this, 'getDirectoryHandle', name, options);
            let meta = tool.meta(this);
            let path = await meta.path();
            options = options || {};
            await tool.verifyName(name);
            path = path + '/' + name;
            let root = await meta.root();
            if ((options.create ? await tool.requestPermission({ path, root }, FileSystemPermissionModeEnum.READWRITE) : await tool.queryPermission(path)) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            let kind = await tool.getKind(path);
            let handle;
            if (kind !== FileSystemHandleKindEnum.DIRECTORY) {
                if (kind) {
                    throw TypeMismatchError;
                } else if (options.create) {
                    await sendMessage('fs.mkdir', { path });
                    handle = await createFileSystemDirectoryHandle(path, root);
                } else {
                    throw NotFoundError;
                }
            }
            if (!handle) handle = await createFileSystemDirectoryHandle(path, root);
            return handle;
        },
        async getFileHandle(name, options) {
            await debugHandle(this, 'getFileHandle', name, options);
            let meta = tool.meta(this);
            let path = await meta.path();
            options = options || {};
            await tool.verifyName(name);
            path = path + '/' + name;
            let root = await meta.root();
            if ((options.create ? await tool.requestPermission({ path, root }, FileSystemPermissionModeEnum.READWRITE) : await tool.queryPermission(path)) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            let kind = await tool.getKind(path);
            let handle;
            if (kind !== FileSystemHandleKindEnum.FILE) {
                if (kind) {
                    throw TypeMismatchError;
                } else if (options.create) {
                    await sendMessage('fs.touch', { path });
                    handle = await createFileSystemFileHandle(path, root);
                } else {
                    throw NotFoundError;
                }
            }
            if (!handle) handle = await createFileSystemFileHandle(path, root);
            return handle;
        },
        async removeEntry(name, options) {
            await debugHandle(this, 'removeEntry', name, options);
            let meta = tool.meta(this);
            let path = await meta.path();
            await tool.verifyName(name);
            path = path + '/' + name;
            await tool.remove({ path, root: meta.root }, options);
        },
        async resolve(possibleDescendant) {
            await debugHandle(this, 'resolve', possibleDescendant);
            let path = await tool.meta(this).path();
            if (!possibleDescendant?.kind) throw new TypeError(`parameter 1 is not of type 'FileSystemHandle'.`);
            let result = null;
            let possibleDescendantPath = await tool.meta(possibleDescendant).path();
            if (possibleDescendantPath === path) {
                result = [];
            } else if (possibleDescendantPath.startsWith(path + '/')) {
                result = possibleDescendantPath.slice(path.length + 1).split('/');
            }
            return result;
        },
        get [Symbol.asyncIterator]() {
            return this.entries;
        },
    }), _FileSystemHandleProto);

    let createFileSystemHandle = async (path, kind = FileSystemHandleKindEnum.FILE, root = null) => {
        path = await tool.normalPath(path);
        let cpath = await tool.encrypt(path);
        let croot = root ? await tool.encrypt(root) : cpath;
        let handle = {
            _meta: {
                cpath,
                croot,
            },
            kind,
            name: await tool.basename(path),
            // __proto__: _FileSystemHandlePrototype
        };
        let proto = _FileSystemHandleProto;
        if (kind === FileSystemHandleKindEnum.FILE) {
            proto = _FileSystemFileHandleProto;
        } else if (kind === FileSystemHandleKindEnum.DIRECTORY) {
            proto = _FileSystemDirectoryHandleProto;
        }
        return setProto(cloneIntoScope(handle), proto);
    };

    let createFileSystemFileHandle = (path, root) => createFileSystemHandle(path, FileSystemHandleKindEnum.FILE, root);
    let createFileSystemDirectoryHandle = (path, root) => createFileSystemHandle(path, FileSystemHandleKindEnum.DIRECTORY, root);

    if (!isWorker) {

        if (!scope.showOpenFilePicker) {
            exportIntoScope('showOpenFilePicker', async function (options) {
                debug('showOpenFilePicker', options);
                let paths = await sendMessage('fs.showOpenFilePicker', options);
                if (!paths) throw AbortError;
                let result = cloneIntoScope([]);
                for (let path of paths) {
                    let handle = await createFileSystemHandle(path);
                    await tool.setPermission(path, PermissionStateEnum.GRANTED, FileSystemPermissionModeEnum.READ);
                    result.push(handle);
                }
                return result;
            });
        }

        if (!scope.showDirectoryPicker) {
            exportIntoScope('showDirectoryPicker', async function (options) {
                debug('showDirectoryPicker', options);
                options = options || {};
                let path = await sendMessage('fs.showDirectoryPicker', options);
                if (!path) throw AbortError;
                if (await tool.requestPermission(path, options.mode) !== PermissionStateEnum.GRANTED) throw AbortError;
                let result = await createFileSystemDirectoryHandle(path);
                return result;
            });
        }

        if (!scope.showSaveFilePicker) {
            exportIntoScope('showSaveFilePicker', async function (options) {
                debug('showSaveFilePicker', options);
                options = options || {};
                let path = await sendMessage('fs.showSaveFilePicker', options);
                if (!path) throw AbortError;
                await tool.setPermission(path, PermissionStateEnum.GRANTED, FileSystemPermissionModeEnum.READWRITE);
                let kind = await tool.getKind(path);
                if (kind === FileSystemHandleKindEnum.FILE) {
                    await sendMessage('fs.write', { path, data: new Blob([]) });
                } else {
                    if (kind) {
                        throw TypeMismatchError;
                    } else {
                        await sendMessage('fs.touch', { path });
                    }
                }
                let result = await createFileSystemFileHandle(path);
                return result;
            });
        }

    }

    let tool = {
        _separator: null,
        async separator(regexp = false) {
            if (!this._separator) this._separator = await sendMessage('fs.separator');
            if (!regexp) return this._separator;
            return `/${this._separator === '\\' ? '\\\\' : ''}`;
        },
        async normalPath(path) {
            if ("function" === typeof path) path = await path();
            path = path || '';
            return ((await this.separator()) == '\\' ? path.replace(/\\/g, '/') : path).replace(/\/{2,}/, '/');
        },
        async basename(path) {
            let separators = await this.separator(true);
            return path.replace(new RegExp(`^.*[${separators}]`), '');
        },
        async dirname(path) {
            let separators = await this.separator(true);
            return path.replace(new RegExp(`[${separators}][^${separators}]*$`), '');
        },
        async verifyName(name) {
            if (typeof name !== 'string' || ['', '.', '..'].includes(name) || (new RegExp(`[${await this.separator(true)}]`)).test(name)) throw new TypeError(`Name is not allowed.`);
            return true;
        },
        async queryPermission(path, mode = FileSystemPermissionModeEnum.READ) {
            return await sendMessage('fs.queryPermission', {
                path,
                mode,
            });
        },
        async setPermission(path, state, mode = FileSystemPermissionModeEnum.READ) {
            return await sendMessage('fs.setPermission', {
                path,
                state,
                mode
            });
        },
        async requestPermission(meta, mode = FileSystemPermissionModeEnum.READ) {
            let path = meta;
            let root = null;
            if (typeof meta === 'object') {
                path = meta.path;
                root = meta.root;
            }
            if (root) root = await this.normalPath(root);
            if (path) path = await this.normalPath(path);
            if (root && !(path === root || path.startsWith(root + '/'))) root = null;
            if (!root) root = path;
            let state = await tool.queryPermission(path, mode);
            if (PermissionStateEnum.GRANTED !== state) {
                state = PermissionStateEnum.PROMPT;
                if (!isWorker) {
                    let r = await sendMessage('fs.requestPermission', { path: root, mode });
                    if (r === null) {
                        let message = `<${scope.origin}> will be able to ${mode === 'read' ? 'view' : 'edit'} (${mode}) files in '${root}' in this session`;
                        r = confirm(message);
                        // XXX deny
                        state = r ? PermissionStateEnum.GRANTED : PermissionStateEnum.PROMPT;
                        await tool.setPermission(root, state, mode);
                    } else {
                        state = r;
                    }
                }
            }
            debug('permission', path, mode, state);
            return state;
        },
        async scandir(path) {
            if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            let list = await sendMessage('fs.scandir', { path });
            return list;
        },
        async getKind(path) {
            if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            let kind = await sendMessage('fs.getKind', { path });
            return kind;
        },
        async remove(meta, options) {
            let path = meta;
            let root = null;
            if (typeof meta === 'object') {
                path = meta.path;
                root = meta.root;
            }
            if (path) path = await this.normalPath(path);
            options = options || {};
            if (await tool.requestPermission({ path, root }, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw NotAllowedError;
            if (!await sendMessage('fs.exists', { path })) throw NotFoundError;
            try {
                await sendMessage('fs.rm', Object.assign(Object.assign({}, options), { path }));
            } catch (e) {
                throw InvalidModificationError;
            }
            fileCache.delete(path);
        },
        async encrypt(text, cache = true) {
            if (!text) return text;
            if (text in encryptCache) return encryptCache[text];
            let base64 = await sendMessage('fs.encrypt', text);
            if (cache) {
                encryptCache[text] = base64;
                decryptCache[base64] = text;
            }
            return base64;
        },
        async decrypt(base64, cache = true) {
            if (!base64) return base64;
            if (base64 in decryptCache) return decryptCache[base64];
            let text = await sendMessage('fs.decrypt', base64);
            if (cache) {
                if (!(text in encryptCache)) encryptCache[text] = base64;
                decryptCache[base64] = text;
            }
            return text;
        },
        meta(handle) {
            let meta = handle?._meta || handle;
            let cpath = meta?.cpath;
            let croot = meta?.croot;
            return {
                cpath,
                croot,
                async path() {
                    return await tool.decrypt(cpath);
                },
                async root() {
                    return await tool.decrypt(croot);
                },
            };
        },
        createFileSystemHandle,
        originalApi: {}
    };
    // scope.wrappedJSObject[shareApiScope] = cloneIntoScope(tool);

    for (let o of ['FileSystemHandle', 'FileSystemFileHandle', 'FileSystemDirectoryHandle', 'FileSystemWritableFileStream']) {
        if (scope[o]) {
            tool.originalApi[o] = scope[o];
        }
        if (!scope[o] || typeof FS_OVERRIDE_ENABLED === "undefined" || FS_OVERRIDE_ENABLED) {
            exportIntoScope(o, scope.Object);
        }
    }


    if (typeof FS_CLONE_ENABLED !== "undefined" && FS_CLONE_ENABLED) {

        let defProp = (k, v, c = () => true) => {
            // debug(k, v);
            Object.defineProperty(getWrapped(scope.Object.prototype), k, getWrapped(cloneIntoScope({
                // XXX
                enumerable: false,
                configurable: true,
                get() {
                    // debug('get', k);
                    // console.trace();
                    if (c.bind(this)()) return (v);
                },
                set(value) {
                    // debug('set', k, value, this, this.wrappedJSObject);
                    Object.defineProperty(getWrapped(this), k, {
                        enumerable: true,
                        configurable: true,
                        writable: true,
                        value: value,
                    });
                },
            }, true)));
        };

        scope.Object.entries(getWrapped(_FileSystemHandleProto)).forEach(([k, v]) => defProp(k, v, function () { return this.kind && this._meta }));
        scope.Object.entries(getWrapped(_FileSystemFileHandleProto)).forEach(([k, v]) => defProp(k, v, function () { return this.kind === FileSystemHandleKindEnum.FILE && this._meta }));
        scope.Object.entries(getWrapped(_FileSystemDirectoryHandleProto)).forEach(([k, v]) => defProp(k, v, function () { return this.kind === FileSystemHandleKindEnum.DIRECTORY && this._meta }));
        scope.Object.getOwnPropertySymbols(getWrapped(_FileSystemDirectoryHandleProto)).forEach((k) => defProp(k, getWrapped(_FileSystemDirectoryHandleProto)[k], function () { return this.kind === FileSystemHandleKindEnum.DIRECTORY && this._meta }));

    }

    if (scope.Worker && (typeof FS_WORKER_ENABLED !== "undefined" && FS_WORKER_ENABLED)) {
        const Worker = scope.Worker;
        tool.originalApi['Worker'] = Worker;
        let actionName = '_fsAction';
        let workerURL = null;
        exportIntoScope('Worker', function (url, ...options) {
            let baseURI = (new scope.URL(url, config.baseURI || scope.document?.baseURI || scope.location?.href)).href;
            if (!workerURL) {
                if (isWorker) {
                    // XXX
                    workerURL = location.href;
                } else {
                    let text = `//# sourceURL=${browser.runtime.getURL('/.page-worker.js')}
let FS_DEBUG_ENABLED=${JSON.stringify(typeof FS_DEBUG_ENABLED === 'undefined' ? undefined : FS_DEBUG_ENABLED)};
let FS_FILE_CACHE_EXPIRE=${JSON.stringify(typeof FS_FILE_CACHE_EXPIRE === 'undefined' ? undefined : FS_FILE_CACHE_EXPIRE)};
let FS_FILE_SIZE_LIMIT=${JSON.stringify(typeof FS_FILE_SIZE_LIMIT === 'undefined' ? undefined : FS_FILE_SIZE_LIMIT)};
let FS_OVERRIDE_ENABLED=${JSON.stringify(typeof FS_OVERRIDE_ENABLED === 'undefined' ? undefined : FS_OVERRIDE_ENABLED)};
let FS_CLONE_ENABLED=${JSON.stringify(typeof FS_CLONE_ENABLED === 'undefined' ? undefined : FS_CLONE_ENABLED)};
let FS_WORKER_ENABLED=${JSON.stringify(typeof FS_WORKER_ENABLED === 'undefined' ? undefined : FS_WORKER_ENABLED)};
importScripts(${JSON.stringify(browser.runtime.getURL('/lib/enum.js'))});
importScripts(${JSON.stringify(browser.runtime.getURL('/lib/api/fs.js'))});
importScripts(${JSON.stringify(browser.runtime.getURL('/lib/worker.js'))});
`;
                    workerURL = scope.URL.createObjectURL(new scope.Blob([text], { type: 'text/javascript' }));
                }
            }
            let worker = new Worker(workerURL, ...options);
            let messageListeners = [];
            let onmessage = null;
            let __addEventListener = worker.addEventListener.bind(worker);
            let __removeEventListener = worker.removeEventListener.bind(worker);
            let __postMessage = worker.postMessage.bind(worker);
            __postMessage({
                [actionName]: 'script',
                data: {
                    url: baseURI,
                },
            });
            let onMessage = (data) => {
                if (!(data && data[actionName])) return;
                // debug('worker.message', data);
                (async () => {
                    let response = {
                        [actionName]: 'response',
                        id: data.id,
                        code: 200,
                        data: null,
                    };
                    try {
                        let options = data.data;
                        switch (data[actionName]) {
                            case 'sendMessage':
                                response.data = await sendMessage(options?.action, options?.data);
                                break;
                        }
                    } catch (e) {
                        response.code = 500;
                        response.data = e;
                    }
                    __postMessage(response);
                })();
                return true;
            };
            __addEventListener('message', async (event) => {
                if (onMessage(event.data)) return;
                // XXX
                if (onmessage) {
                    try {
                        onmessage.bind(worker)(event);
                    } catch (e) {
                        warn(e);
                    }
                }
                // FIXME
                for (let listener of messageListeners) {
                    try {
                        listener[0].bind(worker)(event);
                    } catch (e) {
                        warn(e);
                    }
                }
            });
            getWrapped(worker).addEventListener = cloneIntoScope(function (type, listener, ...args) {
                if (type === 'message') {
                    messageListeners.push([listener, ...args]);
                } else {
                    __addEventListener(type, listener, ...args);
                }
            });
            getWrapped(worker).removeEventListener = cloneIntoScope(function (type, listener, ...args) {
                if (type === 'message') {
                    for (let i in messageListeners) {
                        // FIXME
                        if (messageListeners[i][0] === listener) {
                            messageListeners.splice(i, 1);
                            break;
                        }
                    }
                    messageListeners.push([listener, ...args]);
                } else {
                    __removeEventListener(type, listener, ...args);
                }
            });
            Object.defineProperty(getWrapped(worker), 'onmessage', getWrapped(cloneIntoScope({
                enumerable: false,
                configurable: true,
                set(value) {
                    onmessage = value;
                },
                get() {
                    return onmessage;
                },
            })));
            return worker;
        });
        if (typeof FS_DEBUG_ENABLED !== "undefined" && FS_DEBUG_ENABLED) {
            scope.addEventListener('securitypolicyviolation', (event) => {
                warn(event);
            });
        }
    }

}
