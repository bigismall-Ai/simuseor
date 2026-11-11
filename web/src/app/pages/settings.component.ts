import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AppSettings, errMsg, proxyUrl } from '../core/types';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header title="设置" hint="下载源凭据、代理与 aria2 内核参数。" />

    @if (settings) {
      <div class="settings-cols">
        <div class="col">
          <ui-panel title="模型下载目录" hint="下载产物保存位置，默认 models（相对项目目录）。">
            <input class="mono" [value]="settings.download.save_dir" readonly placeholder="models">
            <button class="mt" (click)="browseSaveDir()">选择文件夹</button>
          </ui-panel>

          <ui-panel title="aria2 配置 + 默认策略" hint="内核参数与默认下载策略对所有下载源生效。">
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

          <ui-panel title="代理配置" hint="启用代理的下载源经此代理下载。">
            <div class="form-grid">
              <ui-field label="IP 或 网址">
                <input [(ngModel)]="settings.proxy.host" placeholder="127.0.0.1">
              </ui-field>
              <ui-field label="端口">
                <input type="number" [(ngModel)]="settings.proxy.port" placeholder="7890">
              </ui-field>
            </div>
            <button class="mt" (click)="testProxy()">测试代理</button>
            @if (proxyResult) {
              <div class="notice" [ngClass]="proxyResult.ok ? 'ok' : 'err'">{{ proxyResult.text }}</div>
            }
          </ui-panel>
        </div>

        <div class="col">
          @for (key of sourceKeys; track key) {
            <ui-panel [title]="settings.sources[key].label || key" hint="token 与代理开关按源配置；保存路径、代理与默认策略在左侧统一设置。">
              <div class="form-grid">
                <ui-field label="Access Token">
                  <input type="password" [(ngModel)]="settings.sources[key].token" placeholder="私有仓库需要">
                </ui-field>
                <ui-field label="启用代理">
                  <div class="check-row">
                    <input type="checkbox" [(ngModel)]="settings.sources[key].proxy_enabled">
                    <span>启用后该源下载经全局代理</span>
                  </div>
                </ui-field>
                @if (key === 'civitai') {
                  <ui-field label="完整目录（CivitAI Red）">
                    <div class="check-row">
                      <input type="checkbox" [(ngModel)]="settings.sources[key].full_catalog">
                      <span>含成熟内容（nsfw 参数；18+，部分地区依法受限）</span>
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
          <span class="notice inline" [ngClass]="messageOk ? 'ok' : 'err'">{{ message }}</span>
        }
      </div>
    }
  `,
})
export class SettingsComponent implements OnInit {
  settings: AppSettings | null = null;
  sourceKeys: string[] = [];
  saving = false;
  message = '';
  messageOk = true;
  proxyResult: { ok: boolean; text: string } | null = null;

  strategyOptions = [
    { value: 'direct', label: 'direct - 直连' },
    { value: 'mirror', label: 'mirror - 多站点分片' },
    { value: 'sdk', label: 'sdk - 官方 SDK' },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe((s) => {
      this.settings = s;
      this.sourceKeys = Object.keys(s.sources || {}).filter((k) => k !== 'demo' && k !== 'templates');
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
