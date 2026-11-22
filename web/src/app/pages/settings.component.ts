import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ProbeService } from '../core/probe.service';
import {
  AppSettings,
  ProbePath,
  ProbeStatus,
  SourceProbe,
  errMsg,
  proxyUrl,
} from '../core/types';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

/** 一条通路在读数条上的显示模型。 */
interface PathCell {
  path: ProbePath;
  label: string;
  state: string;
  badge: string;
  badgeClass: string;
  speed: string;
  lat: string;
  latency: string;
  note: string;
  best: boolean;
  title: string;
}

/** 一张站点卡的显示模型。 */
interface SiteCard {
  key: string;
  title: string;
  sub: string;
  editable: boolean;
  state: string;
  verdict: string;
  verdictClass: string;
  speedText: string;
  speedClass: string;
  timeText: string;
  summary: string;
  detailSum: string;
  cells: PathCell[];
  values: { label: string; value: string }[];
  fallback: boolean;
}

const PATH_LABEL: Record<string, string> = { direct: '直连', mirror: '镜像', proxy: '代理' };
const VERDICT_TEXT: Record<string, string> = {
  ok: '可用',
  degraded: '已降级',
  down: '不可用',
  unknown: '未探测',
};
const VERDICT_CLASS: Record<string, string> = {
  ok: 'green',
  degraded: 'orange',
  down: 'red',
  unknown: 'gray',
};

/**
 * 设置页：左右双栏。
 *
 * 左栏宽（7 份）是 6 张站点卡 —— 每张卡里带探针四态、直连/镜像/代理三条通路的
 * 延迟与吞吐、失败原因分类，以及这个站自己的凭据与镜像；右下角「编辑」按钮
 * 弹出的层里只放该站支持的字段。
 * 右栏窄（3 份）是两张全局卡：本地代理配置与下载策略。
 *
 * 页面结构、卡片几何、交互与文案以 artifacts/vis/drafts/settings-default-config.html
 * （第七轮定稿原型）为准；探针口径以 artifacts/vis/drafts/source-probe-and-defaults-spec.md 为准。
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldComponent, PageHeaderComponent, PanelComponent],
  template: `
    <!-- 分层页头（VIS §3.7.7 定稿）。设置页是单页区，没有第二个视图，不放视图切换。
         hint 只说这页是干什么的，不描述左右布局。 -->
    <ui-page-header
      kicker="Settings"
      title="设置"
      hint="各站点的连通性与凭据、代理地址与下载策略。"
    />

    @if (settings) {
      <div class="settings-cols-sites">
        <!-- ─────────── 左栏：全部站点 ─────────── -->
        <div class="col col-sites">
          <div class="probe-bar">
            <button class="primary" (click)="retest()" [disabled]="probing">
              {{ probing ? '测试中…' : '重新测试连通性' }}
            </button>
            <span class="tiny muted">同时实测速度</span>
            <span class="ui-badge" [ngClass]="probed ? 'blue' : 'gray'">{{ probeSummary }}</span>
            <span class="bar-note mono">{{ probeTime }}</span>
          </div>

          <p class="one-liner">下载、列表都会通过<b>探针的结果缓存</b>走最快的那条。</p>

          @for (card of cards; track card.key) {
            <article class="src-card" [ngClass]="card.state" [class.is-testing]="probing">
              <div class="rail"></div>
              <div class="src-head">
                <div class="src-id">
                  <h3 class="src-title">{{ card.title }}</h3>
                  <span class="src-key mono">{{ card.key }}</span>
                  <span class="src-sub">{{ card.sub }}</span>
                </div>
                <div class="src-head-right">
                  <span class="src-speed" [ngClass]="card.speedClass">{{ card.speedText }}</span>
                  <span class="src-time mono">{{ card.timeText }}</span>
                  <span class="ui-badge src-verdict" [ngClass]="card.verdictClass">{{ card.verdict }}</span>
                </div>
              </div>

              <div class="src-strip">
                @for (cell of card.cells; track cell.path) {
                  <div
                    class="pcell"
                    [ngClass]="{ 'is-best': cell.best, 'is-bad': cell.state === 'blocked', 'is-skip': cell.state !== 'ok' }"
                    [title]="cell.title"
                  >
                    <span class="pc-top">
                      <b>{{ cell.label }}</b>
                      <span class="ui-badge" [ngClass]="cell.badgeClass">{{ cell.badge }}</span>
                    </span>
                    <span class="pc-line">
                      <b class="pc-speed">{{ cell.speed }}</b>
                      <span class="pc-lat">{{ cell.lat }}</span>
                    </span>
                  </div>
                }
              </div>

              <div class="src-foot">
                <span class="src-sum" [innerHTML]="card.summary"></span>
                <div class="src-vals">
                  @for (v of card.values; track v.label) {
                    <span class="sv">{{ v.label }} <b>{{ v.value }}</b></span>
                  }
                </div>
                <div class="src-tools">
                  <button
                    class="btn-xs ghost detail-btn"
                    (click)="toggleDetail(card.key)"
                    [class.is-open]="detailKey === card.key"
                    [attr.aria-expanded]="detailKey === card.key"
                  >
                    详情
                  </button>
                  @if (card.editable) {
                    <button
                      class="btn-xs edit-btn"
                      (click)="toggleEdit(card.key)"
                      [class.is-open]="editKey === card.key"
                      [attr.aria-expanded]="editKey === card.key"
                    >
                      编辑
                    </button>
                  }
                </div>
              </div>

              @if (detailKey === card.key) {
                <div class="detail-panel">
                  @for (cell of card.cells; track cell.path) {
                    <div class="drow">
                      <b>{{ cell.label }}</b>
                      <span class="ui-badge" [ngClass]="cell.badgeClass">{{ cell.badge }}</span>
                      <span class="mono">{{ cell.latency }}</span>
                      <span class="mono">{{ cell.speed }}</span>
                      <span class="d-reason">{{ cell.note }}</span>
                    </div>
                  }
                  <p class="d-sum" [innerHTML]="card.detailSum"></p>
                </div>
              }

              @if (editKey === card.key) {
                <div class="edit-panel">
                  <div class="edit-grid">
                    <ui-field label="Token">
                      <input type="password" [(ngModel)]="draft.token" [placeholder]="tokenPlaceholder(card.key)">
                    </ui-field>

                    @if (card.key === 'huggingface' || card.key === 'github') {
                      <ui-field [label]="card.key === 'huggingface' ? '镜像站点' : '加速前缀'">
                        <input
                          class="mono"
                          [(ngModel)]="draft.mirror"
                          [placeholder]="card.key === 'huggingface' ? 'https://hf-mirror.com' : 'https://gh-proxy.com/'"
                        >
                        <span class="tiny">{{ mirrorHint(card.key) }}</span>
                      </ui-field>
                    }

                    @if (card.key === 'civitai') {
                      <ui-field label="完整目录（CivitAI Red）">
                        <div class="check-row">
                          <input type="checkbox" [(ngModel)]="draft.full_catalog">
                          <div>
                            <strong>含成熟内容（18+，部分地区依法受限）</strong>
                            <div class="muted">打开后搜索走 civitai.red 的完整目录。</div>
                          </div>
                        </div>
                      </ui-field>
                    }
                  </div>
                  <div class="edit-foot">
                    <button class="btn-xs primary" (click)="applyEdit(card.key)">保存</button>
                    <button class="btn-xs" (click)="toggleEdit(card.key)">取消</button>
                    <span class="tiny">{{ editFootNote(card.key) }}</span>
                  </div>
                </div>
              }
            </article>
          }
        </div>

        <!-- ─────────── 右栏：全局 ─────────── -->
        <div class="col col-side">
          <ui-panel kicker="Proxy" title="本地代理配置" hint="全局一份。探针判定直连不通时，下载链路自动改走这里。">
            <div class="form-grid">
              <ui-field label="IP 或 网址">
                <input [(ngModel)]="settings.proxy.host" placeholder="127.0.0.1">
              </ui-field>
              <ui-field label="端口">
                <input type="number" [(ngModel)]="settings.proxy.port" placeholder="7890">
              </ui-field>
            </div>
            <div class="toolbar mt">
              <button (click)="testProxy()" [disabled]="proxyTesting">
                {{ proxyTesting ? '测试中…' : '测试代理' }}
              </button>
              <span class="mono muted">{{ proxyUrl(settings.proxy) || '（未填）' }}</span>
            </div>
            @if (proxyResult) {
              <div
                class="notice is-inline"
                [ngClass]="proxyResult.ok ? 'ok' : 'err'"
                [attr.role]="proxyResult.ok ? null : 'alert'"
              >
                {{ proxyResult.text }}
              </div>
            }
          </ui-panel>

          <div class="strategy-wrap" [class.is-unlocked]="strategyUnlocked">
            <ui-panel kicker="Download" title="下载策略">
              <div class="strategy-now">
                <span class="ui-badge" [ngClass]="strategyManual ? 'orange' : 'blue'">
                  {{ strategyManual ? '手动' : '自动' }}
                </span>
                <b>{{ strategyText }}</b>
              </div>
              <div class="toolbar mt">
                <button class="btn-xs" (click)="toggleStrategy()">
                  {{ strategyUnlocked ? '锁定' : '解锁' }}
                </button>
                @if (strategyUnlocked) {
                  <select class="strategy-select" [(ngModel)]="strategyPick" (ngModelChange)="onStrategyPick($event)">
                    <option value="direct">直连（direct）</option>
                    <option value="mirror">镜像（mirror）</option>
                    <option value="proxy">代理（proxy）</option>
                  </select>
                  <button class="btn-xs" (click)="resetStrategy()">恢复自动</button>
                }
              </div>
            </ui-panel>
          </div>
        </div>
      </div>

      <div class="save-bar">
        <button class="primary" (click)="save()" [disabled]="saving">{{ saving ? '保存中…' : '保存设置' }}</button>
        @if (message) {
          <span class="notice is-inline" [ngClass]="messageOk ? 'ok' : 'err'" [attr.role]="messageOk ? null : 'alert'">
            {{ message }}
          </span>
        } @else {
          <span class="muted save-hint">改动不会自动保存，确认后再点一次。</span>
        }
      </div>
    }
  `,
  styles: [`
    /* ── 版式：左右双栏，左 7 : 右 3（规格 §5.1） ── */
    .settings-cols-sites {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(286px, 3fr);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1080px) {
      .settings-cols-sites { grid-template-columns: minmax(0, 1fr); }
    }
    .col { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
    .col-side { position: sticky; top: 16px; gap: 14px; }
    @media (max-width: 1080px) {
      .col-side { position: static; }
    }

    /* ── 全局动作条（重新测试连通性） ── */
    .probe-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow-sm);
    }
    .probe-bar .bar-note { margin-left: auto; font-size: 11px; color: var(--muted); }
    .one-liner {
      margin: 0;
      padding: 8px 12px;
      border: 1px dashed var(--accent-line);
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: var(--text-2);
      font-size: 12px;
    }
    .one-liner b { color: var(--accent); font-weight: 600; }

    /* ── 站点卡：紧凑几何（原型 §5.2，单卡约 133 px） ── */
    .src-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }
    .src-card > .rail { height: 2px; background: var(--border-strong); }
    .src-card.st-ok > .rail { background: var(--ok); }
    .src-card.st-degraded > .rail { background: var(--warn); }
    .src-card.st-down > .rail { background: var(--err); }
    .src-card.st-unknown > .rail {
      background: repeating-linear-gradient(90deg, var(--border-strong) 0 8px, transparent 8px 14px);
    }
    .src-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 14px 8px;
    }
    .src-id { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .src-title { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
    .src-key { font-size: 10.5px; color: var(--muted); }
    .src-sub { font-size: 12px; color: var(--muted); }
    .src-head-right { display: flex; align-items: center; gap: 8px; flex: none; }
    .src-speed { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .src-time { font-size: 10.5px; color: var(--muted); }
    .src-speed.ok { color: var(--ok); }
    .src-speed.degraded { color: var(--warn); }
    .src-speed.down { color: var(--err); }
    .src-speed.unknown { color: var(--muted); }

    /* 三段式读数条：一条通路一格 */
    .src-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1px;
      margin: 0 14px;
      background: var(--border-soft);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .pcell {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 6px 9px 7px;
      background: var(--panel-2);
      min-width: 0;
    }
    .pcell.is-best { background: var(--ok-soft); }
    .pcell.is-bad { background: var(--err-soft); }
    .pcell.is-skip { background: var(--panel); opacity: 0.85; }
    .pc-top { display: flex; align-items: center; gap: 6px; line-height: 1.2; }
    .pc-top b { font-size: 11.5px; font-weight: 600; color: var(--text-2); }
    .pc-top .ui-badge { font-size: 10px; padding: 0 6px; line-height: 16px; }
    .pc-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .pc-speed { font-size: 13px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1.25; }
    .pcell.is-best .pc-speed { color: var(--ok); }
    .pcell.is-bad .pc-speed { color: var(--err); }
    .pcell.is-skip .pc-speed { color: var(--muted); }
    .pc-lat { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; line-height: 1.25; white-space: nowrap; }
    .pcell.is-best .pc-lat { color: var(--ok); }
    .pcell.is-bad .pc-lat { color: var(--err); }

    .src-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 14px 8px;
    }
    .src-sum {
      flex: 1 1 auto;
      font-size: 11.5px;
      color: var(--text-2);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .src-sum b { font-weight: 600; }
    .src-tools { display: flex; align-items: center; gap: 6px; flex: none; }
    .edit-btn::after { content: "▾"; margin-left: 2px; font-size: 9px; color: var(--muted); }
    .edit-btn.is-open { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent); }
    .edit-btn.is-open::after { content: "▴"; }
    .detail-btn::after { content: "▾"; margin-left: 2px; font-size: 9px; color: var(--muted); }
    .detail-btn.is-open { color: var(--accent); }
    .detail-btn.is-open::after { content: "▴"; }

    /* 当前值读数：与编辑面板里的字段一一对应 */
    .src-vals {
      display: flex;
      align-items: center;
      gap: 3px 12px;
      flex: none;
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
    }
    .src-vals .sv b { color: var(--text-2); font-weight: 600; }

    /* 详情（次级交互：完整读数） */
    .detail-panel {
      border-top: 1px solid var(--border-soft);
      background: var(--panel-2);
      padding: 9px 14px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .drow {
      display: grid;
      grid-template-columns: 46px 58px 68px 72px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--muted);
    }
    .drow b { font-size: 11.5px; color: var(--text-2); }
    .drow .mono { color: var(--text-2); font-variant-numeric: tabular-nums; }
    .d-reason { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .d-sum { margin: 0; font-size: 11.5px; color: var(--text-2); line-height: 1.6; }
    .d-sum b { font-weight: 600; }

    /* 编辑面板 */
    .edit-panel {
      border-top: 1px solid var(--accent-line);
      background: var(--accent-soft);
      padding: 11px 14px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .edit-panel .edit-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
    }
    .edit-panel .edit-foot { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
    .edit-panel .edit-foot .tiny { color: var(--muted); }

    .src-card.is-testing .src-verdict { opacity: 0.4; }
    .src-card.is-testing .src-strip { opacity: 0.45; }

    /* ── 下载策略卡 ── */
    .strategy-wrap.is-unlocked ui-panel {
      border-color: var(--warn);
    }
    .strategy-wrap.is-unlocked .strategy-now {
      border-color: color-mix(in oklab, var(--warn) 35%, var(--border));
      background: var(--warn-soft);
    }
    .strategy-now {
      display: flex;
      align-items: baseline;
      gap: 9px;
      flex-wrap: wrap;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .strategy-now b { font-size: 14px; font-weight: 600; }
    .strategy-select { width: auto; min-width: 132px; height: 25px; font-size: 12px; }

    .save-hint { font-size: 11.5px; }
    .toolbar.mt { margin-top: 12px; }
  `],
})
export class SettingsComponent implements OnInit {
  settings: AppSettings | null = null;
  probe: ProbeStatus | null = null;
  cards: SiteCard[] = [];

  saving = false;
  message = '';
  messageOk = true;
  proxyResult: { ok: boolean; text: string } | null = null;
  proxyTesting = false;

  probing = false;
  probed = false;
  probeElapsed = 0;
  detailKey: string | null = null;
  editKey: string | null = null;
  draft: { token: string; mirror: string; full_catalog: boolean } = { token: '', mirror: '', full_catalog: false };

  strategyUnlocked = false;
  strategyPick: ProbePath = 'direct';

  /** 左栏 6 张站点卡。demo 是本地假数据、不出网，不在设置页出现。 */
  readonly sites = [
    { key: 'huggingface', title: 'Hugging Face', sub: '模型搜索 API · 权重下载', editable: true },
    { key: 'modelscope', title: 'ModelScope', sub: '魔搭模型库', editable: true },
    { key: 'civitai', title: 'Civitai', sub: '社区模型 · 版本与元数据', editable: true },
    { key: 'github', title: 'GitHub', sub: '节点清单 · 模板 · 工作流与节点包', editable: true },
    { key: 'templates', title: 'ComfyUI 官方模板', sub: '官方工作流模板 · 免鉴权固定源', editable: false },
    { key: 'comfyhub', title: 'ComfyHub', sub: '官方工作流商城 · 免鉴权固定源', editable: false },
  ];

  private pollCount = 0;

  constructor(private api: ApiService, private probeSvc: ProbeService) {}

  readonly proxyUrl = proxyUrl;

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (s) => {
        this.settings = s;
        this.initStrategy(s);
        this.rebuild();
        this.loadProbe();
      },
      error: (err) => {
        this.message = errMsg(err, '读取设置失败');
        this.messageOk = false;
      },
    });
  }

  // ---------------- 探针 ----------------

  private loadProbe(): void {
    this.api.getProbeStatus().subscribe({
      next: (st) => {
        this.probe = st;
        this.probed = this.probe.sources.some((s) => s.checked_at > 0);
        // 写回共享探针：发现 / 下载 / 库 / 工作流下一页进入时读到的就是这份结论
        this.probeSvc.apply(st);
        this.rebuild();
        // 首次进来还没探过时，后端会在后台补探一轮；这里跟着取一次结果
        if (this.probe.summary.unknown > 0 && this.pollCount < 3) {
          this.pollCount += 1;
          setTimeout(() => this.loadProbe(), 2500);
        }
      },
      error: () => {
        // 探针不可用不该让页面报错：页面照常工作，只是没有读数
        this.rebuild();
      },
    });
  }

  retest(): void {
    if (this.probing) return;
    this.probing = true;
    const started = Date.now();
    this.api.refreshProbe().subscribe({
      next: (st) => {
        this.probing = false;
        this.probeElapsed = (Date.now() - started) / 1000;
        this.probe = st;
        this.probed = true;
        this.probeSvc.apply(st);
        this.rebuild();
      },
      error: (err) => {
        this.probing = false;
        this.message = errMsg(err, '探测失败，请检查网络或代理设置');
        this.messageOk = false;
      },
    });
  }

  get probeSummary(): string {
    const s = this.probe?.summary;
    if (!s) return '还没探过';
    return `${this.sites.length} 站：${s.ok} 可用 · ${s.degraded} 降级 · ${s.down} 不可用 · ${s.unknown} 未探测`;
  }

  get probeTime(): string {
    const sources = this.probe?.sources || [];
    const ages = sources.map((s) => s.age_seconds).filter((a): a is number => typeof a === 'number');
    if (!ages.length) return '还没探过';
    const min = Math.min(...ages);
    const when = min < 60 ? `${min} 秒前` : min < 3600 ? `${Math.round(min / 60)} 分钟前` : `${Math.round(min / 3600)} 小时前`;
    return this.probeElapsed ? `上次探测 · 刚刚 · 用时 ${this.probeElapsed.toFixed(1)} s` : `上次探测 · ${when}`;
  }

  // ---------------- 卡片 ----------------

  private sourceOf(key: string): SourceProbe | undefined {
    return (this.probe?.sources || []).find((s) => s.source === key);
  }

  private rebuild(): void {
    this.cards = this.sites.map((site) => this.buildCard(site));
  }

  private buildCard(site: { key: string; title: string; sub: string; editable: boolean }): SiteCard {
    const probe = this.sourceOf(site.key);
    const cfg = this.settings?.sources?.[site.key];
    const verdict = probe?.verdict || 'unknown';
    const chosen = probe?.path || '';
    const cells = this.buildCells(site.key, probe, chosen);

    const chosenCell = cells.find((c) => c.path === chosen);
    let speedText = '还没探过';
    let speedClass = 'unknown';
    if (verdict === 'down') {
      speedText = '三条都不通';
      speedClass = 'down';
    } else if (chosenCell) {
      speedText = chosenCell.speed !== '—' ? `${chosenCell.label} ${chosenCell.speed}` : `${chosenCell.label} 可用`;
      speedClass = verdict === 'degraded' ? 'degraded' : 'ok';
    }

    let summary: string;
    if (verdict === 'unknown') {
      summary = '还没探过 → <b>未探测不门控</b>，照常可见';
    } else if (verdict === 'down') {
      summary = '三条都不通 → <b>该源被门控</b>，下载链路不向它发请求';
    } else if (verdict === 'degraded') {
      summary = `直连被挡，<b>${chosenCell?.label || ''} ${chosenCell?.speed || ''}</b> → 已降级走${chosenCell?.label || ''} · 不门控`;
    } else {
      const lat = chosenCell?.latency && chosenCell.latency !== '—' ? `（${chosenCell.latency}）` : '';
      summary = `${chosenCell?.label || ''}最快 <b>${chosenCell?.speed || ''}</b>${lat}`;
    }
    if (probe?.fallback) {
      summary += ' · <b>已回退</b>';
    }

    const detailSum =
      verdict === 'down'
        ? '三条通路都不通 → <b>该源在发现页与下载页被门控</b>，下载链路不会向它发请求。'
        : verdict === 'unknown'
          ? '还没探过 —— <b>未探测不门控</b>，发现页与下载页照常可见。'
          : `${probe?.path_text || ''}。源仍可用，不门控。`;

    const values: { label: string; value: string }[] = [];
    if (site.editable) {
      values.push({ label: 'Token', value: cfg?.token ? '已设置' : '未设置' });
      if (site.key === 'civitai') {
        // 编辑层里勾上就当场变读数（原型行为）：还没保存也先给用户看得到
        const on = this.editKey === 'civitai' ? this.draft.full_catalog : !!cfg?.full_catalog;
        values.push({ label: '完整目录', value: on ? '开' : '关' });
      } else if (site.key === 'huggingface' || site.key === 'github') {
        const filled = !!cfg?.mirror;
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
      state: `st-${verdict}`,
      verdict: this.verdictText(verdict, chosen),
      verdictClass: VERDICT_CLASS[verdict] || 'gray',
      speedText,
      speedClass,
      timeText: this.ageText(probe),
      summary,
      detailSum,
      cells,
      values,
      fallback: !!probe?.fallback,
    };
  }

  private verdictText(verdict: string, chosen: string): string {
    if (verdict === 'degraded') {
      return chosen ? `已降级 · 走${PATH_LABEL[chosen] || chosen}` : '已降级';
    }
    return VERDICT_TEXT[verdict] || '未探测';
  }

  private ageText(probe?: SourceProbe): string {
    const age = probe?.age_seconds;
    if (age === null || age === undefined) return '—';
    if (age < 60) return '刚刚';
    if (age < 3600) return `${Math.round(age / 60)} 分钟前`;
    return `${Math.round(age / 3600)} 小时前`;
  }

  private buildCells(key: string, probe: SourceProbe | undefined, chosen: string): PathCell[] {
    const paths: ProbePath[] = ['direct', 'mirror', 'proxy'];
    return paths.map((path) => {
      const raw = probe?.paths?.[path];
      const label = PATH_LABEL[path];
      const state = raw?.state || 'unknown';
      const badge =
        state === 'ok'
          ? '可用'
          : state === 'blocked'
            ? '不通'
            : state === 'skip'
              ? this.skipBadge(raw?.skip)
              : '未探测';
      const badgeClass = state === 'ok' ? 'green' : state === 'blocked' ? 'red' : 'gray';
      const speed =
        raw?.speed_mbps !== null && raw?.speed_mbps !== undefined ? `${raw.speed_mbps.toFixed(1)} MB/s` : '—';
      const latency = raw?.latency_ms !== null && raw?.latency_ms !== undefined ? this.fmtMs(raw.latency_ms) : '—';
      const best = !!chosen && chosen === path && state === 'ok';
      let lat = '—';
      if (state === 'ok') lat = best ? `${latency} · 最快` : latency;
      else if (state === 'blocked') lat = this.shortReason(raw?.reason);
      else if (state === 'unknown') lat = '还没探';
      else lat = '不测';
      const note = raw?.reason_text || (state === 'skip' ? '没有可测的目标' : '');
      const title = `${label}：${badge} · ${latency} · ${speed}${note ? ' · ' + note : ''}`;
      return { path, label, state, badge, badgeClass, speed, lat, latency, note, best, title };
    });
  }

  private skipBadge(skip?: string): string {
    if (skip === 'not_enabled') return '未启用';
    return '未配置';
  }

  /** 失败原因在读数条上的短字（完整措辞在「详情」里）。 */
  private shortReason(reason?: string): string {
    switch (reason) {
      case 'timeout':
        return '5.0 s 超时';
      case 'dns':
        return '域名不通';
      case 'tls':
        return '证书错误';
      case 'refused':
        return '拒连 · 端口未开放';
      case 'rate_limited':
        return '限流 429';
      case 'forbidden':
        return '要授权';
      case 'server':
        return '对端 5xx';
      default:
        return '不通';
    }
  }

  private fmtMs(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  }

  // ---------------- 详情 / 编辑 ----------------

  toggleDetail(key: string): void {
    this.detailKey = this.detailKey === key ? null : key;
  }

  toggleEdit(key: string): void {
    if (this.editKey === key) {
      this.editKey = null;
      return;
    }
    const cfg = this.settings?.sources?.[key];
    this.draft = {
      token: cfg?.token || '',
      mirror: cfg?.mirror || '',
      full_catalog: !!cfg?.full_catalog,
    };
    this.editKey = key;
  }

  applyEdit(key: string): void {
    if (!this.settings) return;
    const cfg = this.settings.sources[key];
    if (!cfg) return;
    cfg.token = this.draft.token;
    if (key === 'huggingface' || key === 'github') {
      cfg.mirror = this.draft.mirror;
    }
    if (key === 'civitai') {
      cfg.full_catalog = this.draft.full_catalog;
    }
    this.editKey = null;
    this.save();
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

  // ---------------- 下载策略 ----------------

  private initStrategy(settings: AppSettings): void {
    const override = (settings.download?.path_override || '').trim();
    if (override === 'direct' || override === 'mirror' || override === 'proxy') {
      this.strategyUnlocked = true;
      this.strategyPick = override;
    }
  }

  get strategyManual(): boolean {
    const override = (this.settings?.download?.path_override || '').trim();
    return override === 'direct' || override === 'mirror' || override === 'proxy';
  }

  get strategyText(): string {
    if (this.strategyManual) {
      return `已指定${PATH_LABEL[this.settings?.download?.path_override || ''] || ''}`;
    }
    return this.probe?.strategy?.auto_text || '还没探过';
  }

  toggleStrategy(): void {
    this.strategyUnlocked = !this.strategyUnlocked;
    if (this.strategyUnlocked) {
      const override = (this.settings?.download?.path_override || '').trim();
      const auto = this.probe?.strategy?.auto_path || '';
      this.strategyPick = (override || auto || 'direct') as ProbePath;
    }
  }

  /** 手动指定：不受 20% 门槛限制，选中即生效（规格 §3.6.3）。 */
  onStrategyPick(value: ProbePath): void {
    if (!this.settings) return;
    this.settings.download.path_override = value;
    this.rebuild();
    this.save();
  }

  resetStrategy(): void {
    if (!this.settings) return;
    this.settings.download.path_override = '';
    this.rebuild();
    this.save();
  }

  // ---------------- 保存 / 代理 ----------------

  save(): void {
    if (!this.settings) return;
    this.saving = true;
    this.api.saveSettings(this.settings).subscribe({
      next: () => {
        this.saving = false;
        this.message = '设置已保存';
        this.messageOk = true;
        // 改了代理地址 / 镜像 → 探针结论立即作废；共享状态也一起作废，
        // 其他页面下一次 ensure 会重新拉，不会继续用旧结论灰置/亮着。
        this.probeSvc.invalidate();
        this.loadProbe();
      },
      error: (err) => {
        this.saving = false;
        this.message = errMsg(err, '保存失败');
        this.messageOk = false;
      },
    });
  }

  testProxy(): void {
    if (!this.settings || this.proxyTesting) return;
    this.proxyTesting = true;
    this.proxyResult = null;
    const url = proxyUrl(this.settings.proxy);
    this.api.testProxy(url).subscribe({
      next: (res) => {
        this.proxyTesting = false;
        this.proxyResult = { ok: !!res.proxy?.ok, text: res.proxy?.ok ? '成功' : '失败' };
      },
      error: () => {
        this.proxyTesting = false;
        this.proxyResult = { ok: false, text: '失败' };
      },
    });
  }
}
