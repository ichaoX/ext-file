self.onmessage = async (message) => {
    console.debug('worker', message);
    self.lastMessage = message;

    let { action, data } = message.data || {};
    let request = message.data;
    let response = { action, request, data: null };
    switch (action) {
        case 'workerReadFile': {
            let fileHandle = data;
            console.time("worker-readFile");
            try {
                let file = await fileHandle.getFile();
                response.data = file;
                console.log(`size: ${file.size}`);
            } finally {
                console.timeEnd("worker-readFile");
            }
            break;
        }
        case 'workerReadDir': {
            let dirHandle = data;
            response.data = [];
            console.time("worker-readDir");
            try {
                let i = 0;
                for await (let [key, handle] of dirHandle) {
                    response.data.push([key, handle]);
                    i++;
                }
                console.log(`num: ${i}`);
            } finally {
                console.timeEnd("worker-readDir");
            }
            break;
        }
    }
    self.postMessage(response)
};