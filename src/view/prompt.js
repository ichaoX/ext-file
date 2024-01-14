let urlObj = new URL(location.href);
let origin = urlObj.searchParams.get("origin");
let $container = document.body;
let _resolveData = {};
let getResolveData = (key) => (_resolveData[key] ? _resolveData[key]() : null);

let renderText = (key, text, attr = false) => {
    [...$container.querySelectorAll(`[data-text="${key}"]`)].map(e => {
        if (attr) {
            e.setAttribute('data-value', text);
        } else {
            e.textContent = text;
        }
    });
};

(async () => {
    let prompt = await util.sendMessage('fs.getPrompt', { origin });
    if (!prompt) {
        // XXX
        self.open('about:blank', '_self').close();
        return;
    }
    let type = prompt.type;
    let m = prompt.message;
    console.log(prompt);
    $container = document.querySelector(`.container.${type}`);
    $container.style.display = '';
    $container.setAttribute('data-message-action', m.action);
    let $n = $container.querySelector('[autofocus]');
    if ($n) $n.focus();
    renderText('origin', origin);
    if (Array.isArray(prompt.resolveKeys)) {
        [...$container.querySelectorAll("[data-action].hide")].forEach($n => {
            if (prompt.resolveKeys.includes($n.getAttribute("data-action"))) {
                $n.classList.remove('hide');
            }
        });
    }
    let autoClose = false;
    let resolvePrompt = async (action, data) => {
        try {
            autoClose = await util.sendMessage('fs.resolvePrompt', {
                origin,
                id: prompt.id,
                key: action,
                data,
            });
            if (autoClose) self.close();
        } catch (e) {
            console.warn(e);
            alert(e);
        }
    }
    self.onbeforeunload = () => {
        if (!autoClose) resolvePrompt('cancel');
    };
    document.body.addEventListener('click', async (event) => {
        let target = event.target;
        let action;
        while (target && !(action = target.getAttribute('data-action'))) {
            target = target.parentElement
        }
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        let data = await getResolveData(action);
        await resolvePrompt(action, data);
    });
    if (prompt.sender && prompt.sender.tab) {
        let sender = prompt.sender;
        let $a = $container.querySelector('a[data-action="viewTab"]');
        if (sender.url) $a.href = sender.url;
        if (sender.tab.title) $a.title = sender.tab.title;
        renderText('tab-detail', `id=${sender.tab.id}:${sender.frameId}`);
        if (sender.id) {
            renderText('sender-id', sender.id);
            if (sender.id !== browser.runtime.id) {
                renderText('external', sender.id, true);
            }
        }
    }
    try {
        switch (prompt.type) {
            case 'request-permission': {
                let { mode, path } = m.data || {};
                let modeText = mode === FileSystemPermissionModeEnum.READ ? 'view' : 'edit';
                renderText('perm-mode', modeText);
                renderText('perm-mode-detail', `${modeText} (${mode})`);
                renderText('perm-mode-detail', modeText, true);
                renderText('path', path);
                break;
            }
            case 'file-picker': {
                await initFilePicker(m);
                break;
            }
        }
    } catch (e) {
        console.warn(e);
        alert(e);
    }
})();
