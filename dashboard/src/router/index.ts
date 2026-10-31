import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { runtimeNavigation } from '../components/typescript/navigation';

const runtimeView = () => import('../views/TypescriptRuntimeView.vue');

/** Keep old bookmarks useful without loading archived Kotlin or Rust modules. */
const redirects: readonly { path: string; target: string }[] = [
  { path:'/ts', target:'/' },
  { path:'/welcome', target:'/' },
  { path:'/ims', target:'/platforms' },
  { path:'/llms', target:'/providers' },
  { path:'/config', target:'/settings' },
  { path:'/conversations', target:'/sessions' },
  { path:'/knowledge', target:'/knowledge-base' },
  { path:'/resources/memories', target:'/memories' },
  { path:'/resources/skills', target:'/extensions' },
  { path:'/resources/mcp', target:'/extensions' },
  { path:'/logs/executions', target:'/agent-records' },
  { path:'/runs', target:'/agent-records' },
  { path:'/rust', target:'/flow' },
  { path:'/legacy', target:'/' },
  { path:'/legacy/config', target:'/settings' },
  { path:'/legacy/ims', target:'/platforms' },
  { path:'/legacy/llms', target:'/providers' },
  { path:'/legacy/agents', target:'/agents' },
  { path:'/legacy/resources/personas', target:'/personas' },
  { path:'/legacy/resources/skills', target:'/extensions' },
  { path:'/legacy/resources/memories', target:'/memories' },
  { path:'/legacy/resources/mcp', target:'/extensions' },
  { path:'/legacy/resources/tools', target:'/tools' },
  { path:'/legacy/conversations', target:'/sessions' },
  { path:'/legacy/conversations/:id', target:'/sessions' },
  { path:'/legacy/logs/system', target:'/settings' },
  { path:'/legacy/logs/executions', target:'/agent-records' },
  { path:'/legacy/plugins', target:'/plugins' },
];

export const routes: RouteRecordRaw[] = [
  ...runtimeNavigation.map(item => ({ path:item.path, name:`typescript-${item.id}`, component:runtimeView, meta:{ typescriptRuntime:true, label:item.label, group:item.group, summary:item.summary } })),
  ...redirects.map(item => ({ path:item.path, redirect:item.target })),
  { path:'/:pathMatch(.*)*', redirect:'/' },
];

export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.path !== from.path || to.query.agent !== from.query.agent || to.query.platform !== from.query.platform) return { top: 0 };
    return undefined;
  },
});
