import { Component, signal } from '@angular/core';
import type { TocItem } from '../../../../ui/toc';
import { TocComponent } from '../../../../ui/toc';
import { LabelComponent } from '../../../../ui/label';
import { TextComponent } from '../../../../ui/text';
import { RulesComponent } from '../../../../ui/rules';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { InnerCardComponent } from '../../../../ui/inner-card';
import { UiButtonComponent } from '../../../../ui/button';
import { VisualPageComponent } from '../../../visual-page';

const ARTICLE_ID = 'toc-article';

/**
 * 原型组件：页内目录。
 *
 * 全文目录 + 窄窗速览条 + 外部锁定三块样张；文章区自带滚动，
 * 用来验证「监听嵌套容器」这条路径，而不是只依赖整页滚动。
 */
@Component({
  selector: 'app-proto-toc',
  imports: [
    InnerCardComponent,
    LabelComponent,
    RulesComponent,
    SectionBlockComponent,
    TextComponent,
    TocComponent,
    UiButtonComponent,
    VisualPageComponent,
  ],
  styleUrl: './toc.scss',
  template: `
    <app-visual-page title="页内目录">
      <ui-section title="全文目录 · 长文章" pill="Full">
        <div class="split">
          <ui-inner-card class="article-shell">
            <article class="article ui-scrollbar" [id]="articleId" tabindex="0" aria-label="样张文章">
              @for (section of article; track section.id) {
                <ui-label [id]="section.id">{{ section.text }}</ui-label>
                <ui-text>{{ section.body }}</ui-text>
              }
            </article>
          </ui-inner-card>

          <ui-toc [items]="items" [root]="'#' + articleId" label="样张文章目录" />
        </div>
        <ui-text variant="hint">
          文章区自带滚动：目录监听的是这个容器，不是整页；点击条目只滚文章区。
        </ui-text>
      </ui-section>

      <ui-section title="速览条 · 768–1024" pill="Mini">
        <div class="split">
          <ui-inner-card class="excerpt-shell">
            <div class="excerpt">
              <ui-text>
                窄窗没有右栏的位置：1024 以下把全文目录收成一条 3px 宽的速览条，
                吸在视口 20% 处。条宽只表达层级——一级 24px、二级 16px、三级 8px，
                选中项换成强调色，其余保持中性。
              </ui-text>
              <ui-text>
                速览条不显示文字：每条链接有可访问名（标题原文 + title），
                悬停能看到全称，点击仍然跳到对应标题。768 以下连速览条也收起，
                让正文独占宽度。
              </ui-text>
            </div>
          </ui-inner-card>

          <div class="mini-slot">
            <ui-toc
              [items]="items"
              [root]="'#' + articleId"
              variant="mini"
              [preview]="true"
              label="速览条样张"
            />
          </div>
        </div>
        <ui-text variant="hint">
          样张用 preview 输入强制显示速览条，否则它在 1440 宽的设计页里按断点隐藏。
        </ui-text>
      </ui-section>

      <ui-section title="外部选中项" pill="activeHash">
        <div class="split">
          <ui-inner-card class="excerpt-shell">
            <div class="excerpt">
              <ui-text>
                传 <code>activeHash</code> 时以外部值为准：适合「从别处跳进来」或
                引导式阅读——按钮把目录钉在某一节，滚动不改变选中项。
              </ui-text>
              <div class="pins">
                <ui-button variant="secondary" size="sm" type="button" (click)="pin('toc-memory')">
                  钉在「显存」
                </ui-button>
                <ui-button variant="secondary" size="sm" type="button" (click)="pin('toc-throttle')">
                  钉在「节流」
                </ui-button>
                <ui-button variant="ghost" size="sm" type="button" (click)="pin('')">
                  交还滚动监听
                </ui-button>
              </div>
              <ui-text>当前外部值：<code>{{ pinned() || '（空，跟随滚动）' }}</code></ui-text>
            </div>
          </ui-inner-card>

          <ui-toc
            [items]="items"
            [activeHash]="pinned()"
            [root]="'#' + articleId"
            label="外部锁定目录"
          />
        </div>
      </ui-section>

      <ui-section title="约束" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>宽度</b>：右栏 <code>--layout-toc</code> 242px；窄窗不压缩正文去硬塞目录。</li>
          <li><b>缩进</b>：一级 12 / 二级 24 / 三级 36，走 <code>--layout-toc-indent-*</code>；链接 500 字重、12.5px。</li>
          <li><b>选中</b>：左侧 1px 描边，平时透明，选中换 <code>--ui-accent</code>；文字同步加重，不铺底色块。</li>
          <li><b>滚动监听</b>：顶部 200 内认第一节，阅读线在容器顶部往下 clientHeight / 8，距底 50 认最后一节；约 166ms 节流，点击后锁 1s。</li>
          <li><b>减少动效</b>：<code>prefers-reduced-motion</code> 下用立即跳转，不写平滑滚动。</li>
          <li><b>接入</b>：组件独立于 VIS 外壳；页面给标题 id 与 <code>TocItem[]</code>，目录不扫描标题、不改版式。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class ProtoTocComponent {
  readonly articleId = ARTICLE_ID;
  readonly pinned = signal('');
  readonly article = ARTICLE_SECTIONS;

  readonly items: TocItem[] = [
    {
      text: '概览',
      hash: 'toc-overview',
      children: [
        { text: '适合谁', hash: 'toc-audience' },
        { text: '前置条件', hash: 'toc-prereq' },
      ],
    },
    {
      text: '规格',
      hash: 'toc-spec',
      children: [
        { text: '显存', hash: 'toc-memory' },
        { text: '磁盘', hash: 'toc-disk' },
        { text: '网络', hash: 'toc-net' },
      ],
    },
    {
      text: '行为',
      hash: 'toc-behavior',
      children: [
        { text: '节流', hash: 'toc-throttle' },
        {
          text: '点击锁定',
          hash: 'toc-lock',
          children: [{ text: '减少动效', hash: 'toc-reduce' }],
        },
      ],
    },
    { text: '验收', hash: 'toc-check' },
  ];

  pin(hash: string): void {
    this.pinned.set(hash);
  }
}

const ARTICLE_SECTIONS = [
  {
    id: 'toc-overview',
    text: '概览',
    body: '这一节回答「目录服务谁」。下载管理器里的长文档——安装说明、模型卡片规格、源站差异——按章节拆开，读者可以直接跳到关心的那一段，不用先滚到底。目录不承载操作，也不做第二套导航；它只映射正文里已经存在的标题，标题 id 由页面写。',
  },
  {
    id: 'toc-audience',
    text: '适合谁',
    body: '第一次在本机安装模型的读者，和已经有一堆实例、只想确认某个参数含义的读者。两类人读同一篇文章，但需要的起点不同，所以目录要允许三级层级，而不是一条平铺列表。',
  },
  {
    id: 'toc-prereq',
    text: '前置条件',
    body: '文章里的标题必须真实存在且稳定：改文案可以，改 id 会让旧链接失效。目录条目的 hash 指向标题 id，不用行号，也不用「第几节」这种会随排序漂移的键。',
  },
  {
    id: 'toc-spec',
    text: '规格',
    body: '右栏固定 242px，和正文之间不画分隔线；目录自己吸顶、自己滚动，长文档里它不会把页面高度再撑长一截。',
  },
  {
    id: 'toc-memory',
    text: '显存',
    body: '推荐组合、最低显存、分层加载三件事分三段写，读者要对照自己的显卡时，直接跳到「显存」下的对应小节，而不是从头再读一遍安装步骤。',
  },
  {
    id: 'toc-disk',
    text: '磁盘',
    body: '单文件大小、缓存目录、可清理项各一段；同一篇里既有结论也有清理入口，所以目录层级比条目数量更重要。',
  },
  {
    id: 'toc-net',
    text: '网络',
    body: '直连、镜像、离线包三种通路各一段。源站状态会变，文章结构不变，目录也不跟着变——它只认标题，不认状态。',
  },
  {
    id: 'toc-behavior',
    text: '行为',
    body: '滚动时当前项自动跟随：标题进入阅读线就选中，滚到底部时直接选最后一节。点击条目会短暂锁住监听，避免平滑滚动的中间位置把选中项来回拨。',
  },
  {
    id: 'toc-throttle',
    text: '节流',
    body: '滚动监听约 166ms 一次，阅读线在顶部 200px 再往下加视口高度的八分之一；距底部 50px 内直接落到最后一节。数字写死在组件里，页面不需要再调。',
  },
  {
    id: 'toc-lock',
    text: '点击锁定',
    body: '点击后锁 1s：平滑滚动期间监听暂停，滚动结束后重新接上。用户开了「减少动效」时改为立即跳转，没有中间过程，因此也不会有闪烁。',
  },
  {
    id: 'toc-reduce',
    text: '减少动效',
    body: '尊重 prefers-reduced-motion：不写平滑滚动，也不做过渡。焦点仍然走浏览器默认的可见焦点环，不会被样式抹掉。',
  },
  {
    id: 'toc-check',
    text: '验收',
    body: '浅色与深色都要能读：未选中项用次级文字色，选中项才用强调色；左侧 1px 描边平时透明，选中时换成强调色，不靠底色块表达位置。',
  },
];
