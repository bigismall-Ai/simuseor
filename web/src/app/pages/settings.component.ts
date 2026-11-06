import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AppSettings, errMsg } from '../core/types';
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
      <ui-panel title="全局" hint="保存路径、代理地址与默认下载策略对所有下载源生效。">
        <div class="form-grid">
          <ui-field label="默认保存路径">
            <div class="toolbar">
              <input class="grow mono" [value]="settings.download.save_dir" readonly placeholder="未设置">
              <button (click)="browseSaveDir()">选择文件夹…</button>
            </div>
          </ui-field>
          <ui-field label="代理地址">
            <div class="toolbar">
              <input class="grow" [(ngModel)]="settings.proxy.url" placeholder="http://127.0.0.1:7890">
              <button (click)="testProxy()">测试代理</button>
            </div>
          </ui-field>
          <ui-field label="默认策略">
            <select [(ngModel)]="settings.download.strategy">
              <option value="direct">direct - 直连</option>
              <option value="proxy">proxy - 代理</option>
              <option value="mirror">mirror - 多站点分片</option>
              <option value="sdk">sdk - 官方 SDK</option>
            </select>
          </ui-field>
          <ui-field label="aria2 单文件连接数 (-x)">
            <input type="number" [(ngModel)]="settings.aria2.connections">
          </ui-field>
          <ui-field label="aria2 分片数 (-s)">
            <input type="number" [(ngModel)]="settings.aria2.split">
          </ui-field>
          <ui-field label="aria2 RPC 端口">
            <input type="number" [(ngModel)]="settings.aria2.rpc_port">
          </ui-field>
        </div>

        @if (proxyResult) {
          <div class="notice" [ngClass]="proxyResult.ok ? 'ok' : 'err'">{{ proxyResult.text }}</div>
        }
      </ui-panel>

      @for (key of sourceKeys; track key) {
        <ui-panel [title]="settings.sources[key].label || key" hint="token 与代理开关按源配置；保存路径与代理地址在「全局」统一设置。">
          <div class="form-grid">
            <ui-field label="Access Token">
              <input type="password" [(ngModel)]="settings.sources[key].token" placeholder="私有仓库需要">
            </ui-field>
            <ui-field label="启用代理">
              <div class="check-row">
                <input type="checkbox" [(ngModel)]="settings.sources[key].proxy_enabled">
                <span>proxy 策略时该源经全局代理下载</span>
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

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe((s) => {
      this.settings = s;
      this.sourceKeys = Object.keys(s.sources || {}).filter((k) => k !== 'demo');
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
    const url = this.settings?.proxy?.url || '';
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
