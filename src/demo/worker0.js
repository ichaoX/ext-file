let worker = new Worker('worker.js');

self.addEventListener('message', (message) => {
    console.debug('worker0 -> worker', message);
    worker.postMessage(message.data);
});

worker.addEventListener("message", (message) => {
    console.debug('worker0 <- worker', message);
    self.postMessage(message.data);
});
