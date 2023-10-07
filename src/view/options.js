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
        $options.value = JSON.stringify(options, null, " ");
    }
    section.querySelector(".save").onclick = async function (event) {
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
            alert('Saved');
        } catch (e) {
            console.error(e);
            alert(e.message);
            // throw e;
        }
    }
    section.onkeydown = (event) => {
        if (event.ctrlKey && event.key == "s") {
            section.querySelector(".save").onclick();
            event.preventDefault();
        }
    }
    section.querySelector(".reset").onclick = async function (event) {
        setForm(util._defaultConfig[key])
    }
    let options = await util.getSetting(key);
    setForm(options)
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
