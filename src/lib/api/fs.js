self.__fs_init = function (fs_options = {}) {

    delete self.__fs_init;

    const getConfig = (name = null, def = undefined, type = null) => {
        if ('undefined' !== typeof FS_CONFIG && FS_CONFIG) {
            if (name === null) {
                return FS_CONFIG;
            } else if (FS_CONFIG.hasOwnProperty(name) && (
                Array.isArray(type)
                    ? type.includes(FS_CONFIG[name])
                    : (!type || type === typeof FS_CONFIG[name])
            )) {
                return FS_CONFIG[name];
            }
        }
        return def;
    };
    if (!getConfig('API_ENABLED', true)) return;

    const scope = fs_options.scope || self;
    const isWorker = !!scope.importScripts
    // XXX
    const isNativeSupported = !isWorker && !!scope.showOpenFilePicker;

    const debug = fs_options.debug || console.debug.bind(console);
    const warn = fs_options.warn || console.warn.bind(console);
    let debugHandle = async (handle, ...args) => {
        if (!getConfig('DEBUG_ENABLED')) return;
        let path, meta;
        switch (typeof handle) {
            case 'function':
                path = await handle();
                break;
            case 'object': {
                meta = tool.meta(handle);
                path = await meta.path();
                break;
            }
            case 'string':
                path = handle;
                break;
        }
        if (fs_options.isExternal && path) {
            try {
                path = '…/' + await tool.basename(path);
            } catch (e) {
            }
        }
        if ('string' === typeof path && meta && meta.offset !== undefined) {
            path = `${path}:${meta.offset}+${meta.size}`;
        }
        debug(`%c${path.replace(/%/g, '%%')}`, 'text-decoration: underline;', ...args);
    }

    const getWrapped = fs_options.getWrapped || (o => o);
    const cloneIntoScope = fs_options.cloneIntoScope || (o => o);
    const exportIntoScope = fs_options.exportIntoScope || ((name, o) => { scope[name] = o });
    const setProto = fs_options.setProto || ((o, proto) => {
        if (proto) {
            o.__proto__ = proto;
        }
        return o;
    });
    const sendMessage = fs_options.sendMessage || (async (action, data) => {
        throw 'Not implemented'
    });

    //error
    const TypeError = scope.TypeError;
    const DOMException = scope.DOMException;
    const createError = (name, message = null, vars = null) => {
        if (message && 'object' === typeof message) {
            vars = message;
            message = null;
        }
        if (!message) {
            message = {
                NotAllowedError: 'The request is not allowed by the user agent or the platform in the current context.',
                NotFoundError: 'A requested file or directory could not be found at the time an operation was processed.',
                InvalidModificationError: 'The object can not be modified in this way.',
                TypeMismatchError: 'The path supplied exists, but was not an entry of requested type.',
                AbortError: 'The user aborted a request.',
                SecurityError: 'Must be handling a user gesture to show a file picker.',
                NotReadableError: 'The requested file could not be read{reason?=, $1}.',
            }[name];
        }
        message = message.replace(/\{([^\?]+)\?=([^}]+)\}/g, (match, group, pattern) => {
            let value = vars && vars[group];
            if (!value) return '';
            return pattern.replace(/\$1/g, value);
        });
        return new DOMException(message, name);
    };

    // debug('fs start');

    // data
    let cacheData = {
        encrypt: new Map(),
        decrypt: new Map(),
        file: new Map(),
        cpath: new Map(),
    };

    let fileCache = {
        timeout: getConfig('FILE_CACHE_EXPIRE', null),
        get(path) {
            path = tool.stringifyPath(path);
            let item = cacheData.file.get(path);
            if (!item) return null;
            item.atime = Date.now();
            return item.blob;
        },
        set(path, file) {
            if (this.timeout === 0) return;
            path = tool.stringifyPath(path);
            cacheData.file.set(path, {
                atime: Date.now(),
                blob: file,
            });
            this.autoClear();
        },
        delete(path) {
            path = tool.stringifyPath(path);
            cacheData.file.delete(path);
        },
        clear() {
            let minTime = Date.now() - 1000 * this.timeout;
            for (let [path, file] of cacheData.file) {
                if (file.atime < minTime) {
                    cacheData.file.delete(path);
                    debug('fileCache.clear', path);
                }
            }
        },
        nextExpire() {
            if (this.timeout === 0 || this.timeout === null) return;
            // XXX
            return Math.min(...[...cacheData.file.values()].map(item => item.atime));
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
        let meta = tool.meta(handle);
        let path = await meta.path();
        let state = StreamStateEnum.WRITABLE;
        let seekOffset = 0;
        let writeBufferType = !!options._inPlace ? 'inplace' : 'memory';
        let writer = {
            memory: {
                cache: null,
                async start() {
                    if (options.keepExistingData) {
                        let file = await handle.getFile();
                        this.cache = new Blob([await file.arrayBuffer()]);
                    } else {
                        this.cache = new Blob([]);
                    }
                },
                async write(position, data) {
                    let size = this.cache.size;
                    if (position > size) this.cache = new Blob([this.cache, new Uint8Array(position - size)]);
                    this.cache = new Blob([this.cache.slice(0, position), data, this.cache.slice(position + data.size)]);
                },
                async truncate(size) {
                    let size0 = this.cache.size;
                    if (size < size0) {
                        this.cache = this.cache.slice(0, size);
                    } else if (size > size0) {
                        this.cache = new Blob([this.cache, new Uint8Array(size - size0)]);
                    }
                },
                async close() {
                    const data = this.cache;
                    if (await tool.queryPermission(path, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
                    await tool._write(path, data);
                    this.cache = null;
                },
                async abort() {
                    this.cache = null;
                },
            },
            inplace: {
                async start() {
                    if (!options.keepExistingData) {
                        await sendMessage('fs.truncate', {
                            path,
                            size: 0,
                        });
                    }
                },
                async write(position, data) {
                    if (await tool.queryPermission(path, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
                    await tool._write(path, data, {
                        mode: 'chunk',
                        offset: position,
                    });
                },
                async truncate(size) {
                    if (await tool.queryPermission(path, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
                    await sendMessage('fs.truncate', {
                        path,
                        size,
                    });
                },
                async close() {
                },
                async abort() {
                    // XXX
                },
            },
        }[writeBufferType];

        if (await tool.requestPermission(meta, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
        await writer.start();
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
                // XXX
                if (!data.type || (!Object.values(WriteCommandTypeEnum).includes(data.type) && '[object Object]' !== Object.prototype.toString.call(data))) data = { type: WriteCommandTypeEnum.WRITE, data };
                if (!Object.values(WriteCommandTypeEnum).includes(data.type)) throw new TypeError(`Failed to read the 'type' property from 'WriteParams'`);
                switch (data.type) {
                    case WriteCommandTypeEnum.WRITE:
                        if (data.data === undefined) throw new DOMException(`write requires a data argument`, 'SyntaxError')
                        let writePosition = data.position !== undefined ? Math.max(0, parseInt(data.position) || 0) : seekOffset;
                        let chunk = new Blob([data.data]);
                        await writer.write(writePosition, chunk);
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
                        await writer.truncate(size);
                        if (size < seekOffset) seekOffset = size;
                        break;
                    default:
                        throw 'Not implemented'
                }
            },
        };
        let close = async function () {
            await debugHandle(handle, 'FileSystemWritableFileStream.close');
            if (![StreamStateEnum.WRITABLE, StreamStateEnum.ERRORING].includes(state)) throw new TypeError(`Cannot close a ${state.toUpperCase()} writable stream`);
            await writer.close();
            state = state === StreamStateEnum.ERRORING ? StreamStateEnum.ERRORED : StreamStateEnum.CLOSED;
        };
        // XXX
        let abort = async function (reason) {
            await debugHandle(handle, 'FileSystemWritableFileStream.abort', reason);
            if (![StreamStateEnum.WRITABLE, StreamStateEnum.ERRORING].includes(state)) return;
            if (state === StreamStateEnum.WRITABLE) state = StreamStateEnum.ERRORING;
            state = StreamStateEnum.ERRORED;
            await writer.abort();
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
            if (!fileSystemHandle || !fileSystemHandle.kind) throw new TypeError(`parameter 1 is not of type 'FileSystemHandle'.`);
            if (fileSystemHandle.kind !== this.kind || !fileSystemHandle._meta) return false;
            let path = await tool.meta(this).path();
            return '' === await tool.diffPath(path, await tool.meta(fileSystemHandle).path());
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
            let newPath = await tool.joinName(newDirectory, name);
            if (await tool.requestPermission(meta, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
            if ('' === await tool.diffPath(path, newPath)) return;
            if (await tool.requestPermission({ path: newPath, root: destinationMeta?.root }, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
            if (!await sendMessage('fs.isdir', { path: newDirectory })) throw createError('NotFoundError');
            // if (await sendMessage('fs.exists', { path: newPath })) throw InvalidModificationError;
            try {
                await sendMessage('fs.mv', { src: path, dst: newPath, overwrite: false });
            } catch (e) {
                throw createError('InvalidModificationError');
            }
            this._meta.cpath = await tool.cpath(newPath);
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
        async getFile(options) {
            await debugHandle(this, 'getFile', options);
            let meta = tool.meta(this);
            let path = await meta.path();
            if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
            let stat = await tool._stat(path);
            let nonNativePreference = getConfig('NON_NATIVE_FILE', 'never', ['never', 'auto', 'always']);
            let allowNonNative = nonNativePreference === 'always' || !!options?._allowNonNative;
            if (!allowNonNative && stat.size > getConfig('FILE_SIZE_LIMIT', Infinity, "number")) {
                if (nonNativePreference === 'auto') {
                    allowNonNative = true;
                } else {
                    throw createError('NotReadableError', { reason: 'the file size exceeded the allowed limit' });
                }
            }
            let cache = fileCache.get(path);
            // XXX
            let lastModified = Math.round(1000 * stat.mtime);
            if (!(cache && cache.lastModified == lastModified && cache.size == stat.size)) {
                if (allowNonNative) {
                    return createBlob({
                        name: this.name,
                        lastModified,
                        size: stat.size,
                        cpath: meta.cpath,
                    });
                }
                let blobParts = await tool._read(path, { stat });
                cache = new File(blobParts, this.name, { lastModified });
                fileCache.set(path, cache);
            }
            return cache;
        },
        async createWritable(options) {
            await debugHandle(this, 'createWritable', options);
            return await createFileSystemWritableFileStream(getWrapped(this), options);
        },
    }), _FileSystemHandleProto);

    let _FileSystemDirectoryHandleProto = setProto(cloneIntoScope({
        keys: async function* () {
            await debugHandle(this, 'keys');
            let path = await tool.meta(this).path();
            let list = await tool.scandir(path);
            for (let name of list) {
                yield name;
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
            let list = await tool.scandir(path, true);
            for (let item of list) {
                let name = item;
                let realKind = null;
                if (Array.isArray(item)) {
                    name = item[0];
                    realKind = {
                        1: FileSystemHandleKindEnum.FILE,
                        2: FileSystemHandleKindEnum.DIRECTORY,
                    }[item[1]] || null;
                }
                let handle;
                try {
                    if (realKind !== null) {
                        handle = await createFileSystemHandle([path, name], realKind, await meta.root());
                    } else {
                        handle = await getSubFileSystemHandle(meta, name, null, {}, realKind);
                    }
                    let result = cloneIntoScope([handle.name]);
                    result.push(handle);
                    yield result;
                } catch (e) {
                    // XXX: broken symbolic link
                    if (e instanceof DOMException && e.name === createError('NotFoundError').name) {
                        warn(name, e);
                        continue;
                    }
                    throw e;
                }
            }
        },
        async getDirectoryHandle(name, options) {
            await debugHandle(this, 'getDirectoryHandle', name, options);
            return await getSubFileSystemHandle(tool.meta(this), name, FileSystemHandleKindEnum.DIRECTORY, options);
        },
        async getFileHandle(name, options) {
            await debugHandle(this, 'getFileHandle', name, options);
            return await getSubFileSystemHandle(tool.meta(this), name, FileSystemHandleKindEnum.FILE, options);
        },
        async removeEntry(name, options) {
            await debugHandle(this, 'removeEntry', name, options);
            let meta = tool.meta(this);
            let path = await meta.path();
            path = await tool.joinName(path, name);
            await tool.remove({ path, root: meta.root }, options);
        },
        async resolve(possibleDescendant) {
            await debugHandle(this, 'resolve', possibleDescendant);
            let path = await tool.meta(this).path();
            if (!possibleDescendant?.kind) throw new TypeError(`parameter 1 is not of type 'FileSystemHandle'.`);
            let possibleDescendantPath = await tool.meta(possibleDescendant).path();
            let r = await tool.diffPath(possibleDescendantPath, path);
            if (typeof r !== 'string') return null;
            return r.split('/').filter(n => n !== '');
        },
        get [Symbol.asyncIterator]() {
            return this.entries;
        },
    }), _FileSystemHandleProto);

    let _BlobProto = cloneIntoScope({
        slice(start, end, contentType) {
            debugHandle(this, 'blob.slice', start, end, contentType);
            let meta = this._meta;
            if (!meta || !meta.cpath) throw new TypeError('Invalid data');
            start = Math.min(meta.size, parseInt(start) || 0);
            if (start < 0) start = Math.max(0, meta.size + start);
            end = Math.min(meta.size, end !== undefined ? parseInt(end) || 0 : meta.size);
            if (end < 0) end = Math.max(0, meta.size + end);
            if (end < start) end = start;
            return createBlob({
                type: contentType || '',
                cpath: meta.cpath,
                offset: (meta.offset || 0) + start,
                size: end - start,
            });
        },
        async blob(options = {}) {
            await debugHandle(this, 'blob.blob');
            let meta = tool.meta(this);
            let path = await meta.path();
            if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
            let size = meta.size;
            if (size > getConfig('FILE_SIZE_LIMIT', Infinity, "number")) throw createError('NotReadableError', { reason: 'the blob size exceeded the allowed limit' });
            let blobParts = await tool._read(path, {
                offset: meta.offset || 0,
                size,
            });
            return new scope.Blob(blobParts, {
                type: meta.type,
                ...options,
            });
        },
        async arrayBuffer() {
            // XXX
            let result = await (await getWrapped(this).blob()).arrayBuffer();
            return result;
        },
        async text() {
            let result = await (await getWrapped(this).blob()).text();
            return result;
        },
        stream() {
            debugHandle(this, 'blob.stream');
            const blob = this;
            const meta = tool.meta(blob);
            let path;
            let offset = 0;
            let chunk = getConfig('FILE_CHUNK_SIZE', 30 * 1024 ** 2, "number");
            let result = new scope.ReadableStream(cloneIntoScope({
                async start(controller) {
                    path = await meta.path();
                    offset = meta.offset || 0;
                    if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
                },
                async pull(controller) {
                    // FIX: Permission denied to access property "then"
                    controller = getWrapped(controller) || controller;
                    await debugHandle(blob, 'blob.stream.pull', offset);
                    // XXX
                    if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
                    let size = Math.min(chunk, meta.offset + meta.size - offset);
                    let blobParts = await tool._read(path, { offset, size });
                    let data = new scope.Blob(blobParts);
                    if (!data.size) {
                        controller.close();
                        return;
                    }
                    offset += data.size;
                    controller.enqueue(new scope.Uint8Array(await data.arrayBuffer()));
                },
            }));
            return result;
        },
    });

    let _FileProto = setProto(cloneIntoScope({
    }), _BlobProto);

    let propsDescMap = new Map();
    let defGetters = (o, props, options = {}) => {
        propsDescMap.set(o, props);
        let desc = {};
        for (let k in props) {
            desc[k] = {
                configurable: true,
                ...options,
                get() {
                    return props[k].call(this);
                },
            };
        }
        return Object.defineProperties(getWrapped(o) || o, getWrapped(cloneIntoScope(desc)));
    };
    let applyGetters = (o, proto) => {
        let props = propsDescMap.get(proto);
        if (props) {
            // XXX
            for (let k in props) {
                o[k] = props[k].call(o);
            }
        }
        return o;
    };

    defGetters(_BlobProto, {
        size() {
            return this._meta?.size || 0;
        },
        type() {
            return this._meta?.type || '';
        },
    });

    defGetters(_FileProto, {
        name() {
            return this._meta?.name || '';
        },
        lastModified() {
            return this._meta?.lastModified || 0;
        },
    });

    let createFileSystemHandle = async (path, kind = FileSystemHandleKindEnum.FILE, root = null) => {
        let name = null;
        let dir = null;
        if (Array.isArray(path) && path.length == 2) {
            [dir, name] = path;
            if (name) {
                path = await tool.joinName(dir, name);
            } else {
                path = dir;
            }
        }
        path = await tool.normalPath(path);
        if (name === null) name = await tool.basename(path);
        let cpath = await tool.cpath(dir !== null && name ? { dir, name } : path);
        let croot = root ? await tool.cpath(root) : cpath;
        let handle = {
            _meta: {
                cpath,
                croot,
            },
            kind,
            name,
            // __proto__: _FileSystemHandlePrototype
        };
        return tool.parseHandle(cloneIntoScope(handle));
    };

    let getSubFileSystemHandle = async (meta, name, kind = null, options = {}, realKind = null) => {
        let dir = await meta.path();
        let root = await meta.root();
        options = options || {};
        let path = await tool.joinName(dir, name);
        if (kind !== null && (options.create ? await tool.requestPermission({ path, root }, FileSystemPermissionModeEnum.READWRITE) : await tool.queryPermission(path)) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
        if (realKind === null) realKind = await tool._getKind(path);
        if (kind && realKind && realKind !== kind) {
            throw createError('TypeMismatchError');
        } else if (kind && options.create) {
            switch (kind) {
                case FileSystemHandleKindEnum.FILE:
                    await sendMessage('fs.touch', { path });
                    break;
                case FileSystemHandleKindEnum.DIRECTORY:
                    await sendMessage('fs.mkdir', { path });
                    break;
                default:
                    throw createError('TypeMismatchError');
            }
            realKind = kind;
        } else if (!realKind) {
            throw createError('NotFoundError');
        }
        return await createFileSystemHandle([dir, name], realKind, root);
    };

    let createBlob = (meta = {}) => {
        meta = Object.assign({}, meta);
        if (!meta.offset) meta.offset = 0;
        meta._object = 'Blob';
        if ('string' === typeof meta.name) {
            meta._object = 'File';
            if ('number' != typeof meta.lastModified) meta.lastModified = Date.now();
        }
        return tool.parseBlob(cloneIntoScope({ _meta: meta }));
    };

    let concurrentGuard = (func, cacheTimeout = 0) => {
        let _p = new Map();
        return async function (...args) {
            let _args = JSON.stringify(args);
            if (!_p.has(_args)) {
                _p.set(_args, new Promise(async (resolve, reject) => {
                    try {
                        resolve(await func.apply(this, args));
                    } catch (e) {
                        reject(e);
                        cacheTimeout = 0;
                    } finally {
                        let f = () => { _p.delete(_args); };
                        if (cacheTimeout > 0) {
                            setTimeout(f, cacheTimeout);
                        } else {
                            f();
                        }
                    }
                }));
            }
            return await _p.get(_args);
        }
    };

    if (!isWorker) {

        if (!scope.showOpenFilePicker) {
            exportIntoScope('showOpenFilePicker', async function (options) {
                debug('showOpenFilePicker', options);
                // XXX
                if (document.visibilityState === 'hidden') throw createError('SecurityError');
                let paths = await sendMessage('fs.showOpenFilePicker', options);
                if (!paths) throw createError('AbortError');
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
                // XXX
                if (document.visibilityState === 'hidden') throw createError('SecurityError');
                options = options || {};
                let path = await sendMessage('fs.showDirectoryPicker', options);
                if (!path) throw createError('AbortError');
                if (await tool.requestPermission(path, options.mode) !== PermissionStateEnum.GRANTED) throw createError('AbortError');
                let result = await createFileSystemHandle(path, FileSystemHandleKindEnum.DIRECTORY);
                return result;
            });
        }

        if (!scope.showSaveFilePicker) {
            exportIntoScope('showSaveFilePicker', async function (options) {
                debug('showSaveFilePicker', options);
                // XXX
                if (document.visibilityState === 'hidden') throw createError('SecurityError');
                options = options || {};
                let path = await sendMessage('fs.showSaveFilePicker', options);
                if (!path) throw createError('AbortError');
                await tool.setPermission(path, PermissionStateEnum.GRANTED, FileSystemPermissionModeEnum.READWRITE);
                let kind = await tool._getKind(path);
                if (kind === FileSystemHandleKindEnum.FILE) {
                    await tool._write(path, new Blob([]));
                } else {
                    if (kind) {
                        throw createError('TypeMismatchError');
                    } else {
                        await sendMessage('fs.touch', { path });
                    }
                }
                let result = await createFileSystemHandle(path, FileSystemHandleKindEnum.FILE);
                return result;
            });
        }

    }

    let _separator = null;

    let tool = {
        async separator(regexp = false) {
            if (!_separator) _separator = await sendMessage('fs.separator');
            if (!regexp) return _separator;
            return `/${_separator === '\\' ? '\\\\' : ''}`;
        },
        async _resolvePath(method, path, options = {}) {
            if (path && path.cdir && path.name) {
                switch (method) {
                    case 'basename':
                        return path.name;
                    case 'dirname':
                        return path.cdir;
                }
            }
            return await sendMessage(`fs.resolvePath.${method}`, Object.assign({
                path,
            }, options));
        },
        async normalPath(path) {
            if ("function" === typeof path) path = await path();
            path = path || '';
            if (fs_options.isExternal) return path;
            if ((await this.separator()) == '\\') path = path.replace(/\\/g, '/');
            let match = path.match(/^(\/\/[^\/]*|[a-z]:|\/)/i);
            let prefix = match && match[1] ? match[1] : '';
            path = path.slice(prefix.length);
            return prefix + path.replace(/\/{2,}/g, '/').replace(/\/$/, '');
        },
        async diffPath(path, root) {
            if (fs_options.isExternal) return await this._resolvePath('diffPath', path, { root });
            let result = null;
            let droot = root.replace(/\/?$/, '/');
            if (root === path) {
                result = '';
            } else if (path.startsWith(droot)) {
                result = path.slice(droot.length);
            }
            return result;
        },
        async basename(path) {
            if (fs_options.isExternal) return await this._resolvePath('basename', path);
            let separators = await this.separator(true);
            return path.replace(new RegExp(`^.*[${separators}]`), '');
        },
        async dirname(path) {
            if (fs_options.isExternal) return await this._resolvePath('dirname', path);
            // XXX
            if (path === "/") return path;
            let separators = await this.separator(true);
            let result = path.replace(new RegExp(`[${separators}][^${separators}]*$`), '');
            if (result === "" && path.startsWith("/")) result = "/";
            return result;
        },
        stringifyPath(path) {
            if (path && path.cdir) path = "ext-file://" + path.cdir + ":" + path.name;
            return path;
        },
        async cpathJoinName(cpath, name) {
            if (name === "") return cpath;
            if (cpath && cpath.cdir) {
                let key = this.stringifyPath(cpath);
                if (!cacheData.cpath.has(key)) {
                    cacheData.cpath.set(key, cpath = await this._resolvePath('joinName', cpath.cdir, { name: cpath.name }));
                }
                cpath = cacheData.cpath.get(key);
            }
            return { cdir: cpath, name };
        },
        async joinName(path, name) {
            await this.verifyName(name);
            if (fs_options.isExternal) return await this.cpathJoinName(path, name);
            return path.replace(/\/?$/, '/') + name;
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
            if (root && null === await this.diffPath(path, root)) root = null;
            if (!root) root = path;
            let state = await tool.queryPermission(path, mode);
            if (PermissionStateEnum.GRANTED !== state) {
                state = PermissionStateEnum.PROMPT;
                if (!isWorker) {
                    let r = await sendMessage('fs.requestPermission', { path: root, mode });
                    if (r === null) {
                        let _path = root;
                        if (fs_options.isExternal) _path = '…/' + await tool.basename(_path);
                        let message = `<${scope.origin}> will be able to ${mode === FileSystemPermissionModeEnum.READ ? 'view' : 'edit'} (${mode}) files in '${_path}' during this session`;
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
        async scandir(path, kind = false) {
            if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
            let list = await sendMessage('fs.scandir', { path, kind });
            return list;
        },
        async getKind(path) {
            if (await tool.queryPermission(path) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
            return await this._getKind(path);
        },
        async _getKind(path) {
            let kind = await sendMessage('fs.getKind', { path });
            return kind;
        },
        async _stat(path) {
            return await sendMessage('fs.stat', { path });
        },
        async _read(path, options = {}) {
            let offset = options.offset || 0;
            let offset0 = offset;
            let limit = 'number' === typeof options.size ? options.size : null;
            if (limit === 0) return [];
            let stat0 = options.stat;
            let chunk0 = getConfig('FILE_CHUNK_SIZE', 30 * 1024 ** 2, "number");
            let chunk = (stat0 && chunk0 == stat0.size) ? chunk0 + 1 : chunk0;
            let blob;
            if (offset > 0 || limit !== null) {
                if (limit !== null && limit <= chunk) chunk = limit;
                blob = await sendMessage('fs.read', {
                    path,
                    mode: 'chunk',
                    offset,
                    size: chunk,
                });
            } else {
                blob = await sendMessage('fs.read', { path, size: chunk });
            }
            if (blob.size != chunk || chunk === limit) {
                return [blob];
            }
            if (chunk > chunk0) blob = blob.slice(0, chunk0);
            let blobParts = [blob];
            offset += blob.size;
            while (true) {
                let stat = await this._stat(path);
                if (!stat0) stat0 = stat;
                if (stat0.size != stat.size || stat0.mtime != stat.mtime) {
                    debug(path, stat0, stat);
                    throw createError('NotReadableError', { reason: 'the file has been modified' });
                }
                if (limit === null || offset0 + limit > stat.size) limit = Math.max(0, stat.size - offset0);
                chunk = stat.size == offset + chunk0 ? chunk0 + 1 : chunk0;
                blob = await sendMessage('fs.read', {
                    path,
                    mode: 'chunk',
                    offset,
                    size: chunk,
                });
                blobParts.push(blob);
                offset += blob.size;
                debug(path, `${offset}/${offset0 + limit}`, blob.size);
                if (offset0 + limit <= offset || blob.size != chunk) {
                    if (offset0 + limit != offset) {
                        throw createError('NotReadableError', { reason: `the file has been modified` });
                    }
                    break;
                }
            }
            return blobParts;
        },
        async _write(path, data, options = {}) {
            let chunk = getConfig('FILE_CHUNK_SIZE', 30 * 1024 ** 2, "number");
            if (data.size <= chunk) {
                return await sendMessage('fs.write', {
                    ...options,
                    path,
                    data,
                });
            }
            // XXX
            let offset0 = options.offset || 0;
            if ('number' !== typeof offset0 || offset0 < 0) throw new TypeError("Invalid write postion");
            for (let offset = 0; offset < data.size;) {
                let blob = data.slice(offset, offset + chunk);
                let position = offset0 + offset;
                await sendMessage('fs.write', {
                    path,
                    data: blob,
                    mode: options.mode || (position == 0 ? 'new' : 'chunk'),
                    offset: position,
                });
                offset += blob.size;
                debug(path, `${offset0}, ${offset}/${data.size}`, blob.size);
            }
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
            if (await tool.requestPermission({ path, root }, FileSystemPermissionModeEnum.READWRITE) !== PermissionStateEnum.GRANTED) throw createError('NotAllowedError');
            if (!await sendMessage('fs.exists', { path })) throw createError('NotFoundError');
            try {
                await sendMessage('fs.rm', Object.assign(Object.assign({}, options), { path }));
            } catch (e) {
                throw createError('InvalidModificationError');
            }
            fileCache.delete(path);
        },

        async _cpath(path) {
            if (fs_options.isExternal) return path;
            let text = path, cache = true;
            if (!text) return text;
            if (cacheData.encrypt.has(text)) return cacheData.encrypt.get(text);
            let base64 = await sendMessage('fs.encrypt', text);
            if (cache) {
                cacheData.encrypt.set(text, base64);
                cacheData.decrypt.set(base64, text);
            }
            return base64;
        },
        async _parsePath(path) {
            if (fs_options.isExternal) return path;
            let base64 = path, cache = true;
            if (!base64) return base64;
            if (cacheData.decrypt.has(base64)) return cacheData.decrypt.get(base64);
            let text = await sendMessage('fs.decrypt', base64);
            if (cache) {
                if (!cacheData.encrypt.has(text)) cacheData.encrypt.set(text, base64);
                cacheData.decrypt.set(base64, text);
            }
            return text;
        },
        async cpath(path) {
            let name = null;
            if (path && path.dir) {
                name = path.name;
                path = path.dir;
            }
            let cpath = await this._cpath(path);
            if (name) {
                cpath = await this.cpathJoinName(cpath, name);
            }
            return cpath;
        },
        async parsePath(cpath) {
            let name = null;
            if (cpath && cpath.cdir) {
                name = cpath.name;
                cpath = cpath.cdir;
            }
            let path = await this._parsePath(cpath);
            if (name !== null) {
                path = await this.joinName(path, name);
            }
            return path;
        },
        meta(handle) {
            let meta = handle?._meta || handle;
            let cpath = meta?.cpath;
            let croot = meta?.croot;
            let _path, _root;
            return {
                ...meta,
                cpath,
                croot,
                async path() {
                    if (!_path) _path = await tool.parsePath(cpath);
                    return _path;
                },
                async root() {
                    if (!_root) _root = await tool.parsePath(croot);
                    return _root;
                },
            };
        },
        createFileSystemHandle,
        parseHandle(handle) {
            if (!(handle && handle.kind && 'string' === typeof handle.name && handle._meta && 'function' != typeof handle.isSameEntry)) return handle;
            let proto = _FileSystemHandleProto;
            if (handle.kind === FileSystemHandleKindEnum.FILE) {
                proto = _FileSystemFileHandleProto;
            } else if (handle.kind === FileSystemHandleKindEnum.DIRECTORY) {
                proto = _FileSystemDirectoryHandleProto;
            }
            return setProto(handle, proto);
        },
        parseBlob(data) {
            let proto;
            if (!(data?._meta && 'function' != typeof data.arrayBuffer && (proto = {
                Blob: _BlobProto,
                File: _FileProto,
            }[data._meta._object || '']))) return data;
            applyGetters(data, _BlobProto);
            if (proto === _FileProto) applyGetters(data, _FileProto);
            return setProto(data, proto);
        },
    };

    tool.separator = concurrentGuard(tool.separator);
    tool.queryPermission = concurrentGuard(tool.queryPermission);
    tool.requestPermission = concurrentGuard(tool.requestPermission);
    tool._getKind = concurrentGuard(tool._getKind);
    tool.cpathJoinName = concurrentGuard(tool.cpathJoinName);

    let shareApi = {
        isNativeSupported,
        nativeApi: {},
        parseHandle: tool.parseHandle,
        parseBlob: tool.parseBlob,
        async getEnv(options = {}) {
            return sendMessage('fs.getEnv', options);
        },
    };

    if (fs_options.exportInternalTools) {
        for (let k in tool) {
            if (shareApi.hasOwnProperty(k)) continue;
            if (k.startsWith('_')) continue;
            if ('function' === typeof tool[k]) {
                shareApi[k] = tool[k].bind(tool);
            }
        }
    }

    for (let o of ['FileSystemHandle', 'FileSystemFileHandle', 'FileSystemDirectoryHandle', 'FileSystemWritableFileStream']) {
        if (scope[o]) {
            shareApi.nativeApi[o] = scope[o];
        }
        if (!scope[o] || getConfig('OVERRIDE_ENABLED', true)) {
            exportIntoScope(o, scope.Object);
        }
    }


    if (getConfig('CLONE_ENABLED')) {

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

    if (scope.Worker && getConfig('WORKER_ENABLED')) {
        const Worker = scope.Worker;
        shareApi.nativeApi['Worker'] = Worker;
        let actionName = '_fsAction';
        let workerURL = null;
        let currentScript = scope.document?.currentScript;
        exportIntoScope('Worker', function (url, ...options) {
            let baseURI = (new scope.URL(url, fs_options.baseURI || scope.document?.baseURI || scope.location?.href)).href;
            if (!workerURL) {
                if (isWorker) {
                    // XXX
                    workerURL = location.href;
                } else {
                    let workerScripts = getConfig('WORKER_SCRIPTS', fs_options.workerScripts || [currentScript?.src], 'object');
                    let text = `
//# sourceURL="/_fs_page_worker.js"
let FS_CONFIG = ${JSON.stringify(getConfig(null, {}))};
(${JSON.stringify(workerScripts || [])}).forEach(url => importScripts(url));
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
            getWrapped(worker).postMessage = cloneIntoScope(function (data, ...args) {
                // XXX
                if (data && data[actionName]) {
                    warn('block worker.postMessage', [data, ...args]);
                    return;
                }
                return __postMessage(data, ...args);
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
                            case 'sendMessage': {
                                let action = options.action || '';
                                let data = options.data;
                                if (!isWorker && action.startsWith('page.')) {
                                    debug(action, data);
                                    switch (action.replace('page.', '')) {
                                        case 'fetch':
                                            response.data = cloneIntoScope(await (await fetch(data.url)).blob());
                                            break;
                                        default:
                                            throw 'Not implemented';
                                    }
                                    break;
                                }
                                if (!isWorker) action = 'ext:' + action;
                                response.data = await sendMessage(action, data);
                                break;
                            }
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
        if (getConfig('DEBUG_ENABLED')) {
            scope.addEventListener('securitypolicyviolation', (event) => {
                warn(event);
            });
        }
    }

    if (!!getConfig('EXPOSE_NAMESPACE', fs_options.isExternal || fs_options.exportInternalTools)) {
        let shareApiName = getConfig('EXPOSE_NAMESPACE', '__FILE_SYSTEM_TOOLS__', 'string');
        getWrapped(scope)[shareApiName] = cloneIntoScope(shareApi);
    }

}
