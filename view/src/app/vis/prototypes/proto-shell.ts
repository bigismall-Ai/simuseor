import { Component, input } from '@angular/core';

/**
 * 页面原型容器。
 *
 * 左侧保留产品导航，样式与真实站点一致（只做视觉，不接路由）；
 * 顶部不再做产品顶栏，页面自己的标题与操作直接在内容里表达。
 */
@Component({
  selector: 'app-proto-shell',
  standalone: true,
  templateUrl: './proto-shell.html',
  styleUrl: './proto-shell.scss',
})
export class ProtoShellComponent {
  readonly active = input('resources');
  readonly title = input.required<string>();
  readonly hint = input('');
}
