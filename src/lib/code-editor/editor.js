/**
 * @typedef {string|number} Keybinding
 * @typedef {Record<string,function>} FunctionRecord
 * @typedef {Record<string,function|({id?:string,keybindings?:Keybinding[]}&monaco.editor.IActionDescriptor)>} ActionRecord
 * @typedef {({keybinding?:Keybinding}&monaco.editor.IKeybindingRule)} KeybindingRule
 * @typedef {({func:function|string,args?:any[],world?:'MAIN',injectImmediately?:boolean})} ScriptDetail
 * @typedef {({id?:string,options?:monaco.editor.IStandaloneEditorConstructionOptions&monaco.editor.IDiffEditorConstructionOptions&{originalValue?:string},events?:FunctionRecord,commands?:FunctionRecord,actions?:ActionRecord,keybindingRules?:KeybindingRule[],init?:ScriptDetail|ScriptDetail[],type?:'CodeEditor'|'DiffEditor'})} Context
 *
 * @typedef {string|string[]} ProxyChain
 * @typedef {({args?:any[],optional?:boolean,ext?:ProxyChain|ProxyOptions,clone?:string,chain?:ProxyChain})} ProxyOptions
 *
 * @typedef {({addExtraLib:(source:string,uri:string,createModel:boolean)=>void,addExtraLibs:(name:string|string[],createModel:boolean)=>void,setCompilerOptions:(options:monaco.languages.typescript.CompilerOptions)=>void,setDiagnosticsOptions:(options:monaco.languages.typescript.DiagnosticsOptions)=>void})} JSUtil
 * @typedef {({setDiagnosticsOptions:(options:monaco.languages.json.DiagnosticsOptions)=>void})} JSONUtil
 * @typedef {({pattern?:string|RegExp,excludePattern?:string|RegExp,kind?:number|string,insertTextRules?:number|string}&monaco.languages.CompletionItem)} CompletionItem
 * @typedef {({registerCompletionItems:(languageSelector:monaco.languages.LanguageSelector,items:CompletionItem[])=>void,javascript:JSUtil,typescript:JSUtil,json:JSONUtil})} LanguageUtil
 * @typedef {({editor:monaco.editor.IStandaloneCodeEditor|monaco.editor.IStandaloneDiffEditor,primaryEditor:monaco.editor.IStandaloneCodeEditor,languages:LanguageUtil,updateOptions:(options:monaco.editor.IEditorOptions&monaco.editor.IGlobalEditorOptions)=>void,executeScript:(details:ScriptDetail)=>any,sendMessage:(action:string,data:any)=>any,sendEvent:(type:string,event:any,wait:boolean)=>any})} EditorUtil
 * @typedef {EditorUtil} AsyncEditorUtil
 * @typedef {monaco} AsyncMonaco
 */

/**
 * Available only in the editor context
 * @type {EditorUtil}
 */
var editorUtil;

const codeEditor = {
    extensionId: "code-editor@example.com",
    /**
     * Create a new editor under $container
     * @param {HTMLTextAreaElement|HTMLElement} $container
     * @param {Context} context
     * @returns
     */
    create($container, context = {}) {
        let classBlock = context.classBlock || 'ext-code-editor';
        let $source;
        let restore = () => { };
        if (!context.options) context.options = {};
        switch ($container.nodeName) {
            case 'TEXTAREA': {
                $source = $container;
                if ($source.value !== "" && 'undefined' === typeof context.options.value) context.options.value = $source.value;
                break;
            }
            case 'SCRIPT':
            case 'TEMPLATE': {
                $source = $container;
                if ($source.value !== "" && 'undefined' === typeof context.options.value) context.options.value = $source.innerHTML;
                break;
            }
        }
        if ($source) {
            $container = document.createElement('div');
            $source.style.display = 'none';
            $source.insertAdjacentElement('afterend', $container);
            restore = () => {
                $source.style.display = "";
                if ($container) $container.remove();
            };
        }
        $container.classList.add(`${classBlock}`, `${classBlock}--loading`);
        if (!context) context = {}
        if (!context.events) context.events = {};
        if (!context.events.command) {
            context.events.command = function (event) {
                if (event.kbId) {
                    if ("function" === typeof context.kbCommands[event.kbId]) {
                        context.kbCommands[event.kbId].call(this, ...event.args);
                    }
                } else if (event.scriptId) {
                    if ("function" === typeof context.scripts[event.scriptId]) {
                        let run = context.scripts[event.scriptId];
                        delete context.scripts[event.scriptId];
                        return run.call(this);
                    }
                } else if (event.id) {
                    if ("function" === typeof context.commands[event.id]) {
                        context.commands[event.id].call(this, ...event.args);
                    }
                }
            };
        }
        if (!context.events.action) {
            context.events.action = function (event) {
                if (event.id && context.actions[event.id] && "function" === typeof context.actions[event.id].run) {
                    context.actions[event.id].run.call(this, ...event.args);
                }
            };
        }
        if (!context.commands) context.commands = {};
        if (!context.kbCommands) context.kbCommands = {};
        if (!context.keybindingRules) context.keybindingRules = [];
        if (!context.actions) context.actions = {};
        if (!context.scripts) context.scripts = {};

        const createId = () => {
            return `${Date.now()}-${Math.random()}`;
        };

        let id = context.id || createId();
        const resolves = {};
        const editor = {
            readyState: 'connecting',
        };
        const promises = {};
        {
            let readyStateComplete;
            let readyStateInteractive;
            promises.complete = new Promise(resolve => { readyStateComplete = resolve });
            promises.interactive = new Promise(resolve => { readyStateInteractive = resolve });
            let onreadystatechange = context.events.readystatechange;
            context.events.readystatechange = function (event) {
                editor.readyState = event.readyState;
                switch (event.readyState) {
                    case 'loading': {
                        break;
                    }
                    case 'interactive': {
                        readyStateInteractive();
                        break;
                    }
                    case 'complete': {
                        // await new Promise(r => setTimeout(r, 10000));
                        $container.classList.remove(`${classBlock}--loading`, `${classBlock}--disconnected`);
                        readyStateComplete()
                        break;
                    }
                }
                if (onreadystatechange) onreadystatechange.call(editor, event);
            };
        }
        const port = browser.runtime.connect(this.extensionId, {
            name: id,
        });
        /**
         * Trigger event
         * @param {string} type
         * @param {*} event
         * @returns
         */
        const emit = (type, event) => {
            if (context.events && "function" === typeof context.events[type]) {
                try {
                    return context.events[type].call(editor, event);
                } catch (e) {
                    console.error(e);
                }
            }
        };
        port.onDisconnect.addListener((p) => {
            if (editor.readyState === "connecting") restore();
            if (editor.readyState !== 'dispose') {
                editor.readyState = 'disconnected';
                $container.classList.add(`${classBlock}--disconnected`);
            }
            if (emit('disconnect', p.error) !== false) console.info('editor_disconnect:', p.error)
        });
        port.onMessage.addListener(async (message) => {
            // console.debug(message);
            if (!message) return;
            if (message.code) {
                if (message.id && resolves[message.id]) {
                    resolves[message.id](message);
                    delete resolves[message.id];
                }
            } else {
                let result = {
                    id: message.id,
                    code: 200,
                    data: null,
                };
                let data = message.data || {};
                try {
                    switch (message.action) {
                        case 'event': {
                            // XXX throw error
                            result.data = await emit(data.type, data.event);
                            break;
                        }
                        default: {
                            result.code = 404;
                        }
                    }
                    if (result.id) port.postMessage(result);
                } catch (e) {
                    if (e.code && 'data' in e) {
                        result.code = e.code;
                        result.data = e.data || e;
                    } else {
                        result.code = 500;
                        result.data = e;
                    }
                    if (result.data) result.data = "" + result.data;
                    if (result.id) port.postMessage(result);
                }
            }
        });
        /**
         * Sends action to editor context
         * @param {string} action
         * @param {*} data
         * @returns
         */
        const sendMessage = async (action, data) => {
            let id = `${Date.now()}-${Math.random()}`;
            let message = {
                action,
                data,
                id,
            };
            let promise = new Promise((resolve, reject) => {
                resolves[id] = (message) => {
                    if (message && message.code === 200) {
                        resolve(message.data)
                    } else {
                        reject(message);
                    }
                }
            });
            port.postMessage(message);
            return await promise;
        };
        /**
         * Proxy iframe object
         * @param {ProxyChain} chain
         * @param {ProxyOptions} option
         * @returns {Promise<AsyncEditorUtil|AsyncMonaco>}
         */
        const proxy = async (chain, option = {}) => {
            await promises.interactive;
            let data = Object.assign({ chain }, option);
            return await sendMessage('proxy', data);
        };
        const convertActions = (actions) => {
            let r = {};
            if (!actions) return r;
            for (let id in actions) {
                r[id] = JSON.parse(JSON.stringify(actions[id]));
            }
            return r;
        };
        const convertFunctions = (funcs) => {
            return Object.entries(funcs || {}).reduce((p, [k, v]) => (p[k] = "string" === typeof v ? v : !!v, p), {});
        };
        const convertKeybindingRules = (rules) => {
            let r = [];
            if (!rules || !Array.isArray(rules)) return r;
            for (let rule of rules) {
                let kb = rule.keybinding.trim();
                rule.keybinding = kb;
                if (typeof rule.command === 'function') {
                    let kbId = JSON.stringify({
                        keybinding: kb,
                        when: rule.when || '',
                    });
                    context.kbCommands[kbId] = rule.command;
                    rule.kbId = kbId;
                    delete rule.command;
                }
                r.push(rule);
            }
            return r;
        };
        const normalScript = (details) => {
            if (Array.isArray(details)) {
                return details.map(d => normalScript(d));
            }
            if ('MAIN' === details.world && details.func) {
                const id = createId();
                const func = details.func;
                const args = details.args;
                context.scripts[id] = function () {
                    return func.call(editor, ...(args || []));
                };
                details.scriptId = id;
                delete details.func;
                delete details.args;
                return details;
            }
            if ("function" === typeof details.func) {
                let func = "" + details.func;
                // XXX: unexpected token: identifier
                if (/^[^(]*func\s*\(/.test(func) && !/^[^(]*\bfunction\b[^(]*\(/.test(func)) {
                    func = func.replace(/^([^(]*)(func\s*\()/, '$1 function $2');
                }
                details.func = func;
            }
            return details;
        };

        let init = context.init;
        if (init) {
            if (!Array.isArray(init)) init = [init];
            normalScript(init);
        }

        let $el;
        const dispose = async () => {
            try {
                await proxy('editorUtil.editor.dispose', { args: [] });
            } finally {
                editor.readyState = 'dispose';
                if ($el) $el.remove();
                restore();
            }
        };
        (async () => {
            let r = await sendMessage('create', {
                options: context.options || {},
                events: convertFunctions(context.events),
                actions: convertActions(context.actions),
                commands: convertFunctions(context.commands),
                keybindingRules: convertKeybindingRules(context.keybindingRules),
                init,
                type: context.type,
            });

            let n = document.createElement('iframe');
            n.src = r.url;
            editor.url = r.url;
            $container.appendChild(n);
            $el = n;
        })();

        return Object.assign(editor, {
            id,
            $container,
            promises,
            port,
            dispose,
            sendMessage,
            proxy,
            /**
             * @returns {AsyncEditorUtil}
             */
            get util() {
                let that = this;
                function createProxy(chain = [], args = []) {
                    return new Proxy(() => { }, {
                        get(target, prop, receiver) {
                            return createProxy([...chain, prop], args);
                        },
                        apply(target, thisArg, args) {
                            return that.proxy(chain, { args });
                        }
                    });
                }
                return createProxy(['editorUtil']);
            },
            emit,
            /**
             * Update the editor's options.
             * @param {(Context['options']|FunctionRecord|ActionRecord|KeybindingRule[])} value
             * @param {'options'|'actions'|'commands'|'events'|'keybindingRules'} type
             * @returns
             */
            async updateOptions(value, type = 'options') {
                switch (type) {
                    case 'actions': {
                        Object.assign(context[type], value);
                        value = convertActions(value);
                        break;
                    }
                    case 'commands':
                    case 'events': {
                        Object.assign(context[type], value);
                        value = convertFunctions(value);
                        break;
                    }
                    case 'keybindingRules': {
                        context[type].push(...value);
                        value = convertKeybindingRules(value);
                        break;
                    }
                }
                return await sendMessage('updateContext', {
                    [type]: value,
                });
            },
            /**
             * Get value of the current model attached to this editor.
             * @param {string} [name]
             * @returns {Promise<string>}
             */
            async getValue(name = null) {
                return await sendMessage('getValue', {
                    name,
                });
            },
            /**
             * Injects a script into a target context.
             * @param {ScriptDetail} details
             * @returns
             */
            async executeScript(details) {
                await promises.interactive;
                normalScript(details);
                return await sendMessage('executeScript', details);
            },
        });
    },
    /**
     * Sends action to code-editor extension.
     * @param {string} action
     * @param {*} data
     * @returns
     */
    async sendMessage(action, data) {
        let message = {
            action,
            data,
        };
        let r = await browser.runtime.sendMessage(this.extensionId, message, {});
        if (r && r.code === 200) {
            return r.data;
        } else {
            throw r;
        }
    },
    async getEnv() {
        return await this.sendMessage('getEnv');
    },
};
