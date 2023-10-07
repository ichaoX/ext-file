const FileSystemHandleKindEnum = {
    FILE: 'file',
    DIRECTORY: 'directory',
};
const FileSystemPermissionModeEnum = {
    READ: 'read',
    READWRITE: 'readwrite',
};
const PermissionStateEnum = {
    GRANTED: 'granted',
    DENIED: 'denied',
    PROMPT: 'prompt',
};
const WriteCommandTypeEnum = {
    WRITE: "write",
    SEEK: "seek",
    TRUNCATE: "truncate",
};
const StreamStateEnum = {
    WRITABLE: "writable",
    CLOSED: "closed",
    ERRORING: "erroring",
    ERRORED: "errored",
};
