import { createApp } from 'vue'
import { installHaExtApi } from '@huaian/plugin-api/client'

installHaExtApi({ chat: true })
void import('./ChatPage.vue').then(({ default: ChatPage }) => {
  createApp(ChatPage).mount('#app')
})
