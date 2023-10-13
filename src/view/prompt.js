let urlObj = new URL(location.href);
let origin = urlObj.searchParams.get("origin");

let renderText = (key, text, attr = false) => {
    [...document.querySelectorAll(`[data-text="${key}"]`)].map(e => {
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
    let m = prompt.message;
    console.log(prompt);
    renderText('origin', origin);
    switch (m.action) {
        case 'requestPermission': {
            try {
                let { mode, path } = m.data || {};
                let modeText = mode === FileSystemPermissionModeEnum.READ ? 'view' : 'edit';
                renderText('perm-mode', modeText);
                renderText('perm-mode-detail', `${modeText} (${mode})`);
                renderText('perm-mode-detail', modeText, true);
                renderText('path', path);
                if (prompt.sender && prompt.sender.tab) {
                    let sender = prompt.sender;
                    let $a = document.querySelector('a[data-action="viewTab"]');
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
                let autoClose = false;
                let resolvePrompt = async (action) => {
                    try {
                        autoClose = await util.sendMessage('fs.resolvePrompt', {
                            origin,
                            id: prompt.id,
                            key: action,
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
                    await resolvePrompt(action);
                });
            } catch (e) {
                console.warn(e);
                alert(e);
            }
            break;
        }
    }
})();
