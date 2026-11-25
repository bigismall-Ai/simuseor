import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { VisualPageComponent } from './visual-page';
import { RulesComponent } from '../ui/rules';
import type { RegistryEntry } from './registry-data';
import { CATEGORY_ORDER, REGISTRY_ENTRIES, apiRoute, categoryLabel } from './registry-data';

/**
 * 组件注册表：自定义样式的唯一入口。
 *
 * 页面上看到的视觉件都必须在 `src/app/ui/registry.json` 登记；
 * 没登记的组件在构建守卫阶段会被拦下，避免页面又手写一套。
 *
 * 组件名直接链到 `/vis/components/:selector` 的 API 页，注册表就是索引。
 */
@Component({
  selector: 'app-vis-registry',
  imports: [RulesComponent, RouterLink, SectionBlockComponent, TableComponent, VisualPageComponent],
  styleUrl: './vis-registry.scss',
  template: `
    <app-visual-page
      title="组件注册表"
      hint="自定义视觉件先注册再使用；页面只允许用这里的选择器，样式只做布局。"
    >
      <ui-section title="已注册组件" [pill]="total">
        <ui-table>
          <table class="registry">
            <thead>
              <tr>
                <th scope="col">组件</th>
                <th scope="col">选择器</th>
                <th scope="col">变体 / 尺寸</th>
                <th scope="col">Token</th>
                <th scope="col">展示页</th>
              </tr>
            </thead>
            <tbody>
              @for (group of groups; track group.category) {
                <tr class="group-row">
                  <td colspan="5">{{ categoryLabel(group.category) }}</td>
                </tr>
                @for (item of group.items; track item.selector) {
                  <tr>
                    <td>
                      <a class="page-link" [routerLink]="apiRoute(item.selector)">{{ item.name }}</a>
                    </td>
                    <td class="mono">{{ item.selector }}</td>
                    <td class="mono">{{ variantText(item) }}</td>
                    <td class="mono">{{ tokensText(item) }}</td>
                    <td class="mono">
                      @if (item.page) {
                        <a class="page-link" [routerLink]="item.page">{{ item.page }}</a>
                      } @else {
                        —
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </ui-table>
      </ui-section>

      <ui-section title="注册规则" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>先注册</b>：新增视觉件先写进 <code>ui/registry.json</code>，再在页面里使用；未登记会在守卫阶段失败。</li>
          <li><b>组件化</b>：一个选择器对应一个组件，变体走 <code>variant</code> / <code>size</code> 输入，不在页面里重写。</li>
          <li><b>Token</b>：颜色、圆角、间距、字号只走 token；页面样式只允许 grid / flex / 位置。</li>
          <li><b>展示页</b>：登记时同时给展示页；没有展示页的内置结构件标记「—」。</li>
          <li>
            <b>API 页</b>：点组件名进入 <code>/vis/components/:selector</code>，
            变体 / 尺寸 / Token / 用法都从本表读，不另写一份文档。
          </li>
          <li><b>Material 对齐</b>：API 形态参考 Material（appearance / variant / size / density + 内容投影），不自造第二套按钮或卡片。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisRegistryComponent {
  private readonly entries = REGISTRY_ENTRIES;

  readonly groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: this.entries
      .filter((item) => item.category === category)
      .sort((a, b) => a.selector.localeCompare(b.selector)),
  })).filter((group) => group.items.length > 0);

  readonly total = `${this.entries.length} 个`;

  readonly categoryLabel = categoryLabel;
  readonly apiRoute = apiRoute;

  variantText(item: RegistryEntry): string {
    const parts = [...(item.variants ?? []), ...(item.sizes ?? [])];
    return parts.length ? parts.join(' / ') : '—';
  }

  tokensText(item: RegistryEntry): string {
    return item.tokens?.length ? item.tokens.join(', ') : '—';
  }
}
