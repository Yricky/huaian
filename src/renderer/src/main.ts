import { createApp } from 'vue'
import App from './App.vue'
import { initializeAppTheme } from './theme'
import './assets/app.css'

initializeAppTheme()

const app = createApp(App)
app.mount('#root')
