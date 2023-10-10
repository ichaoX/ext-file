let urlObj = new URL(location.href);
let origin = urlObj.searchParams.get("origin");
(async () => {
    let prompt = await util.sendMessage('fs.getPrompt', { origin });
    if (!prompt) {
        // XXX
        self.open('about:blank', '_self').close();
        return;
    }
    let m = prompt.message;
    switch (m.action) {
        case 'requestPermission': {
            try {
                let { mode, path } = m.data || {};
                let message = `<${origin}> will be able to ${mode === 'read' ? 'view' : 'edit'} (${mode}) files in '${path}' in this session`;
                let key = confirm(message) ? 1 : 0;
                await util.sendMessage('fs.resolvePrompt', {
                    origin,
                    id: prompt.id,
                    key,
                });
                self.close();
            } catch (e) {
                console.warn(e);
                alert(e);
            }
            break;
        }
    }
})();
