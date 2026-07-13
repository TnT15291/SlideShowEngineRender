const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  currentProject: () => ipcRenderer.invoke("project:current"),
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  assetCatalog: () => ipcRenderer.invoke("assets:catalog"),
  importAssets: (type) => ipcRenderer.invoke("assets:import", type),
  analyzeAssets: () => ipcRenderer.invoke("assets:analyze"),
  chooseMusic: () => ipcRenderer.invoke("pipeline:chooseMusic"),
  runPipeline: (step, payload) => ipcRenderer.invoke("pipeline:run", step, payload),
  directorState: () => ipcRenderer.invoke("director:state"),
  runDirector: (step, payload) => ipcRenderer.invoke("director:run", step, payload),
  previewState: () => ipcRenderer.invoke("preview:state"),
  generatePreviews: (payload) => ipcRenderer.invoke("preview:generate", payload),
  selectPreview: (id) => ipcRenderer.invoke("preview:select", id),
  approvePreview: () => ipcRenderer.invoke("preview:approve"),
  renderSelectedPreview: () => ipcRenderer.invoke("preview:renderFull"),
  readTimeline: (payload) => ipcRenderer.invoke("timeline:read", payload),
  writeTimeline: (payload) => ipcRenderer.invoke("timeline:write", payload),
  chooseTimelineImage: () => ipcRenderer.invoke("timeline:chooseImage"),
  startRender: (payload) => ipcRenderer.invoke("render:start", payload),
  cancelRender: () => ipcRenderer.invoke("render:cancel"),
  openRenderOutput: () => ipcRenderer.invoke("render:openOutput"),
  onRenderEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("render:event", listener);
    return () => ipcRenderer.removeListener("render:event", listener);
  },
});
