self.name = "options";

let $form = document.querySelector("form");
let $save = $form.querySelector(".save");

$form.addEventListener("change", (event) => {
    event.preventDefault();
    $save.disabled = false;
});

self.addEventListener("beforeunload", (event) => {
    if (!$save.disabled) {
        event.preventDefault();
        return (event.returnValue = "");
    }
});

(async () => {
    let section = document.querySelector(".content-script-options");
    let $options = section.querySelector("textarea.options");
    let $env = section.querySelector("textarea.env");
    let key = "content_script_match";
    let setForm = (options) => {
        options = JSON.parse(JSON.stringify(options));
        let env = '';
        if (Array.isArray(options.js)) {
            env = options.js.shift()?.code;
            if (!options.js.length) delete options.js;
        }
        $env.value = env || '';
        $env.dispatchEvent(new Event('change', { bubbles: true }));
        $options.value = JSON.stringify(options, null, " ");
        $options.dispatchEvent(new Event('change', { bubbles: true }));
    }
    $save.onclick = async function (event) {
        try {
            let options = JSON.parse($options.value);
            if (!Array.isArray(options.js)) options.js = [];
            if ("" === $env.value.trim() && !options.js.length) {
                delete options.js;
            } else {
                options.js.unshift({ code: $env.value });
            }
            await util.sendMessage("fs.contentScriptsRegister", options);
            await util.setSetting(key, options);
            this.disabled = true;
            // alert('Saved');
        } catch (e) {
            console.error(e);
            alert(e.message);
            // throw e;
        }
    }
    section.onkeydown = (event) => {
        if (event.ctrlKey && event.key == "s") {
            $save.click();
            event.preventDefault();
        }
    }
    section.querySelector(".reset").onclick = async function (event) {
        setForm(util._defaultConfig[key])
    }
    let options = await util.getSetting(key);
    setForm(options)
    $save.disabled = true;
})();

(async () => {
    let $section = document.querySelector(".app-options");
    let $state = $section.querySelector('.state');
    let $items = $state.querySelectorAll('[data-state]');
    let getState = async (verfiy = false) => {
        [].forEach.call($items, $n => {
            $n.setAttribute('data-status', '');
            $n.textContent = '...'
        });
        let state = {};
        let getConstants = async () => {
            try {
                let info = await util.sendMessage("fs.constants");
                Object.assign(state, info);
            } catch (e) {
                console.warn(e);
                state.error = e;
            }
        };
        if (verfiy) await getConstants();
        try {
            let info = await util.sendMessage("fs.getState");
            Object.assign(state, info);
        } catch (e) {
            console.warn(e);
            if (!state.error) state.error = e;
        }
        if (!verfiy && state.connected) await getConstants();
        state.text = state.connected ? 'Running' : undefined;
        if (state.error && !state.connected) {
            state.error = `${state.error}`;
            if (/\bNo such native application\b/i.test(state.error)) {
                state.text = 'Not Installed';
            } else {
                state.text = state.error;
            }
        }
        console.log(state);
        $section.querySelector(".stop").classList[state.connected ? 'remove' : 'add']('hide');
        [].forEach.call($items, $n => {
            let key = $n.getAttribute('data-state');
            $n.setAttribute('data-status', !state.error && state[key] ? 'ok' : (state.error ? 'error' : ''));
            $n.textContent = state[key] || 'Unknown';
        });
    };
    $section.querySelector(".recheck").onclick = function (event) {
        getState(true);
    };
    $section.querySelector(".stop").onclick = async function (event) {
        try {
            let info = await util.sendMessage("fs.disconnect");
            console.log(info);
        } catch (e) {
            alert(e.message);
        }
        await getState();
    };
    getState();
})();

(async () => {

    let createCodeEditor = ($n) => {
        let key = $n.getAttribute('data-setting');
        let language = $n.getAttribute('data-language');
        let currentValue = null;
        let editor = codeEditor.create($n, {
            options: {
                language,
                minimap: {
                    enabled: false,
                },
            },
            events: {
                async input(event) {
                    $n.value = currentValue = await editor.getValue();
                    $n.dispatchEvent(new Event('change', { bubbles: true }));
                },
            },
            keybindingRules: [
                {
                    keybinding: "CtrlCmd+KeyS",
                    command() {
                        $save.click();
                    },
                },
            ],
        });
        $n.onchange = function () {
            if (this.value === currentValue) return;
            editor.updateOptions({
                value: this.value,
            });
        };
        switch (key) {
            case 'content_script_match': {
                editor.util.languages.json.setDiagnosticsOptions({
                    validate: true,
                    schemas: [
                        {
                            uri: "http://example.com/array_string.json",
                            schema: {
                                type: "array",
                                items: {
                                    type: "string",
                                },
                            },
                        },
                        {
                            uri: "http://example.com/ExtensionFileOrCode.json",
                            schema: {
                                type: "object",
                                properties: {
                                    file: {
                                        type: "string",
                                    },
                                    code: {
                                        type: "string",
                                    },
                                },
                            },
                        },
                        {
                            uri: "http://example.com/RegisteredContentScriptOptions.json",
                            fileMatch: true,
                            schema: {
                                type: "object",
                                required: ["matches"],
                                additionalProperties: false,
                                properties: {
                                    matches: {
                                        description: "An array of match patterns",
                                        $ref: "http://example.com/array_string.json",
                                    },
                                    excludeMatches: {
                                        description: "An array of match patterns",
                                        $ref: "http://example.com/array_string.json",
                                    },
                                    includeGlobs: {
                                        description: "An array of globs",
                                        $ref: "http://example.com/array_string.json",
                                    },
                                    excludeGlobs: {
                                        description: "An array of globs",
                                        $ref: "http://example.com/array_string.json",
                                    },
                                    css: {
                                        description: "The list of CSS files to inject",
                                        type: "array",
                                        items: {
                                            $ref: "http://example.com/ExtensionFileOrCode.json",
                                        },
                                    },
                                    js: {
                                        description: "The list of JS files to inject",
                                        type: "array",
                                        items: {
                                            $ref: "http://example.com/ExtensionFileOrCode.json",
                                        },
                                    },
                                    allFrames: {
                                        description: "If allFrames is `true`, implies that the JavaScript or CSS should be injected into all frames of current page. By default, it's `false` and is only injected into the top frame.",
                                        type: "boolean",
                                    },
                                    matchAboutBlank: {
                                        description: "If matchAboutBlank is true, then the code is also injected in about:blank and about:srcdoc frames if your extension has access to its parent document. Code cannot be inserted in top-level about:-frames. By default it is `false`.",
                                        type: "boolean",
                                    },
                                    // runAt
                                    cookieStoreId: {
                                        description: "Limit the set of matched tabs to those that belong to the given cookie store id",
                                        oneOf: [
                                            {
                                                $ref: "http://example.com/array_string.json",
                                            },
                                            {
                                                type: "string",
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                });
                break;
            }
            case 'content_script_js': {
                let dataset = [
                    {
                        label: 'FS_API_ENABLED',
                        documentation: 'Enable polyfill for File System API.',
                    },
                    {
                        label: 'FS_OVERRIDE_ENABLED',
                        documentation: 'Override native `FileSystem*` API to Object.',
                    },
                    {
                        label: 'FS_CLONE_ENABLED',
                        documentation: 'Preserve methods when cloning `FileSystem*Handle`.',
                    },
                    {
                        label: 'FS_WORKER_ENABLED',
                        documentation: 'Inject File System API into worker.',
                    },
                    {
                        label: 'FS_FILE_SIZE_LIMIT',
                        documentation: 'Limit file size (byte) when reading.'
                    },
                    {
                        label: 'FS_FILE_CACHE_EXPIRE',
                        documentation: 'Clear cache for files not accessed beyond timeout (second).',
                    },
                    {
                        label: 'FS_DEBUG_ENABLED',
                        documentation: 'Enable Debug mode.',
                    },
                ];
                editor.util.languages.registerCompletionItems("javascript", dataset.map(e => Object.assign({
                    kind: "Variable",
                }, e)));
                break;
            }
        }
    };

    let observer = new IntersectionObserver((entries, opts) => {
        entries.forEach(entry => {
            let target = entry.target;
            let rect = target.getBoundingClientRect();
            // console.debug(target, rect);
            if (rect.top == 0 && rect.bottom == 0) return;
            createCodeEditor(target);
            observer.unobserve(target);
        });
    }, { threshold: 0.05 });

    [...$form.querySelectorAll("textarea.editor")].map(n => observer.observe(n));

})();
