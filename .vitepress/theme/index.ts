import DefaultTheme from 'vitepress/theme'
import './style.css'
import MenuPlanner from './components/MenuPlanner.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('MenuPlanner', MenuPlanner)
  },
}
