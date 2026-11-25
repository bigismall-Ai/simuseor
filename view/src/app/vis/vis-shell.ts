import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { ThemeService } from '../core/theme.service';
import { BreadcrumbComponent } from '../ui/breadcrumb';
import type { CrumbItem } from '../ui/breadcrumb';
import { UiIconModule } from '../ui/material';
import { NavTreeComponent } from '../ui/nav-tree';
import type { NavRowItem } from '../ui/nav-tree';
import { PageComponent } from '../ui/page';
import { SearchComponent } from '../ui/search';
import type { SearchItem } from '../ui/search';
import { apiRoute, categoryLabel, REGISTRY_ENTRIES } from './registry-data';
import { NAV_TREE, flattenNav, navPathFor } from './vis-nav';
import type { NavNode } from './vis-nav';

/** 精确匹配叶子路由的祖先链：面包屑要的是「这一页」，不是前缀相同的兄弟路由。 */
function trailForUrl(nodes: NavNode[], url: string, trail: NavNode[] = []): NavNode[] {
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.route === url) return next;
    if (node.children?.length) {
      const found = trailForUrl(node.children, url, next);
      if (found.length) return found;
    }
  }
  return [];
}

@Component({
  selector: 'app-vis-shell',
  imports: [
    BreadcrumbComponent,
    NavTreeComponent,
    PageComponent,
    RouterOutlet,
    SearchComponent,
    UiIconModule,
  ],
  templateUrl: './vis-shell.html',
  styleUrl: './vis-shell.scss',
})
export class VisShellComponent {
  readonly theme = inject(ThemeService);

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly pageTitle = signal(this.snapshotState().title);
  readonly framed = signal(this.snapshotState().framed);
  readonly bare = signal(this.snapshotState().bare);
  readonly currentUrl = signal(this.router.url);

  private readonly navKey = 'simuseor-vis-nav';
  private readonly collapsedKeys = 'simuseor-vis-nav-groups-v2';

  readonly collapsed = signal(localStorage.getItem(this.navKey) === 'collapsed');
  readonly closedGroups = signal<Set<string>>(this.loadSet(this.collapsedKeys));
  readonly searchOpen = signal(false);

  readonly rows = computed<NavRowItem[]>(() => {
    const rows: NavRowItem[] = [];
    for (const row of flattenNav(NAV_TREE, this.closedGroups(), this.collapsed())) {
      if (row.node.subheader) {
        rows.push({ key: row.node.key, label: row.node.label, subheader: true, depth: row.depth });
      } else if (row.node.children?.length) {
        rows.push({
          key: row.node.key,
          label: row.node.label,
          group: true,
          open: row.open,
          depth: row.depth,
        });
      } else if (row.node.route) {
        rows.push({
          key: row.node.key,
          label: row.node.label,
          route: row.node.route,
          icon: row.node.icon,
          status: row.node.status,
          depth: row.depth,
        });
      }
    }
    return rows;
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map(() => this.snapshotState()),
        startWith(this.snapshotState()),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.pageTitle.set(state.title);
        this.framed.set(state.framed);
        this.bare.set(state.bare);
        this.currentUrl.set(this.router.url);
        this.revealActive();
      });
  }

  readonly pageName = computed(() => {
    const title = this.pageTitle();
    return title.split('·').pop()?.trim() || title;
  });

  /**
   * 面包屑：由 `NAV_TREE` 的祖先链派生，不再手写字符串。
   *
   * 固定以「设计区」开头；中间层级带路由才可点；当前页永远是最后一项且不带路由，
   * 由 `ui-breadcrumb` 渲染成 `aria-current="page"`。总览页不再重复指向自己。
   */
  readonly crumbs = computed<CrumbItem[]>(() => {
    const url = this.currentUrl().split('?')[0];
    const trail = trailForUrl(NAV_TREE, url).filter((node) => !node.subheader);

    const items: CrumbItem[] = [{ label: '设计区', route: '/vis/overview' }];
    if (trail.length) {
      for (const node of trail) items.push({ label: node.label, route: node.route });
    } else {
      items.push({ label: this.pageName() });
    }

    // 当前页不能是链接（总览页的「设计区」也不指向自己）
    const last = items[items.length - 1];
    items[items.length - 1] = { label: last.label };
    if (items.length === 2 && items[0].route === url) items[0] = { label: items[0].label };

    return items;
  });

  /**
   * 搜索数据：摊平 `NAV_TREE` 的叶子，分组名作为副标题提示。
   * 与侧栏导航同一份数据源，新增页面不会漏进搜索。
   */
  readonly searchItems = computed<SearchItem[]>(() => {
    const items: SearchItem[] = [];
    const walk = (nodes: NavNode[], trail: string[]): void => {
      for (const node of nodes) {
        if (node.children?.length) {
          walk(node.children, [...trail, node.label]);
          continue;
        }
        if (!node.route) continue;
        const hint = trail.join(' · ');
        items.push(
          hint
            ? { label: node.label, hint, route: node.route }
            : { label: node.label, route: node.route },
        );
      }
    };
    walk(NAV_TREE, []);

    // 组件也进搜索：光搜页面名，输入 ui-button / toc 时一条都出不来。
    for (const entry of REGISTRY_ENTRIES) {
      if (entry.deprecated) continue;
      items.push({
        label: entry.name,
        hint: `组件 · ${entry.selector} · ${categoryLabel(entry.category)}`,
        route: apiRoute(entry.selector),
      });
    }

    return items;
  });

  /** framed / bare 都是整幅画布：放开最大宽、去掉 ui-page 留白，内缩由外框自己控制。 */
  readonly fillCanvas = computed(() => this.framed() || this.bare());
  /** 常规页的左右留白由 `--vis-page-gutter` 换档（大屏 / 窄窗），否则退回全局 token。 */
  readonly pageGutter = computed(() =>
    this.fillCanvas() ? '0px' : 'var(--vis-page-gutter, var(--layout-gutter))',
  );

  private snapshotState(): { title: string; framed: boolean; bare: boolean } {
    let route = this.route.snapshot;
    while (route.firstChild) route = route.firstChild;
    return {
      title: route.title ?? 'VIS',
      framed: route.data['framed'] === true,
      bare: route.data['bare'] === true,
    };
  }

  toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
    this.searchOpen.set(false);
    localStorage.setItem(this.navKey, this.collapsed() ? 'collapsed' : 'expanded');
  }

  toggleGroup(key: string): void {
    this.closedGroups.set(this.toggleInSet(this.closedGroups(), key));
    localStorage.setItem(this.collapsedKeys, JSON.stringify([...this.closedGroups()]));
  }

  /** 搜索只抛结果，路由由外壳决定；和侧栏链接共用同一份 `NAV_TREE`。 */
  pick(item: SearchItem): void {
    if (!item.route) return;
    void this.router.navigateByUrl(item.route);
  }

  private toggleInSet(source: Set<string>, key: string): Set<string> {
    const next = new Set(source);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  private loadSet(key: string): Set<string> {
    try {
      const raw = localStorage.getItem(key);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }

  /** 打开当前路由所在的祖先分组，避免直接访问时导航项被折叠隐藏。 */
  private revealActive(): void {
    const url = this.router.url.split('?')[0];
    const open = new Set(this.closedGroups());
    const walk = (nodes: typeof NAV_TREE): void => {
      for (const node of nodes) {
        if (node.children?.length) {
          const hit = navPathFor(node.children, url).length > 0;
          if (hit) open.delete(node.key);
          walk(node.children);
        }
      }
    };
    walk(NAV_TREE);
    this.closedGroups.set(open);
  }
}
