import { contextBridge } from 'electron'

// 暴露给渲染进程的 API
const electronAPI = {

}

// 将 API 暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// 类型声明
declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
