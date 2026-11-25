import { UiButtonComponent } from '../../../../ui/button';
import { InputComponent } from '../../../../ui/input';
import { NoticeComponent } from '../../../../ui/notice';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { BadgeComponent } from '../../../../ui/badge';
import { FieldComponent } from '../../../../ui/field';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { PanelComponent } from '../../../../ui/panel';
import { UiMaterialModule } from '../../../../ui/material';
import { ProtoShellComponent } from '../../proto-shell';
import { SettingRowComponent } from '../../../../ui/setting-row';

type PathKey = 'direct' | 'mirror' | 'proxy';
type Verdict = 'ok' | 'degraded' | 'down' | 'unknown';
type PathState = 'ok' | 'bad' | 'skip' | 'unknown';
type BadgeTone = 'gray' | 'blue' | 'green' | 'orange' | 'red';

interface PathRead {
  state: PathState;
  ms: number | null;
  mbps: number | null;
  reason?: 'timeout' | 'refused';
  note: string;
}

interface SiteConfig {
  token: string;
  mirror: string;
  fullCatalog: boolean;
}

interface SiteSeed {
  key: string;
  title: string;
  sub: string;
  editable: boolean;
  verdict: Verdict;
  time: string;
  paths: Record<PathKey, PathRead>;
  config: SiteConfig;
}

interface SummaryParts {
  pre: string;
  strong: string;
  post: string;
}

interface PathCellView {
  path: PathKey;
  label: string;
  state: PathState;
  badge: string;
  badgeTone: BadgeTone;
  speed: string;
  lat: string;
  latency: string;
  note: string;
  reason?: 'timeout' | 'refused';
  best: boolean;
  title: string;
}

interface ValueRead {
  label: string;
  value: string;
}

interface SiteCardView {
  key: string;
  title: string;
  sub: string;
  editable: boolean;
  state: Verdict;
  verdict: string;
  verdictTone: BadgeTone;
  speedText: string;
  speedClass: string;
  timeText: string;
  summary: SummaryParts;
  detailSum: string;
  cells: PathCellView[];
  values: ValueRead[];
}

interface Draft {
  token: string;
  mirror: string;
  fullCatalog: boolean;
}

const PATH_ORDER: PathKey[] = ['direct', 'mirror', 'proxy'];
const PATH_LABEL: Record<PathKey, string> = { direct: '直连', mirror: '镜像', proxy: '代理' };
const VERDICT_TEXT: Record<Verdict, string> = {
  ok: '可用',
  degraded: '已降级',
  down: '不可用',
  unknown: '未探测',
};
const VERDICT_TONE: Record<Verdict, BadgeTone> = {
  ok: 'green',
  degraded: 'orange',
  down: 'red',
  unknown: 'gray',
};

/** 设置页原型：左栏 6 张站点卡（探针读数），右栏代理与下载策略。样例数据写死在组件里。 */
@Component({
  selector: 'app-proto-settings',
  imports: [
    SettingRowComponent,
    ProtoShellComponent,
    PageHeaderComponent,
    PanelComponent,
    FieldComponent,
    BadgeComponent,
    UiMaterialModule,
      UiButtonComponent,
    InputComponent,
    NoticeComponent,
  ],
  styleUrl: './settings.scss',
  template: `
    <app-proto-shell active="settings" title="设置" hint="站点、代理与下载策略">
      <div class="page">
        <ui-page-header
          kicker="Settings"
          title="设置"
          hint="左边宽栏是全部站点（6 个）：每个站点一张紧凑卡，卡里带探针结论、三条通路的实测速度与它的凭据、镜像。右边窄栏是全局：本地代理配置与下载策略（按实测速度自动选最快的那条通路；代理要快 20% 以上才选）。"
        />

        <div class="settings-cols-page">
          <!-- ─────────── 左栏：所有站点 ─────────── -->
          <div class="col col-sites">
            <div class="probe-bar">
              <ui-button variant="secondary" type="button" (click)="retest()" [disabled]="probing()">
                {{ probing() ? '测试中…' : '重新测试连通性' }}
              </ui-button>
              <span class="tiny muted">同时实测速度</span>
              <ui-badge [tone]="probed() ? 'blue' : 'gray'">{{ summaryText() }}</ui-badge>
              <span class="bar-note mono">{{ probeTime() }}</span>
            </div>

            <p class="one-liner">下载、列表都会通过<b>探针的结果缓存</b>走最快的那条。</p>

            @for (card of cards(); track card.key) {
              <article [class]="'src-card st-' + card.state" [class.is-testing]="probing()">
                <div class="rail"></div>

                <div class="src-head">
                  <div class="src-id">
                    <h3 class="src-title">{{ card.title }}</h3>
                    <span class="src-key mono">{{ card.key }}</span>
                    <span class="src-sub">{{ card.sub }}</span>
                  </div>
                  <div class="src-head-right">
                    <span [class]="'src-speed ' + card.speedClass">{{ card.speedText }}</span>
                    <span class="src-time mono">{{ card.timeText }}</span>
                    <ui-badge class="src-verdict" [tone]="card.verdictTone">
                      {{ card.verdict }}
                    </ui-badge>
                  </div>
                </div>

                <div class="src-strip">
                  @for (cell of card.cells; track cell.path) {
                    <div
                      [class]="
                        'pcell' +
                        (cell.best ? ' is-best' : '') +
                        (cell.state === 'bad' ? ' is-bad' : '') +
                        (cell.state !== 'ok' ? ' is-skip' : '')
                      "
                      [title]="cell.title"
                    >
                      <span class="pc-top">
                        <b>{{ cell.label }}</b>
                        <ui-badge [tone]="cell.badgeTone">{{ cell.badge }}</ui-badge>
                      </span>
                      <span class="pc-line">
                        <b class="pc-speed">{{ cell.speed }}</b>
                        <span class="pc-lat">{{ cell.lat }}</span>
                      </span>
                    </div>
                  }
                </div>

                <div class="src-foot">
                  <span class="src-sum">
                    {{ card.summary.pre }}<b>{{ card.summary.strong }}</b>{{ card.summary.post }}
                  </span>
                  <div class="src-vals">
                    @for (v of card.values; track v.label) {
                      <span class="sv">{{ v.label }} <b>{{ v.value }}</b></span>
                    }
                  </div>
                  <div class="src-tools">
                    <button
                      type="button"
                      [class]="'toggle-chip ghost detail-btn' + (detailKey() === card.key ? ' is-open' : '')"
                      [attr.aria-expanded]="detailKey() === card.key"
                      (click)="toggleDetail(card.key)"
                    >
                      详情
                    </button>
                    @if (card.editable) {
                      <button
                        type="button"
                        [class]="'toggle-chip edit-btn' + (editKey() === card.key ? ' is-open' : '')"
                        [attr.aria-expanded]="editKey() === card.key"
                        (click)="toggleEdit(card.key)"
                      >
                        编辑
                      </button>
                    }
                  </div>
                </div>

                @if (detailKey() === card.key) {
                  <div class="detail-panel">
                    @for (row of card.cells; track row.path) {
                      <div class="drow">
                        <b>{{ row.label }}</b>
                        <ui-badge [tone]="row.badgeTone">{{ row.badge }}</ui-badge>
                        <span class="mono">{{ row.latency }}</span>
                        <span class="mono">{{ row.speed }}</span>
                        <span class="d-reason">
                          @if (row.reason) {
                            <code>{{ row.reason }}</code>
                          }
                          {{ row.note }}
                        </span>
                      </div>
                    }
                    <p class="d-sum">{{ card.detailSum }}</p>
                  </div>
                }

                @if (editKey() === card.key) {
                  <div class="edit-panel">
                    <div class="edit-grid">
                      <ui-input
                        label="Token"
                        type="password"
                        [placeholder]="tokenPlaceholder(card.key)"
                        [value]="draft().token"
                        (valueChange)="setDraftToken($event)"
                        hint="只对 {{ card.title }} 生效。"
                      />

                      @if (card.key === 'huggingface' || card.key === 'github') {
                        <ui-input
                          [label]="card.key === 'huggingface' ? '镜像站点' : '加速前缀'"
                          [mono]="true"
                          [placeholder]="
                            card.key === 'huggingface'
                              ? 'https://hf-mirror.com'
                              : 'https://gh-proxy.com/'
                          "
                          [value]="draft().mirror"
                          (valueChange)="setDraftMirror($event)"
                          [hint]="mirrorHint(card.key)"
                        />
                      }

                      @if (card.key === 'civitai') {
                        <ui-field label="完整目录（CivitAI Red）">
                          <ui-setting-row>
                            <div settingText>
                              <strong>含成熟内容（18+，部分地区依法受限）</strong>
                              <div class="muted">
                                打开后搜索走 civitai.red 的完整目录（后端按 nsfw=true 取参数）。
                              </div>
                            </div>
                            <input
                              settingControl
                              type="checkbox"
                              [checked]="draft().fullCatalog"
                              (change)="setDraftCatalog($event)"
                            />
                          </ui-setting-row>
                        </ui-field>
                      }
                    </div>

                    <div class="edit-foot">
                      <ui-button variant="primary" size="xs" type="button" (click)="applyEdit(card.key)">
                        保存
                      </ui-button>
                      <ui-button variant="secondary" size="xs" type="button" (click)="cancelEdit()">取消</ui-button>
                      <span class="tiny">{{ editFootNote(card.key) }}</span>
                    </div>
                  </div>
                }
              </article>
            }
          </div>

          <!-- ─────────── 右栏：全局 ─────────── -->
          <div class="col col-side">
            <ui-panel
              kicker="Proxy"
              title="本地代理配置"
              hint="全局一份。探针判定直连不通时，下载链路自动改走这里。"
            >
              <div class="form-grid">
                <ui-input
                  label="IP 或 网址"
                  [mono]="true"
                  [value]="proxyHost()"
                  placeholder="127.0.0.1"
                  (valueChange)="setProxyHost($event)"
                />
                <ui-input
                  label="端口"
                  [mono]="true"
                  type="number"
                  [value]="proxyPort()"
                  placeholder="7890"
                  (valueChange)="setProxyPort($event)"
                />
              </div>

              <div class="toolbar panel-row">
                <ui-button variant="secondary" size="sm" type="button" (click)="testProxy()" [disabled]="proxyTesting()">
                  {{ proxyTesting() ? '测试中…' : '测试代理' }}
                </ui-button>
                <span class="mono muted">{{ proxyUrlText() }}</span>
              </div>

              @if (proxyResult(); as res) {
                <ui-notice
                  [tone]="res.tone === 'err' ? 'error' : 'ok'"
                  [icon]="res.tone === 'err' ? '!' : '✓'"
                >
                  {{ res.text }}
                </ui-notice>
              }
            </ui-panel>

            <div class="strategy-wrap" [class.is-unlocked]="strategyUnlocked()">
              <ui-panel kicker="Download" title="下载策略">
                <div class="strategy-now">
                  <ui-badge [tone]="strategyIsAuto() ? 'blue' : 'orange'">
                    {{ strategyIsAuto() ? '自动' : '手动' }}
                  </ui-badge>
                  <b>{{ strategyText() }}</b>
                </div>

                <div class="toolbar panel-row">
                  <ui-button variant="secondary" size="xs" type="button" (click)="toggleStrategy()">
                    {{ strategyUnlocked() ? '锁定' : '解锁' }}
                  </ui-button>
                  @if (strategyUnlocked()) {
                    <select
                      class="strategy-select"
                      [value]="strategySelectValue()"
                      (change)="onStrategyPick($event)"
                    >
                      <option value="direct">直连（direct）</option>
                      <option value="mirror">镜像（mirror）</option>
                      <option value="proxy">代理（proxy）</option>
                    </select>
                    <ui-button variant="secondary" size="xs" type="button" (click)="resetStrategy()">恢复自动</ui-button>
                  }
                </div>
              </ui-panel>
            </div>
          </div>
        </div>

        <div class="save-bar">
          <ui-button variant="primary" type="button" (click)="save()">保存设置</ui-button>
          @if (saveNote()) {
            <ui-notice tone="ok" icon="✓">{{ saveNote() }}</ui-notice>
          } @else {
            <span class="muted save-hint">改动不会自动保存，确认后再点一次。</span>
          }
          <ui-badge tone="gray" class="save-note">原型 · 样例数据，未接后端</ui-badge>
        </div>
      </div>
    </app-proto-shell>
  `,
})
export class ProtoSettingsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private noteTimer?: ReturnType<typeof setTimeout>;

  readonly sites = signal<SiteSeed[]>([
    {
      key: 'huggingface',
      title: 'Hugging Face',
      sub: '模型搜索 API · 权重下载',
      editable: true,
      verdict: 'ok',
      time: '3 分钟前',
      config: { token: '', mirror: 'https://hf-mirror.com', fullCatalog: false },
      paths: {
        direct: { state: 'ok', ms: 412, mbps: 8.4, note: '最快的一条通路' },
        mirror: { state: 'ok', ms: 890, mbps: 1.2, note: 'hf-mirror · 地址已填，未启用' },
        proxy: { state: 'ok', ms: 1300, mbps: 0.6, note: '127.0.0.1:7890' },
      },
    },
    {
      key: 'modelscope',
      title: 'ModelScope',
      sub: '魔搭模型库',
      editable: true,
      verdict: 'ok',
      time: '3 分钟前',
      config: { token: '', mirror: '', fullCatalog: false },
      paths: {
        direct: { state: 'ok', ms: 96, mbps: 12.6, note: '最快的一条通路' },
        mirror: { state: 'skip', ms: null, mbps: null, note: '该站没有镜像入口，不测这一条' },
        proxy: { state: 'skip', ms: null, mbps: null, note: '该站未允许经代理，不测这一条' },
      },
    },
    {
      key: 'civitai',
      title: 'Civitai',
      sub: '社区模型 · 版本与元数据',
      editable: true,
      verdict: 'degraded',
      time: '3 分钟前',
      config: { token: '', mirror: '', fullCatalog: false },
      paths: {
        direct: { state: 'bad', ms: 5000, mbps: null, reason: 'timeout', note: '直连超时（5 秒无响应）' },
        mirror: { state: 'skip', ms: null, mbps: null, note: '该站没有镜像入口，不测这一条' },
        proxy: { state: 'ok', ms: 780, mbps: 0.9, note: '唯一能通的一条' },
      },
    },
    {
      key: 'github',
      title: 'GitHub',
      sub: '节点清单 · 模板 · 工作流与节点包',
      editable: true,
      verdict: 'down',
      time: '3 分钟前',
      config: { token: '', mirror: '', fullCatalog: false },
      paths: {
        direct: { state: 'bad', ms: 5000, mbps: null, reason: 'timeout', note: '直连超时（5 秒无响应）' },
        mirror: { state: 'skip', ms: null, mbps: null, note: '加速前缀为空，不测这一条' },
        proxy: { state: 'bad', ms: 0, mbps: null, reason: 'refused', note: '连接被拒绝：目标端口未开放' },
      },
    },
    {
      key: 'templates',
      title: 'ComfyUI 官方模板',
      sub: '官方工作流模板 · 免鉴权固定源',
      editable: false,
      verdict: 'unknown',
      time: '—',
      config: { token: '', mirror: '', fullCatalog: false },
      paths: {
        direct: { state: 'unknown', ms: null, mbps: null, note: '本轮还没探' },
        mirror: { state: 'skip', ms: null, mbps: null, note: '该站没有镜像入口，不测这一条' },
        proxy: { state: 'skip', ms: null, mbps: null, note: '该站未允许经代理，不测这一条' },
      },
    },
    {
      key: 'comfyhub',
      title: 'ComfyHub',
      sub: '官方工作流商城 · 免鉴权固定源',
      editable: false,
      verdict: 'ok',
      time: '3 分钟前',
      config: { token: '', mirror: '', fullCatalog: false },
      paths: {
        direct: { state: 'ok', ms: 240, mbps: 3.8, note: '最快的一条通路' },
        mirror: { state: 'skip', ms: null, mbps: null, note: '该站没有镜像入口，不测这一条' },
        proxy: { state: 'skip', ms: null, mbps: null, note: '该站未允许经代理，不测这一条' },
      },
    },
  ]);

  readonly probing = signal(false);
  readonly probed = signal(false);
  readonly probeTime = signal('上次探测 · 3 分钟前');
  readonly probeSummaryOverride = signal<string | null>(null);

  readonly detailKey = signal<string | null>(null);
  readonly editKey = signal<string | null>(null);
  readonly draft = signal<Draft>({ token: '', mirror: '', fullCatalog: false });

  readonly proxyHost = signal('127.0.0.1');
  readonly proxyPort = signal('7890');
  readonly proxyTesting = signal(false);
  readonly proxyResult = signal<{ tone: 'ok' | 'err' | 'info'; text: string } | null>({
    tone: 'err',
    text: '失败',
  });

  readonly strategyUnlocked = signal(false);
  readonly manualStrategy = signal<PathKey | 'unavailable'>('direct');
  readonly saveNote = signal('');

  readonly proxyUrlText = computed(() => {
    const host = this.proxyHost().trim();
    const port = this.proxyPort().trim();
    if (!host) return '（未填）';
    let url = host.includes('://') ? host : `http://${host}`;
    if (port) url += `:${port}`;
    return url;
  });

  readonly summaryText = computed(() => {
    const override = this.probeSummaryOverride();
    if (override) return override;
    const list = this.sites();
    const count = (verdict: Verdict) => list.filter((s) => s.verdict === verdict).length;
    return `${list.length} 站：${count('ok')} 可用 · ${count('degraded')} 降级 · ${count('down')} 不可用 · ${count('unknown')} 未探测`;
  });

  readonly autoStrategy = computed<PathKey | 'unavailable'>(() => {
    const agg: Record<PathKey, number> = { direct: 0, mirror: 0, proxy: 0 };
    for (const site of this.sites()) {
      for (const path of PATH_ORDER) agg[path] += this.speedOf(site, path);
    }
    const base = Math.max(agg.direct, agg.mirror);
    if (agg.proxy > 0 && agg.proxy > 1.2 * base) return 'proxy';
    if (agg.direct > 0) return 'direct';
    if (agg.mirror > 0) return 'mirror';
    return 'unavailable';
  });

  readonly strategyValue = computed<PathKey | 'unavailable'>(() =>
    this.strategyUnlocked() ? this.manualStrategy() : this.autoStrategy(),
  );

  readonly strategyIsAuto = computed(
    () => !this.strategyUnlocked() || this.manualStrategy() === this.autoStrategy(),
  );

  readonly strategyText = computed(() => {
    const value = this.strategyValue();
    if (value === 'unavailable') return '不可用';
    return this.strategyIsAuto() ? `默认走${PATH_LABEL[value]}` : `已指定${PATH_LABEL[value]}`;
  });

  readonly strategySelectValue = computed(() => {
    const value = this.strategyValue();
    return value === 'unavailable' ? '' : value;
  });

  readonly cards = computed(() => this.sites().map((site) => this.buildCard(site)));

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers.clear();
      if (this.noteTimer) clearTimeout(this.noteTimer);
    });
  }

  // ---------------- 探针 ----------------

  retest(): void {
    if (this.probing()) return;
    this.probing.set(true);
    this.probeSummaryOverride.set('正在探测 6 个站（直连 + 镜像 + 代理，含测速）…');
    this.later(() => {
      this.sites.update((list) =>
        list.map((site) =>
          site.key === 'templates'
            ? {
                ...site,
                verdict: 'ok',
                time: '刚刚',
                paths: {
                  ...site.paths,
                  direct: { state: 'ok', ms: 205, mbps: 1.9, note: '最快的一条通路' },
                },
              }
            : { ...site, time: '刚刚' },
        ),
      );
      this.probeSummaryOverride.set(null);
      this.probed.set(true);
      this.probeTime.set('上次探测 · 刚刚 · 用时 4.2 s');
      this.probing.set(false);
    }, 1400);
  }

  // ---------------- 详情 / 编辑 ----------------

  toggleDetail(key: string): void {
    this.detailKey.set(this.detailKey() === key ? null : key);
  }

  toggleEdit(key: string): void {
    if (this.editKey() === key) {
      this.editKey.set(null);
      return;
    }
    const site = this.sites().find((s) => s.key === key);
    if (!site) return;
    this.draft.set({ ...site.config });
    this.editKey.set(key);
  }

  cancelEdit(): void {
    this.editKey.set(null);
  }

  applyEdit(key: string): void {
    const draft = this.draft();
    this.sites.update((list) =>
      list.map((site) =>
        site.key === key
          ? {
              ...site,
              config: {
                token: draft.token,
                mirror:
                  key === 'huggingface' || key === 'github' ? draft.mirror : site.config.mirror,
                fullCatalog: key === 'civitai' ? draft.fullCatalog : site.config.fullCatalog,
              },
            }
          : site,
      ),
    );
    this.editKey.set(null);
    this.flash('改动已写入本地样例（未接后端）');
  }

  tokenPlaceholder(key: string): string {
    switch (key) {
      case 'huggingface':
        return '私有仓库 / Gated 仓库需要';
      case 'modelscope':
        return '私有模型 / 提高配额';
      case 'civitai':
        return '提高配额 / 访问受限内容';
      case 'github':
        return '私有仓库 / 提高 API 限额';
      default:
        return '';
    }
  }

  mirrorHint(key: string): string {
    if (key === 'huggingface') return '境内镜像（hf-mirror 类）。留空＝只用官方地址。';
    return '写法是「前缀 + 完整 URL」，如 https://gh-proxy.com/。留空＝直连。';
  }

  editFootNote(key: string): string {
    if (key === 'modelscope') return '只改这一个字段。';
    return '只改这两个字段，不动别的站。';
  }

  setDraftToken(value: string): void {
    this.draft.update((draft) => ({ ...draft, token: value }));
  }

  setDraftMirror(value: string): void {
    this.draft.update((draft) => ({ ...draft, mirror: value }));
  }

  setDraftCatalog(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.draft.update((draft) => ({ ...draft, fullCatalog: checked }));
  }

  // ---------------- 代理配置 ----------------

  setProxyHost(value: string): void {
    this.proxyHost.set(value);
  }

  setProxyPort(value: string): void {
    this.proxyPort.set(value);
  }

  testProxy(): void {
    if (this.proxyTesting()) return;
    this.proxyTesting.set(true);
    this.proxyResult.set({ tone: 'info', text: '测试中…' });
    this.later(() => {
      // 样例口径：127.0.0.1:7890 代表端口未开 → 失败；改成别的地址 → 成功。
      const ok = !(
        this.proxyHost().trim() === '127.0.0.1' && this.proxyPort().trim() === '7890'
      );
      this.proxyTesting.set(false);
      this.proxyResult.set({ tone: ok ? 'ok' : 'err', text: ok ? '成功' : '失败' });
    }, 900);
  }

  // ---------------- 下载策略 ----------------

  toggleStrategy(): void {
    const next = !this.strategyUnlocked();
    this.strategyUnlocked.set(next);
    if (!next) this.manualStrategy.set(this.autoStrategy());
  }

  onStrategyPick(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as PathKey;
    this.manualStrategy.set(value);
  }

  resetStrategy(): void {
    this.manualStrategy.set(this.autoStrategy());
  }

  save(): void {
    this.flash('设置已保存（原型模拟，未接后端）');
  }

  // ---------------- 视图模型 ----------------

  private buildCard(site: SiteSeed): SiteCardView {
    const best = this.fastestOf(site);
    const chosen = best?.path ?? null;
    const cells = PATH_ORDER.map((path) => this.buildCell(site, path, chosen));

    let speedText = '还没探过';
    let speedClass: string = 'unknown';
    if (site.verdict === 'down') {
      speedText = '三条都不通';
      speedClass = 'down';
    } else if (best) {
      speedText = `${PATH_LABEL[best.path]} ${this.fmtSpeed(best.mbps)}`;
      speedClass = site.verdict === 'degraded' ? 'degraded' : 'ok';
    }

    let verdict = VERDICT_TEXT[site.verdict];
    if (site.verdict === 'degraded' && chosen) {
      verdict = `已降级 · 走${PATH_LABEL[chosen]}`;
    }

    let summary: SummaryParts;
    let detailSum: string;
    if (site.verdict === 'unknown') {
      summary = { pre: '还没探过 → ', strong: '未探测不门控', post: '，照常可见' };
      detailSum = '还没探过 —— 未探测不门控，发现页与下载页照常可见。';
    } else if (site.verdict === 'down' || !best) {
      summary = { pre: '三条都不通 → ', strong: '该源被门控', post: '，下载链路不向它发请求' };
      detailSum = '三条通路都不通 → 该源在发现页与下载页被门控，下载链路不会向它发请求。';
    } else if (site.verdict === 'degraded') {
      summary = {
        pre: '直连被挡，',
        strong: `${PATH_LABEL[best.path]} ${this.fmtSpeed(best.mbps)}`,
        post: ` → 已降级走${PATH_LABEL[best.path]} · 不门控`,
      };
      detailSum = `直连被挡、只有${PATH_LABEL[best.path]}能通（${this.fmtSpeed(best.mbps)}）→ 已降级，走${PATH_LABEL[best.path]}。源仍可用，不门控。`;
    } else {
      summary = {
        pre: `${PATH_LABEL[best.path]}最快 `,
        strong: this.fmtSpeed(best.mbps),
        post: `（${this.fmtMs(best.ms)}）`,
      };
      detailSum = `${PATH_LABEL[best.path]} ${this.fmtSpeed(best.mbps)}（${this.fmtMs(best.ms)}）最快 → 走${PATH_LABEL[best.path]}。`;
    }

    const values: ValueRead[] = [];
    if (site.editable) {
      const editing = this.editKey() === site.key;
      const draft = this.draft();
      const token = editing ? draft.token : site.config.token;
      values.push({ label: 'Token', value: token.trim() ? '已设置' : '未设置' });

      if (site.key === 'civitai') {
        const on = editing ? draft.fullCatalog : site.config.fullCatalog;
        values.push({ label: '完整目录', value: on ? '开' : '关' });
      } else if (site.key === 'huggingface' || site.key === 'github') {
        const mirror = editing ? draft.mirror : site.config.mirror;
        const filled = mirror.trim().length > 0;
        values.push({
          label: '镜像',
          value: !filled ? '未填' : chosen === 'mirror' ? '已启用' : '已填未启用',
        });
      }
    }

    return {
      key: site.key,
      title: site.title,
      sub: site.sub,
      editable: site.editable,
      state: site.verdict,
      verdict,
      verdictTone: VERDICT_TONE[site.verdict],
      speedText,
      speedClass,
      timeText: site.time,
      summary,
      detailSum,
      cells,
      values,
    };
  }

  private buildCell(site: SiteSeed, path: PathKey, chosen: PathKey | null): PathCellView {
    const read = site.paths[path];
    const label = PATH_LABEL[path];
    const state = read.state;
    const badge =
      state === 'ok'
        ? '可用'
        : state === 'bad'
          ? '不通'
          : state === 'skip'
            ? path === 'mirror'
              ? '未配置'
              : '未启用'
            : '未探测';
    const badgeTone: BadgeTone = state === 'ok' ? 'green' : state === 'bad' ? 'red' : 'gray';
    const speed = this.fmtSpeed(read.mbps);
    const latency = this.fmtMs(read.ms);
    const best = chosen === path && state === 'ok';

    let lat: string;
    if (state === 'ok') {
      lat = best ? `${latency} · 最快` : latency;
    } else if (state === 'bad') {
      lat =
        read.reason === 'timeout'
          ? '5.0 s 超时'
          : read.reason === 'refused'
            ? '拒连 · 端口未开放'
            : '不通';
    } else if (state === 'unknown') {
      lat = '还没探';
    } else {
      lat = '不测';
    }

    return {
      path,
      label,
      state,
      badge,
      badgeTone,
      speed,
      lat,
      latency,
      note: read.note,
      reason: read.reason,
      best,
      title: `${label}：${badge} · ${latency} · ${speed}${read.note ? ' · ' + read.note : ''}`,
    };
  }

  private speedOf(site: SiteSeed, path: PathKey): number {
    const read = site.paths[path];
    return read.state === 'ok' ? (read.mbps ?? 0) : 0;
  }

  /** 代理要比直连 / 镜像快 20% 以上才选（按实测吞吐比，不按延迟比）。 */
  private fastestOf(site: SiteSeed): { path: PathKey; mbps: number; ms: number | null } | null {
    const direct = this.speedOf(site, 'direct');
    const mirror = this.speedOf(site, 'mirror');
    const proxy = this.speedOf(site, 'proxy');

    if (proxy > 1.2 * Math.max(direct, mirror)) {
      return { path: 'proxy', mbps: proxy, ms: site.paths.proxy.ms };
    }

    let best: { path: PathKey; mbps: number; ms: number | null } | null = null;
    if (direct > 0) best = { path: 'direct', mbps: direct, ms: site.paths.direct.ms };
    if (mirror > 0 && (!best || mirror > best.mbps)) {
      best = { path: 'mirror', mbps: mirror, ms: site.paths.mirror.ms };
    }
    return best;
  }

  private fmtSpeed(mbps: number | null): string {
    return mbps === null ? '—' : `${mbps.toFixed(1)} MB/s`;
  }

  private fmtMs(ms: number | null): string {
    if (ms === null) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  }

  private flash(text: string): void {
    this.saveNote.set(text);
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = this.later(() => this.saveNote.set(''), 3200);
  }

  private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
}
