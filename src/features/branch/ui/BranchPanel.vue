<script setup lang="ts">
import type { BranchMeta } from "../../../shared/types";

export interface BranchRow {
  meta: BranchMeta;
  steps: number;
  depth: number;
  current: boolean;
}

defineProps<{
  rows: BranchRow[];
  currentId: string;
  cursor: number;
  canFork: boolean;
}>();

defineEmits<{
  switch: [id: string];
  fork: [];
  remove: [id: string];
}>();
</script>

<template>
  <section class="panel branch-panel">
    <div class="eyebrow">05 / BRANCH LAB</div>
    <h3>
      推演分支
      <small>{{ rows.length }} 条独立路线</small>
    </h3>
    <button
      class="primary fork-btn"
      :disabled="!canFork"
      :title="canFork ? '从当前回放步骤复制局面并建立独立分支' : '请先在回放中选择一个历史步骤'"
      @click="$emit('fork')"
    >
      ⑂ 从此步骤建立分支
    </button>
    <p v-if="!canFork" class="branch-hint">
      回放中选择任意步骤后即可分叉；分支继承该步的地图、角色状态与剩余行动队列。
    </p>
    <div class="branch-list">
      <button
        v-for="row in rows"
        :key="row.meta.id"
        class="branch-row"
        :class="{ chosen: row.current }"
        :style="{ paddingLeft: 12 + row.depth * 14 + 'px' }"
        @click="$emit('switch', row.meta.id)"
      >
        <span class="branch-name">
          <i v-if="row.meta.parentId" class="branch-twig">↳</i>
          {{ row.meta.name }}
        </span>
        <small class="branch-meta">
          {{ row.steps }} 步<template v-if="row.meta.parentId">
            · 分叉于 {{ row.meta.point }}</template
          >
        </small>
        <em
          v-if="row.current"
          class="branch-live"
          :title="cursor < 0 ? '实战推演中' : '停在第 ' + cursor + ' 步'"
          >●</em
        >
        <span
          v-if="row.meta.parentId"
          class="branch-del"
          role="button"
          aria-label="删除分支"
          @click.stop="$emit('remove', row.meta.id)"
          >×</span
        >
      </button>
    </div>
    <p class="branch-footnote">分支共享不可变前缀，删除父分支会保留其全部后代历史。</p>
  </section>
</template>
