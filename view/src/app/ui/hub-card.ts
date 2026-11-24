import { Component, computed, input, output, signal } from '@angular/core';
import { BadgeComponent } from './badge';
import { CardOriginComponent } from './card-origin';
import { CardBodyComponent } from './card-body';
import { CardKebabComponent } from './card-kebab';
import { CardMenuComponent } from './card-menu';
import { CardMarkComponent } from './card-mark';
import { CoverPlateComponent } from './cover-plate';
import { fmtInt } from '../core/types';
import type { WorkflowItem } from '../core/types';

/** 来源色调：与发现页徽章同一套语义色（blue / green / orange / gray） */
type SourceTone = 'blue' | 'green' | 'orange' | 'gray';

interface SourceInfo {
  /** 标识块里的短码（32×32 里只放得下两三个字） */
  code: string;
  /** 来源全名：浮层说明用 */
  name: string;
  /** 原站链接上的短名 */
  short: string;
  tone: SourceTone;
}

/**
 * 工作流来源表 —— 与发现页的 SOURCE_LABELS / SOURCE_TONES 同一口径。
 *
 * 为什么不在卡里直接 import 页面级那两张表：ui/ 是被 pages/ 用的那一层，
 * 反过来依赖会成环。这里只列工作流这几个源；模型源不在这张卡上出现。
 */
const SOURCES: Record<string, SourceInfo> = {
  templates: { code: '模板', name: 'ComfyUI 官方模板', short: '模板', tone: 'green' },
  comfyhub: { code: 'CH', name: 'ComfyHub', short: 'ComfyHub', tone: 'blue' },
  huggingface: { code: 'HF', name: 'Hugging Face', short: 'HF', tone: 'blue' },
  modelscope: { code: 'MS', name: 'ModelScope', short: 'MS', tone: 'green' },
  civitai: { code: 'CI', name: 'Civitai', short: 'Civitai', tone: 'orange' },
  github: { code: 'GH', name: 'GitHub', short: 'GitHub', tone: 'gray' },
};

/**
 * 发现页的工作流卡：资产卡统一骨架的工作流版（发现侧）。
 *
 * 外壳与几何全部来自 `asset-card.css`（产品侧唯一一份），本组件只填槽位：
 *   ① 封面   铺满整卡的铭牌（有缩略图就铺图，没有就家族色 + 几何纹样兜底）
 *   ② 身份行 32×32 来源徽章 + 工作流名 / 作者
 *   ③ 原站   右上角一条来源链接
 *   ④ 状态槽 左下载量 · 一根白线 · 右文件数
 *   ⑤ 标签   恰好一枚（自定义分组）
 *   ⑥ 动作行 ⋯ 在左，主按钮在右
 *
 * 与「我的工作流」那张卡（workflow-card）的分工：
 * 那张卡说的是**本地状态**（缺不缺依赖、能不能载入画布），这张卡说的是**来源信息**
 * （谁发的、多少人下过、仓库里几个文件）。依赖清单这种长文本收进 ⋯ 菜单，
 * 列表视图仍然原样留着全部信息。
 *
 * 为什么依赖清单不放标签位：依赖回答的是「这条工作流要什么」，
 * 标签位回答的是「它属于哪一类」，两件事；标签位只有一枚，装不下清单。
 */
@Component({
  selector: 'md-hub-card',
  imports: [
    BadgeComponent,
    CardBodyComponent,
    CardKebabComponent,
    CardOriginComponent,
    CardMarkComponent,
    CardMenuComponent,
    CoverPlateComponent,
  ],
  template: `
    <!-- 卡不是行：类名只留 .hub + 共享骨架的 .acard。
         旧列表行用的 .wf-row 类名不带到卡上 —— 「行」「卡」在代码里要分得开，
         列表视图那一行仍然是 .wf-row。 -->
    <article class="hub acard" [class.on-shot]="photoOk()">
      <!-- ① 封面：铺满整卡。几何（定位 / 裁切 / 圆角）由 .acard-media + .acard-plate 给，
           家族色底 / 几何纹样 / 铺满图 / 蒙版都在共享铭牌里。
           ratio="fill"：不声明比例，宽高跟着卡片走 —— 封面就是铺满整卡。 -->
      <div class="acard-media">
        <div class="acard-plate">
          <app-cover-plate
            class="hub-plate"
            ratio="fill"
            [model]="plate()"
            (shotState)="photoOk.set($event)"
          />
        </div>
      </div>

      <!-- ② 身份行：来源徽章 + 工作流名 / 作者。③ 原站链接在右上角。 -->
      <div class="acard-head">
        <ui-card-mark [code]="source().code" [tone]="source().tone" [title]="source().name" />

        <span class="acard-ident">
          <b class="wf-title" [title]="item().name">{{ item().name }}</b>
          <span [title]="authorText()">{{ authorText() }}</span>
        </span>


        <ui-card-kebab [expanded]="menuOpen()" (toggled)="toggleMenu($event)" />

        @if (menuOpen()) {
          <ui-card-menu>
            @for (r of requires(); track r) {
              <div class="hub-row">
                <span class="hub-k">依赖</span>
                <span class="hub-v" [title]="r">{{ r }}</span>
              </div>
            }
            @if (!requires().length) {
              <div class="hub-row">
                <span class="hub-k">依赖</span>
                <span class="hub-v">无</span>
              </div>
            }
            <div class="hub-row">
              <span class="hub-k">文件</span>
              <span class="hub-v" [title]="filesTitle()">{{ filePreview() }}</span>
            </div>
            @if (item().url) {
              <a
                class="acard-menu-item"
                role="menuitem"
                [href]="item().url"
                target="_blank"
                rel="noreferrer"
              >
                在 {{ source().short }} 打开 ↗
              </a>
            }
          </ui-card-menu>
        }
      </div>

      <!-- 底部信息区：压在封面上的遮罩（几何由 .acard-body 给） -->
      <ui-card-body>
        <!-- 类别行：一句说明。描述常常是空的，退到更新时间；
             行高固定 —— 不是每张卡都有这句，整墙卡片的节奏不能因此参差。 -->
        <p class="acard-meta" [title]="metaText()">{{ metaText() }}</p>

        <!-- ④ 状态槽：左下载量 · 一根白线 · 右文件数。
             下载量是发现页唯一能证明「有人跑通过」的硬信号，排序也按它排。 -->
        <div class="acard-slot">
          <span [title]="'下载量：' + (item().downloads || 0)"
            >↓ {{ fmtInt(item().downloads) }}</span
          >
          <span class="acard-rule"></span>
          <span class="acard-size">{{ item().file_count || 0 }} 个文件</span>
        </div>

        <!-- ⑤ 分类标签：恰好一枚 —— 自定义分组。
             依赖（底模 / 节点）不是分类，收进 ⋯ 菜单，不占这一格。 -->
        <div class="acard-tags">
          <ui-badge size="sm" [attr.title]="tagTitle()">{{ tagText() }}</ui-badge>
        </div>

        <!-- ⑥ 动作行：主按钮在右；⋯ 已移到右上角 -->
        <div class="acard-foot">
          <ui-card-origin [href]="item().url" [label]="source().name" />

          <button
            class="acard-primary primary btn-xs"
            type="button"
            (click)="download.emit(item())"
            [disabled]="busy()"
            title="下载到工作流库，所有 ComfyUI 实例共用"
            [attr.data-testid]="'wf-download-' + item().source"
          >
            {{ busy() ? '正在创建…' : '下载到工作流库' }}
          </button>
        </div>
      </ui-card-body>
    </article>
  `,
  styleUrls: ['./asset-card.css'],
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        /* 跟着栅格行走：同一行的卡必须等高，否则整墙参差。 */
        height: 100%;
      }
      .hub {
        height: 100%;
      }

      /* 铭牌自带的顶行（厂牌标 / 家族码 / 规格 / 原站）在本卡里是重复的：
         身份行已经在左上角给出徽章与工作流名，原站链接也在卡角，
         所以整行收掉，只借铭牌的底、纹样、图与蒙版。

         选择器要带 .hub-plate 才压得住：铭牌自己的 .head 规则在它自己的作用域里
         （.head[_ngcontent-xxx]，特异性 0,2,0），而 :host ::ng-deep .head 只有 0,2,0，
         平手时谁赢看样式注入顺序。多带一层类提到 0,3,0 才稳定压住。 */
      :host ::ng-deep .hub-plate .head {
        display: none;
      }

      /* ② 标识块：几何（32×32 / 圆角 / 居中）在共享文件里；
         这里只给**底衬** —— 短码是文字，压在家族色底纹上要有实底才读得出来。
         色调沿用发现页徽章那一套（accent / mint / ink-accent / muted），来源一眼能分。 */
      /* 有照片时底衬换成半透明深色、文字翻白 —— 共享骨架已接管。 */

      /* ---- ⋯ 菜单：依赖清单 / 文件预览 / 打开原站 ------------------------
         外壳几何（贴边、浮起、描边、圆角）在共享文件里，
         这里只补这张卡特有的：条目用「标签 + 值」两栏，
         值可能很长（文件路径），所以允许折行并封顶高度，免得菜单比卡还高被裁掉。 */
      .hub-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 3px 6px;
        font-size: 10.5px;
        line-height: 1.5;
      }
      .hub-k {
        flex: none;
        color: var(--ui-muted);
      }
      .hub-v {
        min-width: 0;
        color: var(--ui-text);
        font-family: var(--ui-font-mono);
        overflow-wrap: anywhere;
      }

    `,
  ],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class HubCardComponent {
  readonly item = input.required<WorkflowItem>();
  /** 这条工作流正在建下载任务：主按钮置灰并换成「正在创建…」 */
  readonly busy = input(false);

  /** 下载请求：把条目本身抛出去，页面不用回头找是哪一张卡 */
  readonly download = output<WorkflowItem>();

  /** 封面图是否真的画出来了（远程图会 401 / 超时）。决定正文用白字还是深色字 */
  readonly photoOk = signal(false);

  /** ⋯ 菜单是否展开 */
  readonly menuOpen = signal(false);
  /** 来源信息：认不出来的源退到短码 + 灰调，不猜它是谁 */
  readonly source = computed<SourceInfo>(() => {
    const key = this.item().source || '';
    return (
      SOURCES[key] || {
        code: key.slice(0, 2).toUpperCase() || '—',
        name: key || '未知来源',
        short: key || '来源',
        tone: 'gray',
      }
    );
  });

  /** 身份行下行：作者；没有作者就写来源名 —— 总比空着强 */
  readonly authorText = computed(() => this.item().author || this.source().name);

  /** 类别行：描述 → 更新时间 → 空 */
  readonly metaText = computed(() => {
    const desc = (this.item().description || '').trim();
    if (desc) return desc;
    const updated = (this.item().updated_at || '').trim();
    return updated ? '更新于 ' + updated : '';
  });

  /** 分类标签：恰好一枚 —— 第一个自定义分组，没有就写「未分组」 */
  readonly tagText = computed(() => {
    const first = (this.item().tags || []).find((t) => !!t?.trim());
    return first ? first.trim() : '未分组';
  });

  readonly tagTitle = computed(() => {
    const first = (this.item().tags || []).find((t) => !!t?.trim());
    return first ? '分组：' + first.trim() : '未分组';
  });

  /** 依赖（底模 / 节点）：不是分类，只在菜单里露脸 */
  readonly requires = computed(() => this.item().requires || []);

  /** 文件预览：跟列表视图同一口径（前两个 + 总数） */
  readonly filePreview = computed(() => {
    const files = this.item().files || [];
    const shown = files.slice(0, 2).join(' · ');
    const count = this.item().file_count || files.length;
    return count > 2 ? `${shown} … 共 ${count} 个` : shown || '—';
  });

  readonly filesTitle = computed(() => (this.item().files || []).join('\n'));

  /**
   * 交给铭牌的最小字段集。
   *
   * 名字定家族色与构图纹样；有缩略图就铺满整卡，没有就退回家族色 + 几何纹样。
   */
  readonly plate = computed(() => {
    const name = this.item().name || '';
    const tags = this.item().tags || [];
    const image = this.item().thumbnail || undefined;
    return { name, tags, image };
  });

  /** ⋯ 菜单开关。点外面 / Esc 收起。 */
  toggleMenu(event: MouseEvent): void {
    // 别让「点外面收菜单」的监听器跟着这次点击一起跑
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const el = event.target as HTMLElement | null;
    if (!el?.closest('.acard-menu') && !el?.closest('.acard-kebab')) this.menuOpen.set(false);
  }

  onEscape(): void {
    this.menuOpen.set(false);
  }

  readonly fmtInt = fmtInt;
}
