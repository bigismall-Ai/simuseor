import {
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CardBodyComponent } from './card-body';
import { CardKebabComponent } from './card-kebab';
import { CardMenuComponent } from './card-menu';
import type { CardMenuItem } from './card-menu';
import { CardSlotComponent } from './card-slot';

/**
 * 资产卡外壳：五张卡共用的唯一一份骨架。
 *
 * 持有 `article.acard`、封面槽、身份行、信息区、状态槽、标签槽、动作行，
 * 以及 ⋯ 的开合 / 点外收起 / Esc。卡片只填内容，不再各写一遍外壳：
 *
 *   <ui-card-shell [title]="name" [menuItems]="items" statusTone="ok">
 *     <app-cover-plate cardMedia … />
 *     <ui-card-mark cardMark … />
 *     <b cardIdent>厂名</b><span cardIdent>作者</span>
 *     <p cardDetails>类别 / 规格</p>
 *     <span cardStatus>在库</span><span cardSize>6.4 GB</span>
 *     <ui-badge cardTags>safetensors</ui-badge>
 *     <ui-card-origin cardFoot … />
 *     <ui-card-action cardFoot label="打开" />
 *   </ui-card-shell>
 *
 * 卡别差异只留在宿主 class（`.mcard` / `.nd-card` / `.wc` …）与投影内容里。
 */
@Component({
  selector: 'ui-card-shell',
  imports: [CardBodyComponent, CardKebabComponent, CardMenuComponent, CardSlotComponent],
  styleUrls: ['./asset-card.css'],
  template: `
    <article class="acard" [class.on-shot]="onShot()">
      <!-- ① 封面：卡片投影自己的铺图 / 纹样 / 错误层 -->
      <div class="acard-media">
        <ng-content select="[cardMedia]" />
      </div>

      <!-- ② 身份行：32×32 厂牌位 + 两行身份；⋯ 固定右上角 -->
      <div class="acard-head">
        <ng-content select="[cardMark]" />
        <span class="acard-ident">
          <ng-content select="[cardIdent]" />
        </span>
        <ui-card-kebab [expanded]="menuOpen()" (toggled)="toggleMenu($event)" />
        @if (menuOpen()) {
          <ui-card-menu
            [items]="menuItems()"
            (picked)="pick($event)"
            (click)="closeMenu()"
          >
            <ng-content select="[cardMenu]" />
          </ui-card-menu>
        }
      </div>

      <!-- ③-⑥ 信息区：标题 + 详情 / 状态槽 / 标签 / 动作行 -->
      <ui-card-body [title]="title()" [titleClass]="titleClass()">
        <ng-content select="[cardDetails]" />

        <ui-card-slot
          [status]="status()"
          [statusTitle]="statusTitle()"
          [tone]="statusTone()"
          [icon]="statusIcon()"
          [size]="size()"
          [sizeTitle]="sizeTitle()"
        />

        <ng-content select="[cardExtra]" />

        <div class="acard-tags">
          <ng-content select="[cardTags]" />
        </div>

        <div class="acard-foot">
          <ng-content select="[cardFoot]" />
        </div>
      </ui-card-body>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
  `,
})
export class CardShellComponent {
  readonly onShot = input(false);
  readonly title = input('');
  readonly titleClass = input('');
  readonly menuItems = input<CardMenuItem[]>([]);
  readonly status = input('');
  readonly statusTitle = input('');
  readonly statusTone = input<'' | 'ok' | 'warn' | 'err'>('');
  readonly statusIcon = input<'' | 'warn'>('');
  readonly size = input('');
  readonly sizeTitle = input('');

  readonly menuPicked = output<string>();

  private readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  menuOpen(): boolean {
    return this.open();
  }

  toggleMenu(event: MouseEvent): void {
    // 别让「点外面收菜单」的 document 监听器跟着这次点击一起跑
    event.stopPropagation();
    this.open.update((open) => !open);
  }

  closeMenu(): void {
    this.open.set(false);
  }

  pick(key: string): void {
    this.open.set(false);
    this.menuPicked.emit(key);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.open()) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
