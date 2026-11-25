import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { BadgeComponent } from '../ui/badge';
import { CodeComponent } from '../ui/code';
import { EmptyComponent } from '../ui/empty';
import { NoticeComponent } from '../ui/notice';
import { RulesComponent } from '../ui/rules';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { TagComponent } from '../ui/tag';
import { TextComponent } from '../ui/text';
import { VisualPageComponent } from './visual-page';
import type { RegistryEntry } from './registry-data';
import { categoryLabel, findRegistryEntry } from './registry-data';

/**
 * 组件 API 页：`/vis/components/:selector`。
 *
 * 数据只来自 `ui/registry.json` —— 页面不解析 TypeScript 源码，也不假装知道
 * 组件的全部输入输出。登记表里写了 `api` 的组件（卡片 / 代码 / 搜索）才展示
 * 关键输入输出；其余组件只展示选择器、分类、变体、尺寸与 Token。
 *
 * 选择器未登记时给空态，而不是空白页或 404：注册表是索引，回得去。
 */
@Component({
  selector: 'app-vis-component-api',
  imports: [
    BadgeComponent,
    CodeComponent,
    EmptyComponent,
    NoticeComponent,
    RouterLink,
    RulesComponent,
    SectionBlockComponent,
    TableComponent,
    TagComponent,
    TextComponent,
    VisualPageComponent,
  ],
  styleUrl: './component-api.scss',
  template: `
    <app-visual-page
      title="组件 API"
      hint="按选择器查看登记表里的变体、尺寸、Token 与用法片段。"
    >
      @if (entry(); as item) {
        <ui-section [title]="item.name" [pill]="categoryLabel(item.category)">
          @if (item.deprecated) {
            <ui-notice tone="warn" title="已废弃">
              该选择器只保留兼容别名，新页面不要再用；迁移到注册表里的现行组件。
            </ui-notice>
          }

          <ui-table density="docs">
            <table>
              <thead>
                <tr>
                  <th scope="col" class="api-key">字段</th>
                  <th scope="col">值</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="api-key">选择器</td>
                  <td class="mono">{{ item.selector }}</td>
                </tr>
                <tr>
                  <td class="api-key">分类</td>
                  <td>{{ categoryLabel(item.category) }} <span class="mono">({{ item.category }})</span></td>
                </tr>
                <tr>
                  <td class="api-key">展示页</td>
                  <td>
                    @if (item.page) {
                      <a [routerLink]="item.page">{{ item.page }}</a>
                    } @else {
                      —
                    }
                  </td>
                </tr>
                <tr>
                  <td class="api-key">样张文件</td>
                  <td class="mono">{{ item.demoFile || '—' }}</td>
                </tr>
                <tr>
                  <td class="api-key">状态</td>
                  <td>
                    @if (item.deprecated) {
                      <ui-badge tone="orange" size="sm">已废弃</ui-badge>
                    } @else {
                      <ui-badge tone="green" size="sm">现行</ui-badge>
                    }
                  </td>
                </tr>
              </tbody>
            </table>
          </ui-table>
        </ui-section>

        <ui-section title="变体、尺寸与 Token" pill="Spec">
          <ui-table density="docs">
            <table>
              <thead>
                <tr>
                  <th scope="col" class="api-key">维度</th>
                  <th scope="col">值</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="api-key">变体</td>
                  <td>
                    <div class="api-tags">
                      @for (value of item.variants ?? []; track value) {
                        <ui-tag size="sm" [mono]="true">{{ value }}</ui-tag>
                      } @empty {
                        —
                      }
                    </div>
                  </td>
                </tr>
                <tr>
                  <td class="api-key">尺寸</td>
                  <td>
                    <div class="api-tags">
                      @for (value of item.sizes ?? []; track value) {
                        <ui-tag size="sm" [mono]="true">{{ value }}</ui-tag>
                      } @empty {
                        —
                      }
                    </div>
                  </td>
                </tr>
                <tr>
                  <td class="api-key">Token</td>
                  <td>
                    <div class="api-tags">
                      @for (value of item.tokens ?? []; track value) {
                        <ui-tag size="sm" [mono]="true">{{ value }}</ui-tag>
                      } @empty {
                        —
                      }
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </ui-table>
        </ui-section>

        <ui-section title="用法" pill="HTML">
          <ui-code title="usage" lang="html" [code]="snippet()" />
          <ui-text variant="hint">
            片段由选择器与登记表里的变体拼出来，只示意调用形状；属性名与取值仍以组件的
            <code>input()</code> 为准。
          </ui-text>
        </ui-section>

        @if (hasApi()) {
          <ui-section title="关键输入 / 输出" pill="API">
            <ui-table density="docs">
              <table>
                <thead>
                  <tr>
                    <th scope="col" class="api-key">方向</th>
                    <th scope="col" class="api-key">名称</th>
                    <th scope="col" class="api-key">类型</th>
                    <th scope="col">说明</th>
                  </tr>
                </thead>
                <tbody>
                  @for (member of item.api?.inputs ?? []; track member.name) {
                    <tr>
                      <td class="api-key">输入</td>
                      <td class="mono">{{ member.name }}</td>
                      <td class="mono">{{ member.type || '—' }}</td>
                      <td>{{ member.note || '—' }}</td>
                    </tr>
                  }
                  @for (member of item.api?.outputs ?? []; track member.name) {
                    <tr>
                      <td class="api-key">输出</td>
                      <td class="mono">{{ member.name }}</td>
                      <td class="mono">{{ member.type || '—' }}</td>
                      <td>{{ member.note || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </ui-table>
          </ui-section>
        }

        <ui-section title="约定" pill="Rules" [plain]="true">
          <ui-rules>
            <li><b>数据源</b>：本页只读 <code>ui/registry.json</code>，不解析 TypeScript 源码。</li>
            <li><b>登记优先</b>：变体 / 尺寸 / Token 写在登记表，页面只负责展示；改规格先改登记表。</li>
            <li><b>关键输入输出</b>：只有登记了 <code>api</code> 的组件才列出输入输出，且只列关键项。</li>
            <li>
              <b>索引</b>：
              <a routerLink="/vis/registry">组件注册表</a>
              是入口；未登记的选择器给出空态，不返回 404。
            </li>
          </ui-rules>
        </ui-section>
      } @else {
        <ui-section title="未登记的组件" pill="Not found">
          <ui-empty
            icon="⌕"
            [title]="'没有选择器「' + selector() + '」的登记'"
            hint="检查拼写，或回到组件注册表挑一个已登记的组件。"
          >
            <div class="api-actions">
              <a routerLink="/vis/registry">返回组件注册表</a>
            </div>
          </ui-empty>
        </ui-section>
      }
    </app-visual-page>
  `,
})
export class ComponentApiPage {
  private readonly route = inject(ActivatedRoute);

  readonly selector = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('selector') ?? '')),
    { requireSync: true },
  );

  readonly entry = computed(() => findRegistryEntry(this.selector()));

  readonly hasApi = computed(() => {
    const api = this.entry()?.api;
    return !!api && ((api.inputs?.length ?? 0) > 0 || (api.outputs?.length ?? 0) > 0);
  });

  readonly snippet = computed(() => {
    const item = this.entry();
    return item ? usageSnippet(item) : '';
  });

  readonly categoryLabel = categoryLabel;
}

/**
 * 由登记表拼一段静态 HTML 用法。
 *
 * 只写「选择器 + 变体 / 尺寸注释」，不猜属性名：登记表没有登记属性名，
 * 硬拼 `variant="…"` 会把 `ui-chip`（用 `active`）这类组件写成错的。
 * 真属性名以组件的 `input()` 与「关键输入 / 输出」表为准。
 *
 * 片段是普通字符串，模板里走 `{{ }}` 插值 —— Angular 会转义 `<` / `&`，
 * 不要改成 `innerHTML`，否则登记表内容就成了注入点。
 */
function usageSnippet(item: RegistryEntry): string {
  const variants = item.variants ?? [];
  const sizes = item.sizes ?? [];
  const lines: string[] = [
    `<${item.selector}>`,
    '  <!-- 投影内容 -->',
    `</${item.selector}>`,
  ];

  if (variants.length) lines.push(`<!-- 变体：${variants.join(' / ')} -->`);
  if (sizes.length) lines.push(`<!-- 尺寸：${sizes.join(' / ')} -->`);
  return lines.join('\n');
}
