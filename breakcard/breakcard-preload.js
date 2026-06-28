const { contextBridge, ipcRenderer } = require("electron");

// 暴露给 breakcard.html 用：完成/跳过时回传给主进程
contextBridge.exposeInMainWorld("breakcardAPI", {
  notify: (event) => ipcRenderer.send("breakcard-event", event)
});
