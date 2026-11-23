import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { ThemeService } from '../core/theme.service';
import { UiIconModule } from '../ui/material';
import { PageCrumbComponent } from './page-crumb';
import { NAV_SECTIONS } from './vis-nav';

@Component({
  selector: 'app-vis-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, UiIconModule, PageCrumbComponent],
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

  readonly navSections = NAV_SECTIONS;

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

    for (const section of this.navSections) {
      for (const group of section.groups ?? []) {
        const link = group.links.find((item) => url.startsWith(item.route));
        if (link) return `VIS / ${section.label} / ${group.label} / ${link.label}`;
      }
      const link = (section.links ?? []).find((item) => url.startsWith(item.route));
      if (link) return `VIS / ${section.label} / ${link.label}`;
    }

    return `VIS / ${this.pageName()}`;
  });

  private snapshotState(): { title: string; framed: boolean; bare: boolean } {
    let route = this.route.snapshot;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return {
      title: route.title ?? 'VIS',
      framed: route.data['framed'] === true,
      bare: route.data['bare'] === true,
    };
  }

  private readonly navKey = 'simuseor-vis-nav';
  private readonly sectionsKey = 'simuseor-vis-nav-sections';
  private readonly groupsKey = 'simuseor-vis-nav-groups';

  readonly collapsed = signal(localStorage.getItem(this.navKey) === 'collapsed');
  readonly closedSections = signal<Set<string>>(this.loadSet(this.sectionsKey));
  readonly closedGroups = signal<Set<string>>(this.loadSet(this.groupsKey));

  toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
    localStorage.setItem(this.navKey, this.collapsed() ? 'collapsed' : 'expanded');
  }

  isSectionOpen(key: string): boolean {
    return this.collapsed() || !this.closedSections().has(key);
  }

  isGroupOpen(sectionKey: string, groupKey: string): boolean {
    return this.collapsed() || !this.closedGroups().has(`${sectionKey}.${groupKey}`);
  }

  toggleSection(key: string): void {
    this.closedSections.set(this.toggleInSet(this.closedSections(), key));
    localStorage.setItem(this.sectionsKey, JSON.stringify([...this.closedSections()]));
  }

  toggleGroup(sectionKey: string, groupKey: string): void {
    this.closedGroups.set(this.toggleInSet(this.closedGroups(), `${sectionKey}.${groupKey}`));
    localStorage.setItem(this.groupsKey, JSON.stringify([...this.closedGroups()]));
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

  /** 打开当前路由所在的一级 / 二级分组，避免直接访问时导航项被折叠隐藏。 */
  private revealActive(): void {
    const url = this.router.url.split('?')[0];
    const sections = new Set(this.closedSections());
    const groups = new Set(this.closedGroups());

    for (const section of this.navSections) {
      const inSection =
        (section.links ?? []).some((link) => url.startsWith(link.route)) ||
        (section.groups ?? []).some((group) => group.links.some((link) => url.startsWith(link.route)));
      if (inSection) sections.delete(section.key);

      for (const group of section.groups ?? []) {
        if (group.links.some((link) => url.startsWith(link.route))) {
          groups.delete(`${section.key}.${group.key}`);
        }
      }
    }

    this.closedSections.set(sections);
    this.closedGroups.set(groups);
  }
}
