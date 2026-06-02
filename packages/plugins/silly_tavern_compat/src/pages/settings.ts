import { createApp } from 'vue'
import { installHaExtApi } from '@st-forge/plugin-api/client'

installHaExtApi()
void import('./SettingsPage.vue').then(({ default: SettingsPage }) => {
  createApp(SettingsPage).mount('#app')
})
