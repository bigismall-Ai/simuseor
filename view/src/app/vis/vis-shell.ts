import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { ThemeService } from '../core/theme.service';
import { UiIconModule } from '../ui/material';
import { NavTreeComponent } from '../ui/nav-tree';
import type { NavRowItem } from '../ui/nav-tree';
import { PageCrumbComponent } from './page-crumb';
import { NAV_TREE, flattenNav, navPathFor } from './vis-nav';

@Component({
  selector: 'app-vis-shell',
  imports: [NavTreeComponent, RouterOutlet, UiIconModule, PageCrumbComponent],
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

  readonly crumb = computed(() => {
    const url = this.currentUrl().split('?')[0];
    if (url.startsWith('/vis/overview')) return 'VIS / 总览';

    const trail = navPathFor(NAV_TREE, url);
    const labels = trail
      .filter((node) => !node.subheader)
      .map((node) => node.label);
    return labels.length ? `VIS / ${labels.join(' / ')}` : `VIS / ${this.pageName()}`;
  });

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
    localStorage.setItem(this.navKey, this.collapsed() ? 'collapsed' : 'expanded');
  }

  toggleGroup(key: string): void {
    this.closedGroups.set(this.toggleInSet(this.closedGroups(), key));
    localStorage.setItem(this.collapsedKeys, JSON.stringify([...this.closedGroups()]));
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
