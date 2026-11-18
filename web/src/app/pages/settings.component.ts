import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AppSettings, errMsg, FamilyAttention, FamilyScanStatus, proxyUrl } from '../core/types';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

/** 巡检时间戳格式化成「11-16 12:12」—— 直接显示 ISO 串太像日志。 */
function fmtScanTime(iso: string | null): string {
  if (!iso) return '';
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]} ${m[3]}:${m[4]}` : iso;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header
      kicker="Settings"
      title="设置"
      hint="左边是全局：存哪儿、怎么下、走不走代理。右边只配每个源自己的凭据。"
    />

    @if (settings) {
      <div class="settings-cols">
        <div class="col">
          <ui-panel kicker="Storage" title="模型下载目录" hint="下载产物落在这里，默认 workspace/models（相对项目目录，ComfyUI 直接共享该目录）。">
            <div class="path-row">
              <input class="mono" [value]="settings.download.save_dir" readonly placeholder="workspace/models">
              <button (click)="browseSaveDir()">选择…</button>
            </div>
          </ui-panel>

          <ui-panel kicker="aria2" title="内核与默认策略" hint="这三个参数对所有下载源生效。">
            <div class="form-grid">
              <ui-field label="单文件连接数 (-x)">
                <input type="number" [(ngModel)]="settings.aria2.connections">
              </ui-field>
              <ui-field label="分片数 (-s)">
                <input type="number" [(ngModel)]="settings.aria2.split">
              </ui-field>
              <ui-field label="RPC 端口">
                <input type="number" [(ngModel)]="settings.aria2.rpc_port">
              </ui-field>
            </div>
            <ui-field label="默认策略">
              <div class="radio-group">
                @for (opt of strategyOptions; track opt.value) {
                  <label class="radio-row">
                    <input type="radio" name="defaultStrategy" [value]="opt.value" [(ngModel)]="settings.download.strategy">
                    <span>{{ opt.label }}</span>
                  </label>
                }
              </div>
            </ui-field>
          </ui-panel>

          <ui-panel kicker="Proxy" title="代理配置" hint="只有打开了「启用代理」的下载源才会走这里。">
            <div class="form-grid">
              <ui-field label="IP 或 网址">
                <input [(ngModel)]="settings.proxy.host" placeholder="127.0.0.1">
              </ui-field>
              <ui-field label="端口">
                <input type="number" [(ngModel)]="settings.proxy.port" placeholder="7890">
              </ui-field>
            </div>
            <div class="toolbar mt">
              <button (click)="testProxy()">测试代理</button>
              <span class="mono muted">{{ proxyUrl(settings.proxy) }}</span>
            </div>
            @if (proxyResult) {
              <div class="notice" [ngClass]="proxyResult.ok ? 'ok' : 'err'">{{ proxyResult.text }}</div>
            }
          </ui-panel>

          <ui-panel
            kicker="Branding"
            title="厂标资产巡检"
            hint="发现页搜索时会顺带检查一次上游有没有改版（一天最多一次）。官方改了 logo 时这里会列出待确认的厂牌 —— 换不换由你决定，脚本绝不自动替换。"
          >
            <div class="toolbar mt">
              <button (click)="scanFamilies(true)" [disabled]="familyScanning">
                {{ familyScanning ? '检查中…' : '立即检查' }}
              </button>
              <span class="muted">{{ familyScanText() }}</span>
            </div>
            @if (familyScan?.lastError) {
              <div class="notice err">{{ familyScan!.lastError }}</div>
            }
            @if (familyAttention().length) {
              <div class="notice err">
                @for (a of familyAttention(); track a.id) {
                  <div>
                    · {{ a.id }} ——
                    {{ a.state === 'drifted' ? '上游已改版，新版本已存到 var/tmp/family-candidates/' : '抓取失败' }}
                  </div>
                }
                <div class="muted">确认要用新版本：node scripts/fetch-family-assets.mjs --promote &lt;厂牌 id&gt;</div>
              </div>
            }
          </ui-panel>
        </div>

        <div class="col">
          @for (key of sourceKeys; track key) {
            <ui-panel [title]="settings.sources[key].label || key" hint="凭据只属于这个源；其它设置都在左侧。">
              <div panel-actions>
                @if (settings.sources[key].proxy_enabled) {
                  <span class="ui-badge blue">经代理</span>
                } @else {
                  <span class="ui-badge gray">直连</span>
                }
              </div>
              <div class="form-grid">
                <ui-field label="Access Token">
                  <input type="password" [(ngModel)]="settings.sources[key].token" placeholder="私有仓库需要">
                </ui-field>
                <ui-field label="启用代理">
                  <div class="check-row">
                    <input type="checkbox" [(ngModel)]="settings.sources[key].proxy_enabled">
                    <span>下载时经全局代理</span>
                  </div>
                </ui-field>
                @if (key === 'civitai') {
                  <ui-field label="完整目录（CivitAI Red）">
                    <div class="check-row">
                      <input type="checkbox" [(ngModel)]="settings.sources[key].full_catalog">
                      <span>含成熟内容（18+，部分地区依法受限）</span>
                    </div>
                  </ui-field>
                }
                @if (key === 'huggingface') {
                  <ui-field label="镜像站（hf-mirror）">
                    <input [(ngModel)]="settings.sources[key].mirror" placeholder="https://hf-mirror.com">
                  </ui-field>
                  <ui-field label="优先使用镜像">
                    <div class="check-row">
                      <input type="checkbox" [(ngModel)]="settings.sources[key].use_mirror">
                      <span>解析与下载优先走镜像</span>
                    </div>
                  </ui-field>
                }
              </div>
            </ui-panel>
          }
        </div>
      </div>

      <div class="save-bar">
        <button class="primary" (click)="save()" [disabled]="saving">{{ saving ? '保存中…' : '保存设置' }}</button>
        @if (message) {
          <span class="notice is-inline" [ngClass]="messageOk ? 'ok' : 'err'">{{ message }}</span>
        } @else {
          <span class="muted save-hint">改动不会自动保存，确认后再点一次。</span>
        }
      </div>
    }
  `,
  styles: [
    `
      .path-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .path-row input { flex: 1; min-width: 0; }
      .path-row button { flex: none; }
      .save-hint { font-size: 11.5px; }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  settings: AppSettings | null = null;
  sourceKeys: string[] = [];
  saving = false;
  message = '';
  messageOk = true;
  proxyResult: { ok: boolean; text: string } | null = null;
  familyScan: FamilyScanStatus | null = null;
  familyScanning = false;

  strategyOptions = [
    { value: 'direct', label: 'direct - 直连' },
    { value: 'mirror', label: 'mirror - 多站点分片' },
    { value: 'sdk', label: 'sdk - 官方 SDK' },
  ];

  constructor(private api: ApiService) {}

  readonly proxyUrl = proxyUrl;

  ngOnInit(): void {
    this.loadFamilyScan();
    this.api.getSettings().subscribe((s) => {
      this.settings = s;
      // demo / templates / comfyhub 都是免鉴权固定源，没有可配置项，别列进设置页
      this.sourceKeys = Object.keys(s.sources || {}).filter(
        (k) => k !== 'demo' && k !== 'templates' && k !== 'comfyhub',
      );
    });
  }

  // ---------------- 厂标资产巡检 ----------------

  /** 需要人看的家族：上游改了版，或抓不到了。 */
  familyAttention(): FamilyAttention[] {
    return this.familyScan?.attention ?? [];
  }

  familyScanText(): string {
    const s = this.familyScan;
    if (!s || !s.lastScanAt) return '尚未巡检';
    const sum = s.summary ?? {};
    // 「自动检查 n/17」= 有多少个厂牌的上游真被拉下来比对过。
    // 不是「已处理好 n 个」—— 剩下那些是没官方资产或没登记可抓地址，本来就查不了。
    const checked = sum.upToDate ?? 0;
    const total = sum.families ?? 0;
    const pending = (sum.drifted ?? 0) + (sum.unreachable ?? 0);
    return `上次 ${fmtScanTime(s.lastScanAt)} · 自动检查 ${checked}/${total} 个厂牌${
      pending ? ` · ${pending} 项待处理` : ' · 无待处理'
    }`;
  }

  loadFamilyScan(): void {
    this.api.familyScanStatus().subscribe({
      next: (s) => {
        this.familyScan = s;
        this.familyScanning = false;
      },
      error: () => {
        this.familyScanning = false;
      },
    });
  }

  scanFamilies(force = false): void {
    this.familyScanning = true;
    this.api.triggerFamilyScan(force).subscribe({
      next: () => {
        // 巡检在后端后台线程里跑，等它落盘后再拉一次状态
        setTimeout(() => this.loadFamilyScan(), 1500);
      },
      error: () => {
        this.familyScanning = false;
      },
    });
  }

  save(): void {
    if (!this.settings) return;
    this.saving = true;
    this.api.saveSettings(this.settings).subscribe({
      next: () => {
        this.saving = false;
        this.message = '设置已保存';
        this.messageOk = true;
      },
      error: (err) => {
        this.saving = false;
        this.message = errMsg(err, '保存失败');
        this.messageOk = false;
      },
    });
  }

  testProxy(): void {
    const url = proxyUrl(this.settings?.proxy);
    this.proxyResult = null;
    this.api.testProxy(url).subscribe({
      next: (res) => {
        const proxy = res.proxy;
        const direct = res.direct;
        const text = `代理 ${proxy.ok ? '可用' : '不可用'}（${proxy.status ?? proxy.error ?? '-'}，${proxy.latency_ms}ms）｜直连 ${direct.ok ? '可用' : '不可用'}（${direct.latency_ms}ms）`;
        this.proxyResult = { ok: !!proxy.ok, text };
      },
      error: () => {
        this.proxyResult = { ok: false, text: '测试失败' };
      },
    });
  }

  browseSaveDir(): void {
    const current = this.settings?.download?.save_dir || '';
    this.api.browseFolder(current).subscribe({
      next: (res) => {
        if (res.path && this.settings) {
          this.settings.download.save_dir = res.path;
        } else if (res.error) {
          this.message = res.error;
          this.messageOk = false;
        }
      },
      error: () => {
        this.message = '无法打开目录选择框';
        this.messageOk = false;
      },
    });
  }
}
