import { Component, computed, input, output, signal } from '@angular/core';
import { BadgeComponent } from './badge';
import { CardActionComponent } from './card-action';
import { CardOriginComponent } from './card-origin';
import { CardMarkComponent } from './card-mark';
import { CardShellComponent } from './card-shell';
import { CoverPlateComponent } from './cover-plate';
import { EMPTY_MODEL_CARD_VIEW, fromLibraryModel, fromSearchItems } from './model-card-view';
import type { ModelCardView } from './model-card-view';
import type { LibraryModel, SearchItem } from '../core/types';

/**
 * 模型卡：资产卡统一骨架的模型版，`mode` 决定数据从哪儿来。
 *
 * 外壳与几何全部来自 `asset-card.css`（产品侧唯一一份），本组件只填槽位：
 *   ① 封面   铺满整卡的铭牌（只贡献底图与蒙版）
 *   ② 身份行 32×32 标识块 + 厂名 / 作者
 *   ③ 原站   动作行左侧一条原站链接
 *   ④ 状态槽 本地库看「在库 / 权重损坏」· 发现页看在下载量与点赞
 *   ⑤ 标签   恰好一枚（文件类型）
 *   ⑥ 动作行 ⋯ 在左，主按钮在右
 *
 * **为什么只有一个组件**：本地库与发现页是同一批资产的两种状态，两套壳会让
 * 「这条已经在库里」和「这条可以下」看起来不像同一件东西。差异只留在两处：
 *   - 数据来源：`mode="library"` 读 `item`（LibraryModel），`mode="discover"` 读 `items`（SearchItem[]）
 *   - 视觉差异：损坏件的警示层、DEMO 标签标红、真实照片（都只属于本地库）
 * 两者都在 `model-card-view.ts` 里被摊平成同一份 `ModelCardView`，模板不再各自算口径。
 */
@Component({
  selector: 'md-model-card',
  imports: [
    BadgeComponent,
    CardActionComponent,
    CardOriginComponent,
    CardMarkComponent,
    CardShellComponent,
    CoverPlateComponent,
  ],
  template: `
    @if (view().title) {
      <ui-card-shell
        class="card mcard"
        [broken]="view().broken"
        [onShot]="view().onShot && shotOk()"
        [title]="view().title"
        titleClass="card-name"
        [menuItems]="view().menu"
        [status]="view().status"
        [statusTitle]="view().statusTitle"
        [statusTone]="view().statusTone"
        [size]="view().size"
        [sizeTitle]="view().sizeTitle"
        (menuPicked)="onMenuPick($event)"
      >
        <!-- ① 封面：铺满整卡。壳的几何在 asset-card.css，这里只放封面自己的内容 -->
        <div cardMedia class="acard-media">
          <app-cover-plate
            class="acard-plate"
            ratio="fill"
            [model]="view().plate"
            (shotState)="shotOk.set($event)"
          />

          @if (view().broken) {
            <div class="broken-inner">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M12 8v5" />
                <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
                <path
                  d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
                />
              </svg>
              <span class="broken-title">{{ view().brokenTitle }}</span>
              <span class="broken-msg">{{ view().brokenMsg }}</span>
            </div>
          }
        </div>

        <!-- ② 身份行：32×32 厂牌位 + 厂名 / 作者两行 -->
        <ui-card-mark
          cardMark
          [logo]="view().mark.logo"
          [logoDark]="view().mark.logoDark"
          [code]="view().mark.code"
          [scale]="view().mark.scale"
          [title]="view().mark.title"
        />

        <b cardIdent [title]="view().identName">{{ view().identName }}</b>
        <span
          cardIdent
          [class.pill-author]="view().identSubIsAuthor"
          [title]="view().identSubTitle"
          >{{ view().identSub }}</span
        >

        <!-- 详情：类别行 -->
        <p cardDetails class="acard-meta" [title]="view().meta">{{ view().meta }}</p>

        <!-- ⑤ 分类标签：恰好一枚 -->
        <ui-badge
          cardTags
          size="sm"
          [class.pill-demo]="view().demo"
          [attr.title]="view().tagTitle"
          >{{ view().tag }}</ui-badge
        >

        <!-- ⑥ 动作行：原站在左，主按钮在右 -->
        <ui-card-origin cardFoot [href]="view().origin.href" [label]="view().origin.label" />
        <ui-card-action
          cardFoot
          [label]="view().action.label"
          [title]="view().action.title"
          [testId]="view().action.testId"
          (pressed)="onPrimary()"
        />
      </ui-card-shell>
    }
  `,
  /* 共享几何走外部样式文件：这份文件的规则会被本组件的作用域改写
     （Emulated 封装），所有卡引用的是同一份源，改一处一起变。 */
  styleUrls: ['./asset-card.css'],
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      /* ---- 封面内容：损坏件的警示块 ---- */
      .broken-inner {
        position: absolute;
        left: 0;
        right: 0;
        /* 警示块整块落在封面区里，不能压到底部信息带下面 ——
           封面铺满整卡之后，信息带的位置随内容高度变，只能靠收紧这一块腾地方。 */
        top: 42px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        color: var(--ui-error);
      }
      .broken-title {
        font-size: 11px;
        font-weight: var(--ui-weight-bold);
        letter-spacing: 0.02em;
        background: color-mix(in srgb, var(--ui-error) 14%, transparent);
        color: var(--ui-error);
        padding: 1px 8px;
        border-radius: var(--ui-radius);
      }
      .broken-msg {
        font-size: 10px;
        font-weight: var(--ui-weight-medium);
        color: var(--ui-muted);
        background: var(--ui-card-solid);
        padding: 1px 7px;
        border-radius: var(--ui-radius);
        border: 1px solid color-mix(in srgb, var(--ui-text) 8%, transparent);
        max-width: 82%;
        text-align: center;
        line-height: 1.35;
      }
      /* DEMO 是离线占位文件，标红才不会被当成真模型。
         选择器必须穿过 ui-card-shell 的封装：badge 由外壳投影，本组件的作用域
         属性只落在宿主与指令上，::ng-deep 才够得着内部那一枚。 */
      :host ::ng-deep .acard-tags ui-badge.pill-demo {
        --badge-gray-bg: color-mix(in srgb, var(--ui-error) 14%, transparent);
        --badge-gray-ink: var(--ui-error);
      }
    `,
  ],
})
export class ModelCardComponent {
  /**
   * library = 本地库条目；discover = 发现页的一组来源。
   *
   * 默认 discover：老调用点只传 `items` 时不至于必须补 mode。
   */
  readonly mode = input<'library' | 'discover'>('discover');

  /** 本地库条目（mode=library） */
  readonly item = input<LibraryModel | null>(null);

  /** 发现页的一组来源（mode=discover），同一模型多来源合卡 */
  readonly items = input<SearchItem[]>([]);

  /** 后端解析出的真实封面；取不到就退回家族色构图 */
  readonly cover = input('');
  /** 本机独显显存（GB）；状态槽的浮层说明要用 */
  readonly vramGb = input(0);

  readonly download = output<void>();
  readonly remove = output<void>();
  readonly use = output<void>();
  readonly redownload = output<void>();
  /** 本地导入条目没有远端仓库：主操作改为打开目录，而不是去发现页瞎搜 */
  readonly open = output<void>();

  /** 照片是否真的画出来了（由共享封面 app-cover-plate 回传） */
  readonly shotOk = signal(false);

  /** 适配器摊平后的统一视图：模板只读这一份，不认识原始类型 */
  readonly view = computed<ModelCardView>(() => {
    if (this.mode() === 'library') {
      const item = this.item();
      return item
        ? fromLibraryModel(item, { vramGb: this.vramGb(), cover: this.cover() })
        : EMPTY_MODEL_CARD_VIEW;
    }
    return this.items().length ? fromSearchItems(this.items(), this.cover()) : EMPTY_MODEL_CARD_VIEW;
  });

  onMenuPick(key: string): void {
    if (key === 'remove') this.remove.emit();
  }

  /** 主按钮按视图里的动作类型派发：同一颗按钮，不同模式下落到不同 output */
  onPrimary(): void {
    const action = this.view().action.kind;
    if (action === 'use') this.use.emit();
    else if (action === 'redownload') this.redownload.emit();
    else if (action === 'open') this.open.emit();
    else if (action === 'download') this.download.emit();
  }
}
