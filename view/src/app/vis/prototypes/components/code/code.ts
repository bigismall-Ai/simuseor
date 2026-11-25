import { Component, signal } from '@angular/core';
import { CodeComponent } from '../../../../ui/code';
import { KbdComponent } from '../../../../ui/kbd';
import { RulesComponent } from '../../../../ui/rules';
import { SearchComponent } from '../../../../ui/search';
import type { SearchItem } from '../../../../ui/search';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { TextComponent } from '../../../../ui/text';
import { VisualPageComponent } from '../../../visual-page';

const INSTALL = `pip install simuseor
simuseor serve --port 8080 --workspace ./workspace`;

const LONG = `# 资源管理器：按家族与量化方式列目录
find workspace/models -name '*.safetensors' -printf '%f\\t%s\\n' \\
  | sort -k2 -n \\
  | awk '{ printf "%-48s %6.1f GB\\n", $1, $2 / 1073741824 }'

# 只保留最近 7 天更新过的模型，其余归档
find workspace/models -name '*.safetensors' -mtime +7 -exec mv {} archive/ \\;

# 清点每个家族的权重总量，输出最大的前五个
du -sh workspace/models/* | sort -hr | head -n 5

# 校验权重文件哈希（下载后手工抽查）
sha256sum workspace/models/diffusion_models/FLUX.1-dev/*.safetensors`;

const ITEMS: SearchItem[] = [
  { label: '模型库', hint: '页面 · 本地资产', route: '/vis/prototypes/pages/models' },
  { label: '资源管理器', hint: '页面 · 目录与安装', route: '/vis/prototypes/pages/resource-manager' },
  { label: '资产卡片', hint: '组件 · 卡片外壳', route: '/vis/prototypes/components/cards' },
  { label: '代码块', hint: '组件 · 标题栏与复制', route: '/vis/prototypes/components/code' },
  { label: '设计约束台账', hint: '文档 · 外部参考映射' },
];

/**
 * 原型组件：代码与搜索。
 *
 * 两个「文档面」组件：代码面板深浅色都保持深色底；搜索只做触发条与浮层，
 * 结果数据与跳转都由页面决定。
 */
@Component({
  selector: 'app-proto-code',
  imports: [
    CodeComponent,
    KbdComponent,
    RulesComponent,
    SearchComponent,
    SectionBlockComponent,
    TextComponent,
    VisualPageComponent,
  ],
  styleUrl: './code.scss',
  template: `
    <app-visual-page
      title="代码与搜索"
      hint="代码面板在两种主题下都是深色底；搜索只做表现层，命中项交给页面处理。"
    >
      <ui-section title="代码块" pill="ui-code" [plain]="true">
        <div class="col">
          <ui-code title="快速开始" lang="bash" [code]="install" />

          <ui-code title="列出本地模型" lang="bash" [code]="long" [maxHeight]="'220px'" />

          <ui-code
            title="只读片段"
            lang="json"
            [code]="readonly"
            [copyable]="false"
          />

          <ui-code [code]="bare" [copyable]="false" />
        </div>
        <ui-text variant="hint">
          标题栏只在有标题 / 语言 / 复制按钮时出现；正文最高 400px，超出后纵向滚动，
          长行横向滚动。复制按钮 1.5 秒后回到「复制」，窄窗只留图标。
        </ui-text>
      </ui-section>

      <ui-section title="快捷键" pill="ui-kbd" [plain]="true">
        <div class="keys">
          <span class="combo"><ui-kbd [keys]="['Ctrl', 'K']" /> <span>打开搜索</span></span>
          <span class="combo"><ui-kbd [keys]="['Ctrl', 'Shift', 'P']" /> <span>命令面板</span></span>
          <span class="combo"><ui-kbd [keys]="['⌘', 'C']" /> <span>复制</span></span>
          <span class="combo"><ui-kbd>Esc</ui-kbd> <span>关闭浮层</span></span>
          <span class="combo"><ui-kbd [keys]="['↑', '↓']" /> <span>移动高亮</span></span>
        </div>
        <ui-text variant="hint">
          11px 等宽、6px 圆角、底部内阴影；多键用 <code>keys</code> 输入，
          单键也可以直接投影内容。深色面板内用局部 <code>--kbd-*</code> 覆盖。
        </ui-text>
      </ui-section>

      <ui-section title="搜索" pill="ui-search" [plain]="true">
        <div class="search-demo">
          <ui-search
            [items]="items"
            [(open)]="searchOpen"
            [shortcut]="['Ctrl', 'K']"
            (picked)="picked($event)"
          />
        </div>
        @if (selection()) {
          <ui-text variant="hint" role="status">已选择：{{ selection() }}</ui-text>
        }
        <ui-text variant="hint">
          触发条 32px：图标 + 占位文字 + 快捷键胶囊，≤768 只留图标；浮层上限 640px，
          命中行 52px。Esc 关闭并把焦点还给触发条，↑ / ↓ 移动，Enter 选中。
          组件不发路由，只抛 <code>picked</code>。
        </ui-text>
      </ui-section>

      <ui-section title="分工" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>ui-code</b>：深色面板、标题栏、复制；只读长文本，不做语法高亮。</li>
          <li><b>ui-kbd</b>：快捷键提示，只在操作旁边出现，不单独成段文字。</li>
          <li><b>ui-search</b>：表现层触发条 + 结果浮层；数据、路由、空态文案由页面给。</li>
          <li><b>浅色 / 深色</b>：代码面两套主题一致；搜索表面随主题换 token，不改几何。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class ProtoCodeComponent {
  readonly install = INSTALL;
  readonly long = LONG;
  readonly bare = 'console.log("hello");';
  readonly readonly = '{\n  "source": "huggingface",\n  "revision": "main"\n}';

  readonly items = ITEMS;
  readonly searchOpen = signal(false);
  readonly selection = signal('');

  picked(item: SearchItem): void {
    this.selection.set(item.hint ? `${item.label} · ${item.hint}` : item.label);
  }
}
