#!/usr/bin/env -S python -u

# Note that running python with the `-u` flag is required on Windows,
# in order to ensure that stdin and stdout are opened in binary, rather
# than text, mode.

import atexit
import base64
import json
import mimetypes
import os
import shutil
import sys
import struct
import tempfile
import time
import threading
import traceback

__version__ = '0.9.4'

try:
    import queue
except ImportError:
    import Queue as queue

stdin = sys.stdin
stdout = sys.stdout

try:
    stdin = stdin.buffer
    stdout = stdout.buffer
except AttributeError:
    pass

# Read a message from stdin and decode it.


def getMessage():
    rawLength = stdin.read(4)
    if not rawLength:
        # sys.exit(0)
        return None
    messageLength = struct.unpack('=I', rawLength)[0]
    if not messageLength:
        return None
    message = stdin.read(messageLength).decode('utf-8')
    return json.loads(message)

# Encode a message for transmission, given its content.


def encodeMessage(messageContent):
    # https://docs.python.org/3/library/json.html#basic-usage
    # To get the most compact JSON representation, you should specify
    # (',', ':') to eliminate whitespace.
    # We want the most compact representation because the browser rejects
    # messages that exceed 1 MB.
    encodedContent = json.dumps(
        messageContent, separators=(',', ':')).encode('utf-8')
    encodedLength = struct.pack('=I', len(encodedContent))
    return {'length': encodedLength, 'content': encodedContent}

# Send an encoded message to stdout.


outputLock = threading.Lock()


def sendMessage(encodedMessage):
    with outputLock:
        stdout.write(encodedMessage['length'])
        stdout.write(encodedMessage['content'])
        stdout.flush()


def response(data, messageId, code=200):
    # XXX
    if type(data) == bytes:
        data = data.decode('utf-8')
    encodedMessage = encodeMessage({
        'id': messageId,
        'code': code,
        'data': data,
    })
    MAX_SIZE = 1024*1024
    if len(encodedMessage['content']) <= MAX_SIZE:
        sendMessage(encodedMessage)
    else:
        CHUNK_SIZE = int(MAX_SIZE/2)
        encode = None
        if type(data) != str:
            data = json.dumps(data, separators=(',', ':'))
            encode = 'json'
        baseMessageId = '%s' % messageId
        nextMessageId = '%s' % messageId
        dataLength = len(data)
        for i in range(0, dataLength, CHUNK_SIZE):
            chunk = data[i:i+CHUNK_SIZE]
            messageId = nextMessageId
            nextMessageId = "%s:%s" % (baseMessageId, i)
            message = {
                'id': messageId,
                'code': code,
                'data': chunk,
            }
            if i+CHUNK_SIZE < dataLength:
                message['code'] = 206
                message['next_id'] = nextMessageId
            elif bool(encode):
                message['encode'] = encode
            sendMessage(encodeMessage(message))


def parseWellKnownDirectory(name, verify=False):
    if not isinstance(name, basestring if 'basestring' in vars(__builtins__) else str):
        name = "documents"
    # XXX
    path = {
        "desktop": "~/Desktop",
        "documents": "~/Documents",
        "downloads": "~/Downloads",
        "music": "~/Music",
        "pictures": "~/Pictures",
        "videos": "~/Videos",
    }.get(name, name)
    path = os.path.expanduser(path)
    if not os.path.isdir(path):
        path = os.path.expanduser("~")
    if verify and not os.path.isdir(path):
        path = os.path.abspath(".")
    return path


def parseTypes(types, excludeAcceptAllOption=False):
    try:
        if not types:
            return []
        # TODO MIME
        filetypes = [(t.get("description", ""), tuple(s for ss in list(t.get(
            "accept", {}).values()) for s in (ss if type(ss) == list else [ss]))) for t in types]
        if not excludeAcceptAllOption:
            filetypes.append(('All Files', '*'))
        return filetypes
    except:
        return []


pickerActions = ['showDirectoryPicker',
                 'showOpenFilePicker', 'showSaveFilePicker']
root = None
filedialog = None
temp_files = set()


def task(message):
    messageId = message.get('id')
    action = message.get('action')
    data = message.get('data', dict())
    result = None
    if action == 'version':
        result = __version__
    elif action == 'constants':
        result = {
            'version': __version__,
            'separator': os.sep,
        }
    elif action in pickerActions:
        global filedialog
        global root
        if not root:
            try:
                from tkinter import Tk, filedialog
            except ImportError:
                from Tkinter import Tk
                import tkFileDialog as filedialog
            root = Tk()
            root.withdraw()
            root.update()
        time.sleep(0.2)
        root.deiconify()
        root.wm_attributes('-topmost', True)
        root.focus_force()
        root.withdraw()
        if action == 'showDirectoryPicker':
            result = filedialog.askdirectory(
                title=data.get('title'),
                initialdir=parseWellKnownDirectory(data.get('startIn')),
                mustexist=True,
            )
            if not result:
                result = None
        elif action == 'showOpenFilePicker':
            options = {
                'title': data.get('title'),
                'initialdir': parseWellKnownDirectory(data.get('startIn')),
                'filetypes': parseTypes(data.get('types'), data.get('excludeAcceptAllOption', False)),
                'initialfile': data.get('initialfile'),
            }
            if data.get('multiple', False):
                result = filedialog.askopenfilenames(**options)
            else:
                path = filedialog.askopenfilename(**options)
                result = [path] if path else path
            if not result:
                result = None
        elif action == 'showSaveFilePicker':
            result = filedialog.asksaveasfilename(
                title=data.get('title'),
                filetypes=parseTypes(data.get('types'), data.get(
                    'excludeAcceptAllOption', False)),
                initialdir=parseWellKnownDirectory(data.get('startIn')),
                initialfile=data.get("suggestedName", data.get('initialfile')),
            )
            if not result:
                result = None
        root.update()
    elif action == 'scandir':
        path = data.get('path')
        _result = os.listdir(path)
        if data.get('kind'):
            result = []
            for _ in _result:
                item = path+'/'+_
                if os.path.isfile(item):
                    kind = 1
                elif os.path.isdir(item):
                    kind = 2
                else:
                    kind = 0
                result.append([_, kind])
        else:
            result = _result
    elif action == 'getKind':
        path = data.get('path')
        if os.path.isfile(path):
            result = 'file'
        elif os.path.isdir(path):
            result = 'directory'
    elif action == 'isfile':
        result = os.path.isfile(data.get('path'))
    elif action == 'isdir':
        result = os.path.isdir(data.get('path'))
    elif action == 'exists':
        result = os.path.exists(data.get('path'))
    elif action == 'abspath':
        path = data.get('path')
        if data.get('startIn', False):
            result = parseWellKnownDirectory(path, True)
        else:
            if data.get('expand', False):
                path = os.path.expandvars(path)
                path = os.path.expanduser(path)
            result = os.path.abspath(path)
    elif action == 'stat':
        path = data.get('path')
        info = os.stat(path)
        result = {
            'mtime': info.st_mtime,
            'size': info.st_size,
        }
        if info.st_mode >> 12 == 8:
            mimeinfo = mimetypes.guess_type(path)
            # XXX
            mime = mimeinfo[0] if mimeinfo[1] is None else None
            if mime != None:
                result['type'] = mime
    elif action == 'read':
        with open(data.get('path'), data.get('mode', 'rb')) as f:
            offset = data.get('offset')
            if offset:
                f.seek(offset)
            result = f.read(data.get('size', -1))
            if data.get('encode') == 'base64':
                result = base64.b64encode(result)
    elif action == 'write':
        with open(data.get('path'), data.get('mode', 'wb')) as f:
            offset = data.get('offset')
            if offset != None:
                # XXX
                f.seek(offset)
            s = data.get('data', '')
            if data.get('encode') == 'base64':
                s = base64.b64decode(s)
            result = f.write(s)
    elif action == 'truncate':
        with open(data.get('path'), data.get('mode', 'r+b')) as f:
            size = data.get('size', 0)
            result = f.truncate(size)
            # XXX
            f.seek(0, os.SEEK_END)
            diff = size-f.tell()
            if diff > 0:
                f.write(b'\x00' * diff)
    elif action == 'mktemp':
        # XXX
        fd, result = tempfile.mkstemp(prefix="fsa")
        try:
            os.close(fd)
            path = data.get('path')
            if path:
                shutil.copyfile(path, result)
            temp_files.add(result)
        except:
            os.remove(result)
            raise
    elif action == 'mkdir':
        path = data.get('path')
        if not os.path.isdir(path):
            os.makedirs(path)
    elif action == 'touch':
        path = data.get('path')
        if not os.path.isfile(path):
            open(path, 'a').close()
    elif action == 'rm':
        path = data.get('path')
        if os.path.isdir(path):
            if data.get('recursive', False):
                shutil.rmtree(path)
            else:
                os.rmdir(path)
        else:
            os.remove(path)
        if path in temp_files:
            temp_files.remove(path)
    elif action == 'mv':
        src = data.get('src')
        dst = data.get('dst')
        if not data.get('overwrite', False):
            if os.path.exists(dst):
                raise OSError("dst exists")
        else:
            # XXX
            pass
        shutil.move(src, dst)
        if src in temp_files:
            temp_files.remove(src)
    elif action == 'echo':
        result = data
    else:
        response("Not implemented", messageId, 400)
        return
    response(result, messageId)


def onError(e, messageId, code=500):
    response({
        "message": "%s %s" % (e.__class__.__name__, e),
        "trace": traceback.format_exc(),
    }, messageId, code)


def onExit():
    for _ in temp_files:
        try:
            if os.path.isfile(_):
                os.remove(_)
        except:
            pass


def main():
    MAX_WORKERS = 5
    isTkMainThread = sys.platform == 'darwin'
    taskQueue = queue.Queue()
    tkQueue = queue.Queue(2)

    def worker(q, once=False):
        while True:
            if once:
                try:
                    message = q.get_nowait()
                except queue.Empty:
                    return
            else:
                message = q.get()
            try:
                task(message)
            except Exception as e:
                onError(e, message.get("id"))
            finally:
                q.task_done()
            if once:
                break

    for _ in range(MAX_WORKERS):
        t = threading.Thread(target=worker, args=(taskQueue,))
        t.daemon = True
        t.start()

    if not isTkMainThread:
        tkThread = threading.Thread(target=worker, args=(tkQueue,))
        tkThread.daemon = True
        tkThread.start()

    atexit.register(onExit)

    while True:
        message = getMessage()
        if message is None:
            break
        messageId = None
        try:
            messageId = message.get("id")
            if message.get('action') in pickerActions:
                tkQueue.put(message, False)
            else:
                taskQueue.put(message)
        except Exception as e:
            onError(e, messageId)
        if isTkMainThread:
            worker(tkQueue, True)

    taskQueue.join()

    # if root:
    #     root.update()
    #     root.destroy()


if __name__ == "__main__":
    main()
