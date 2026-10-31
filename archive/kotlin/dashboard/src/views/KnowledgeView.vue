<template>
  <div class="knowledge-command">
    <section class="panel knowledge-hero">
      <div class="knowledge-hero-grid">
        <div class="knowledge-copy">
          <div class="knowledge-band">
            <span>资源</span>
            <span>知识库</span>
          </div>

          <h2>知识库列表</h2>
          <p>
            管理检索来源、导入新文档，并在记忆或智能体使用前测试排序效果。
          </p>

          <div class="grid knowledge-signal-grid">
            <article v-for="signal in knowledgeSignals" :key="signal.label" class="card knowledge-signal" :class="`tone-${signal.tone}`">
              <span>{{ signal.label }}</span>
              <strong>{{ signal.value }}</strong>
              <p>{{ signal.detail }}</p>
            </article>
          </div>
        </div>

        <aside class="knowledge-rail">
          <article class="card knowledge-rail-card">
            <div class="section-title compact">
              <div>
                <h3>检查重点</h3>
                <p>保持来源精简、易读且便于验证，再投入运行使用。</p>
              </div>
            </div>

            <div class="rail-list">
              <div class="rail-item">
                <span>已选知识库</span>
                <strong>{{ selectedBase?.name ?? '未选择' }}</strong>
              </div>
              <div class="rail-item">
                <span>最近导入</span>
                <strong>{{ lastChunkCount !== null ? `${lastChunkCount} 个分块` : '暂无导入' }}</strong>
              </div>
              <div class="rail-item">
                <span>搜索状态</span>
                <strong>{{ results.length > 0 ? `${results.length} 条排序结果` : '等待测试查询' }}</strong>
              </div>
            </div>
          </article>
        </aside>
      </div>
    </section>

    <div class="workbench-grid wide-detail">
      <section class="panel registry-panel">
        <div class="section-title">
          <div>
            <h2>知识库</h2>
            <p>`knowledge_search` 当前可使用 {{ bases.length }} 个知识库。</p>
          </div>
          <button type="button" class="primary" @click="loadBases">刷新</button>
        </div>

        <form class="stacked-form" @submit.prevent="createBase">
          <input v-model="newBaseName" type="text" placeholder="知识库名称" />
          <input v-model="newBaseDescription" type="text" placeholder="描述" />
          <button type="submit" class="primary" :disabled="newBaseName.trim().length === 0">创建</button>
        </form>

        <EmptyState
          v-if="bases.length === 0"
          title="暂无知识库"
          detail="请先创建知识库，再添加用于检索的文本文档。"
        />

        <div v-else class="grid list-grid">
          <article
            v-for="base in bases"
            :key="base.id"
            class="card selectable-card base-card"
            :class="{ selected: base.id === selectedBaseId }"
            @click="selectedBaseId = base.id"
          >
            <h3>{{ base.name }}</h3>
            <p>{{ base.description || '无描述' }}</p>
            <span class="inline-status muted">更新于 {{ formatTime(base.updatedAt) }}</span>
          </article>
        </div>
      </section>

      <aside class="panel detail-panel knowledge-detail-rail">
        <div class="section-title">
          <div>
            <h2>添加文档</h2>
            <p v-if="selectedBase">目标知识库：{{ selectedBase.name }}</p>
            <p v-else>请先选择或创建知识库。</p>
          </div>
        </div>

        <form class="grid" @submit.prevent="addDocument">
          <input v-model="documentName" type="text" placeholder="文档名称" />
          <textarea
            v-model="documentContent"
            class="document-editor"
            placeholder="粘贴 Markdown、笔记或纯文本…"
            spellcheck="false"
          ></textarea>
          <button
            type="submit"
            class="primary"
            :disabled="!selectedBaseId || documentName.trim().length === 0 || documentContent.trim().length === 0"
          >
            添加文档
          </button>
        </form>

        <section v-if="lastChunkCount !== null" class="notice ok">
          已存储 {{ lastChunkCount }} 个分块。
        </section>
      </aside>
    </div>

    <section class="panel search-panel">
      <div class="section-title">
        <div>
          <h2>搜索测试</h2>
          <p>使用与智能体运行时相同的检索链路。</p>
        </div>
      </div>

      <form class="chat-form" @submit.prevent="search">
        <input v-model="query" type="text" placeholder="搜索知识库…" />
        <button type="submit" class="primary" :disabled="query.trim().length === 0">搜索</button>
      </form>

      <EmptyState
        v-if="results.length === 0"
        title="暂无搜索结果"
        detail="提交查询以检查分块排序结果。"
      />

      <div v-else class="grid knowledge-result-grid">
        <article v-for="result in results" :key="result.chunk.id" class="card result-card">
          <div class="section-title compact">
            <div>
              <h3>{{ result.chunk.documentName }}</h3>
              <p>{{ result.chunk.id }}</p>
            </div>
            <span class="status-pill ok">得分 {{ result.score.toFixed(2) }}</span>
          </div>
          <p>{{ result.chunk.content }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { dashboardApi, type KnowledgeBase, type KnowledgeSearchResultDto } from '../api/dashboard';
import EmptyState from '../components/EmptyState.vue';

const bases = ref<KnowledgeBase[]>([]);
const selectedBaseId = ref('');
const newBaseName = ref('');
const newBaseDescription = ref('');
const documentName = ref('');
const documentContent = ref('');
const lastChunkCount = ref<number | null>(null);
const query = ref('');
const results = ref<KnowledgeSearchResultDto[]>([]);

const selectedBase = computed(() => bases.value.find((base) => base.id === selectedBaseId.value) ?? null);

const knowledgeSignals = computed(() => [
  {
    label: '知识库',
    value: String(bases.value.length),
    detail: '当前知识配置列表中已注册的检索来源。',
    tone: bases.value.length > 0 ? 'ok' : 'muted',
  },
  {
    label: '已选择',
    value: selectedBase.value?.name ?? '无',
    detail: selectedBase.value ? '当前文档导入目标和首选搜索范围。' : '请选择知识库以限定导入和测试范围。',
    tone: selectedBase.value ? 'muted' : 'muted',
  },
  {
    label: '最近导入',
    value: lastChunkCount.value !== null ? String(lastChunkCount.value) : '0',
    detail: lastChunkCount.value !== null ? '最近一次文档导入生成的分块数。' : '尚未执行文档导入。',
    tone: lastChunkCount.value !== null ? 'ok' : 'muted',
  },
  {
    label: '结果',
    value: String(results.value.length),
    detail: results.value.length > 0 ? '可查看检索排序结果。' : '运行查询以检查检索质量。',
    tone: results.value.length > 0 ? 'warn' : 'muted',
  },
]);

async function loadBases() {
  const response = await dashboardApi.knowledgeBases();
  bases.value = response.bases;
  if (!selectedBaseId.value && response.bases.length > 0) {
    selectedBaseId.value = response.bases[0].id;
  }
}

async function createBase() {
  const response = await dashboardApi.createKnowledgeBase({
    name: newBaseName.value.trim(),
    description: newBaseDescription.value.trim(),
  });
  bases.value = response.bases;
  selectedBaseId.value = response.bases[0]?.id ?? selectedBaseId.value;
  newBaseName.value = '';
  newBaseDescription.value = '';
}

async function addDocument() {
  if (!selectedBaseId.value) return;
  const chunks = await dashboardApi.addKnowledgeDocument(selectedBaseId.value, {
    documentName: documentName.value.trim(),
    content: documentContent.value,
  });
  lastChunkCount.value = chunks.length;
  documentName.value = '';
  documentContent.value = '';
}

async function search() {
  results.value = await dashboardApi.searchKnowledge({
    query: query.value.trim(),
    knowledgeBaseId: selectedBaseId.value || undefined,
    limit: 5,
  });
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value);
}

onMounted(() => void loadBases());
</script>

<style scoped>
.knowledge-command {
  display: grid;
  gap: 14px;
}

.knowledge-hero {
  border-color: #d7cebd;
  background:
    linear-gradient(135deg, rgba(255, 252, 246, 0.98) 0%, rgba(247, 241, 231, 0.98) 55%, rgba(240, 246, 248, 0.98) 100%);
}

.knowledge-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(280px, 0.82fr);
  gap: 14px;
}

.knowledge-band {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.knowledge-band span,
.knowledge-signal span,
.rail-item span {
  color: #887152;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.knowledge-band span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(182, 159, 111, 0.34);
  background: rgba(255, 251, 245, 0.92);
}

.knowledge-copy h2 {
  margin: 0;
  color: #18304c;
  font-size: clamp(28px, 2vw + 18px, 40px);
  line-height: 0.98;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.knowledge-copy > p {
  margin: 12px 0 0;
  color: #5c6776;
  line-height: 1.66;
}

.knowledge-signal-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 16px;
}

.knowledge-signal {
  display: grid;
  gap: 8px;
  border-top: 3px solid #98a2b0;
  background: rgba(255, 252, 247, 0.9);
}

.knowledge-signal.tone-ok {
  border-top-color: #4c8661;
}

.knowledge-signal.tone-warn {
  border-top-color: #bb8524;
}

.knowledge-signal.tone-muted {
  border-top-color: #98a2b0;
}

.knowledge-signal strong {
  color: #17304d;
  font-size: 28px;
  line-height: 1;
  overflow-wrap: anywhere;
}

.knowledge-signal p {
  margin: 0;
  color: #606a79;
  font-size: 12px;
  line-height: 1.58;
}

.knowledge-rail {
  display: grid;
  gap: 12px;
}

.knowledge-rail-card,
.registry-panel,
.knowledge-detail-rail {
  border-color: #ddd4c5;
  background: rgba(255, 252, 246, 0.92);
}

.rail-list {
  display: grid;
  gap: 10px;
}

.rail-item {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid #e3dacb;
  background: rgba(255, 251, 245, 0.92);
}

.rail-item strong {
  color: #19314d;
  font-size: 14px;
  line-height: 1.46;
}

.registry-panel,
.knowledge-detail-rail,
.search-panel {
  border-color: #ddd3c3;
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.96) 0%, rgba(248, 243, 234, 0.94) 100%);
}

.base-card {
  display: grid;
  gap: 8px;
}

.document-editor {
  min-height: 420px;
}

.knowledge-result-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 1180px) {
  .knowledge-hero-grid,
  .workbench-grid.wide-detail,
  .knowledge-result-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .knowledge-signal-grid {
    grid-template-columns: 1fr;
  }
}
</style>
