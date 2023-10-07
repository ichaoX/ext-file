let render = async () => {
    let tabInfo = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    let infos = await util.sendMessage('tab.queryPermissions', { tabId: tabInfo.id });
    if (!Object.values(infos).find(info => !!info.granted)) self.close();
    document.body.innerHTML = '';
    let isMinor = (path, list, inList = false) => {
        let paths = path.split(new RegExp(`(?<=^/)|(?=[/])`)).reduce((p, a, i) => (p.push((p[i - 1] || "") + a), p), []);
        for (let i of list) {
            if (inList && i === path) continue;
            if (paths.includes(i)) {
                return true;
            }
        }
        return false;
    };
    for (let origin in infos) {
        let info = infos[origin];
        if (!info.granted) continue;
        let template = document.querySelector('#origin-permission').content.cloneNode(true);
        let paths = [];
        let mode;
        mode = template.querySelector(".mode.readwrite");
        if (info.permission[FileSystemPermissionModeEnum.READWRITE].length > 0) {
            let list = info.permission[FileSystemPermissionModeEnum.READWRITE].sort();
            let ul = mode.querySelector("ul");
            let li = ul.querySelector("li");
            li.remove();
            for (let path of list) {
                let item = li.cloneNode(true);
                item.querySelector("[data-path]").setAttribute("data-path", path);
                item.querySelector(".path").textContent = path;
                if (isMinor(path, list, true) || isMinor(path, paths)) item.classList.add("minor");
                ul.appendChild(item);
            }
            paths.push(...list);
        } else {
            mode.remove();
        }
        mode = template.querySelector(".mode.read");
        if (info.permission[FileSystemPermissionModeEnum.READ].length > 0) {
            let list = info.permission[FileSystemPermissionModeEnum.READ].sort();
            let ul = mode.querySelector("ul");
            let li = ul.querySelector("li");
            li.remove();
            for (let path of list) {
                let item = li.cloneNode(true);
                item.querySelector("[data-path]").setAttribute("data-path", path);
                item.querySelector(".path").textContent = path;
                if (isMinor(path, list, true) || isMinor(path, paths)) item.classList.add("minor");
                ul.appendChild(item);
            }
            paths.push(...list);
        } else {
            mode.remove();
        }
        template.querySelector(".origin").textContent = origin;
        [...template.querySelectorAll("[data-origin]")].forEach(n => n.setAttribute("data-origin", origin));
        document.body.appendChild(template);
    }
};

render();

self.addEventListener('click', async function (event) {
    let target = event.target;
    let data = JSON.parse(JSON.stringify(target.dataset));
    if (data.action) {
        Object.entries(data).forEach(([k, v]) => {
            // XXX
            if (k.endsWith('.ctrl')) {
                if (event.ctrlKey) data[k.replace(/\.[^.]*$/, '')] = v;
                delete data[k];
            }
            if (k.endsWith('.shift')) {
                if (event.shiftKey) data[k.replace(/\.[^.]*$/, '')] = v;
                delete data[k];
            }
        });
        await util.sendMessage(data.action, data);
        render();
    }
});
