import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../core/theme.service';
import { LibraryModel, SearchItem } from '../core/types';
import { BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { FieldComponent } from '../ui/field.component';
import { LibraryCardComponent } from '../ui/library-card.component';
import { ModelCardComponent } from '../ui/model-card.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';
import { WorkflowCardComponent } from '../ui/workflow-card.component';
import { LocalWorkflow } from '../core/types';

/**
 * VIS 组件参考页（Angular 版）。
 *
 * 与 artifacts/vis/vis-reference.html 的分工：
 *   · 那一页是**单文件静态版** —— 双击即开，给设计师 / 外部协作者 / CI 看
 *   · 这一页是**产品同源版** —— 直接 import ui/ 里的真实组件渲染，
 *     开发者在这里看到的就是产品里真正在跑的东西
 *
 * 两者内容同源：数值都从 web/src/styles.css 与组件 scoped 样式来，
 * 静态版是一次性快照（原生成脚本已不存在），有差异以产品源码为准。
 *
 * 路由：/lab/vis —— 与 /lab/primeng、/lab/tailwind 同级，
 * 属实验区，**不属于产品导航**。
 */
@Component({
  selector: 'app-lab-vis',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    BadgeComponent,
    PanelComponent,
    EmptyComponent,
    FieldComponent,
    PageHeaderComponent,
    ModelCardComponent,
    LibraryCardComponent,
    WorkflowCardComponent,
  ],
  template: `
    <div class="vis-ref">
      <ui-page-header
        kicker="VIS v2.5"
        title="组件参考页"
        hint="本页直接渲染 ui/ 下的真实组件 —— 看到的就是产品在跑的。静态单文件版见 artifacts/vis/vis-reference.html。"
      >
        <button class="btn-toggle" type="button" (click)="toggle()">切换到{{ next() }}主题</button>
        <a class="btn-toggle" routerLink="/lab/primeng">对照实验 A →</a>
      </ui-page-header>

      <p class="vis-note">
        本页属<strong>实验区</strong>，不属于产品导航 —— 与 <code>/lab/primeng</code>、
        <code>/lab/tailwind</code> 同级。
      </p>

      <!-- ══════════════ 按钮 ══════════════ -->
      <ui-panel kicker="Components" title="按钮 —— 全部状态">
        <p class="vis-hint">
          VIS §6.4 定的 8 态：默认 / hover / focus-visible / active·selected / disabled /
          loading / error / empty。hover 与 focus 请<b>真的把鼠标移上去 / 用 Tab 键走一遍</b> ——
          这一页是真实交互，不是静态样张。
        </p>

        <div class="vis-row">
          <span class="vis-row-label">默认</span>
          <button type="button">默认</button>
          <button class="primary" type="button">主操作</button>
          <button class="ghost" type="button">文字按钮</button>
          <button class="danger" type="button">危险</button>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">disabled</span>
          <button type="button" disabled>禁用</button>
          <button class="primary" type="button" disabled>主操作</button>
          <button class="ghost" type="button" disabled>文字按钮</button>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">loading</span>
          <button class="primary" type="button" disabled>加载中…</button>
          <button type="button" disabled>处理中…</button>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">error</span>
          <button class="danger" type="button">重试</button>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">尺寸</span>
          <button class="primary" type="button">默认 32px</button>
          <button class="primary btn-xs" type="button">小号 25px</button>
        </div>
      </ui-panel>

      <!-- ══════════════ 表单 ══════════════ -->
      <ui-panel kicker="Components" title="输入框 —— 全部状态">
        <div class="vis-row">
          <span class="vis-row-label">默认</span>
          <ui-field label="下载源">
            <input type="text" placeholder="搜索模型关键词，如 qwen / lora / flux" />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">有值</span>
          <ui-field label="模型名">
            <input type="text" value="flux1-dev" />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">readonly</span>
          <ui-field label="已安装路径">
            <input type="text" value="/models/flux1-dev.safetensors" readonly />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">disabled</span>
          <ui-field label="环境名">
            <input type="text" value="默认实例" disabled />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">单选块</span>
          <label class="radio-row"><input type="radio" name="vis-radio" checked /><span>已选中</span></label>
          <label class="radio-row"><input type="radio" name="vis-radio" /><span>未选中</span></label>
        </div>
      </ui-panel>

      <!-- ══════════════ chip / 徽章 ══════════════ -->
      <ui-panel kicker="Components" title="chip / 胶囊 / 徽章">
        <p class="vis-hint">
          §3.7.2：<b>.badge = 状态</b>（带语义色），<b>.pill = 分类</b>（一律中性）。
          分类标签常并列很多个，用语义色会变成一墙红黄绿。
        </p>

        <div class="vis-row">
          <span class="vis-row-label">filter chip</span>
          <span class="filter-chip">全部</span>
          <span class="filter-chip">已安装</span>
          <span class="filter-chip active">已选中</span>
          <span class="filter-chip">全部 <span class="chip-count">128</span></span>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">chip</span>
          <span class="chip">文生图</span>
          <span class="chip">LoRA</span>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">pill</span>
          <span class="pill">文生图</span>
          <span class="pill">LoRA</span>
          <span class="pill">VAE</span>
          <span class="pill-outlined">HF</span>
          <span class="pill pill-count">+4</span>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">徽章</span>
          <ui-badge tone="gray">未登记</ui-badge>
          <ui-badge tone="blue">已在库</ui-badge>
          <ui-badge tone="green">已安装</ui-badge>
          <ui-badge tone="orange">已禁用</ui-badge>
          <ui-badge tone="red">错误</ui-badge>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">分段控件</span>
          <div class="segmented">
            <button type="button">全部</button>
            <button type="button" class="active">已安装</button>
            <button type="button">未安装</button>
          </div>
        </div>
      </ui-panel>

      <!-- ══════════════ 反馈态 ══════════════ -->
      <ui-panel kicker="Components" title="空状态 / 加载 / 错误" hint="空态、加载、错误三类反馈的统一表达。">
        <div class="vis-cols">
          <ui-empty
            icon="◍"
            title="还没有模型"
            hint="去「发现」页挑一个，或把文件放进 models/ 目录。"
          >
            <button class="primary btn-xs" type="button">去发现页</button>
          </ui-empty>

          <div class="vis-stack">
            <div class="loading-line"><span class="dot-spin"></span><span>正在读取模型列表…</span></div>
            <div class="progress" style="width:100%"><div style="width:62%"></div></div>
            <div class="notice err">删除失败：目录被占用，关闭占用程序后重试</div>
            <div class="notice ok">已安装到实例 A</div>
            <div class="notice info">下载源已切换到 Hugging Face</div>
          </div>
        </div>
      </ui-panel>

      <!-- ══════════════ 表格 ══════════════ -->
      <ui-panel kicker="Components" title="表格">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">模型</th>
                <th scope="col">来源</th>
                <th scope="col" class="col-size">大小</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="cell-name">flux1-dev.safetensors</td>
                <td>Hugging Face</td>
                <td class="col-size">11.9 GB</td>
                <td><ui-badge tone="green">已安装</ui-badge></td>
              </tr>
              <tr>
                <td class="cell-name">wan22-t2v.safetensors</td>
                <td>ModelScope</td>
                <td class="col-size">24.5 GB</td>
                <td><ui-badge tone="gray">未登记</ui-badge></td>
              </tr>
              <tr>
                <td class="cell-name">sd15-pruned.safetensors</td>
                <td>Civitai</td>
                <td class="col-size">4.1 GB</td>
                <td><ui-badge tone="orange">已禁用</ui-badge></td>
              </tr>
            </tbody>
          </table>
        </div>
      </ui-panel>

      <!-- ══════════════ 弹层 ══════════════ -->
      <ui-panel kicker="Components" title="弹层（静态样张）">
        <p class="vis-hint">弹层是唯一用 16px 圆角的地方（VIS §6.2 登记例外 1）。</p>
        <div class="vis-modal-stage">
          <div class="modal-overlay">
            <div class="modal">
              <div class="modal-head"><span class="mc-title">安装环境</span></div>
              <p style="margin:0 0 12px;font-size:12.5px;color:var(--muted)">
                这是一张静态样张，不是真的模态 —— 弹层的焦点陷阱与 Esc 行为要进产品页验证。
              </p>
              <div class="modal-foot">
                <button class="primary" type="button">开始安装</button>
                <button type="button">取消</button>
              </div>
            </div>
          </div>
        </div>
      </ui-panel>

      <!-- ══════════════ 卡片 ══════════════ -->
      <ui-panel kicker="Components" title="卡片 —— 真实组件">
        <p class="vis-hint">
          下面是<b>真实组件</b>：<code>md-model-card</code> / <code>md-library-card</code> /
          <code>app-workflow-card</code>。数据是本页造的假数据，但组件与样式是真的。
        </p>

        <h3 class="vis-sub">工作流卡 —— 四种态</h3>
        <div class="vis-cards">
          @for (wf of workflows; track wf.name) {
            <app-workflow-card [it]="wf" />
          }
        </div>

        <h3 class="vis-sub">模型卡（md-model-card）</h3>
        <div class="vis-cards">
          @for (m of searchItems; track m.id) {
            <md-model-card [items]="[m]" />
          }
        </div>

        <h3 class="vis-sub">模型库卡（md-library-card）</h3>
        <div class="vis-cards">
          @for (m of libraryModels; track m.id) {
            <md-library-card [model]="m" />
          }
        </div>
      </ui-panel>

      <!-- ══════════════ 布局 ══════════════ -->
      <ui-panel kicker="Layout" title="圆角 / 间距 / 阴影">
        <h3 class="vis-sub">圆角三档（§6.2）</h3>
        <div class="vis-radios">
          <div class="vis-radio">
            <div class="vis-radio-box" style="border-radius:var(--radius)">12px</div>
            <span>面板、模型卡、任务条</span>
          </div>
          <div class="vis-radio">
            <div class="vis-radio-box" style="border-radius:var(--radius-sm)">8px</div>
            <span>按钮、输入、导航项</span>
          </div>
          <div class="vis-radio">
            <div class="vis-radio-box" style="border-radius:var(--radius-xs)">5px</div>
            <span>chip、badge、骨架</span>
          </div>
        </div>

        <h3 class="vis-sub">阴影三档（§6.3）</h3>
        <div class="vis-shadows">
          <div class="vis-shadow" style="box-shadow:var(--shadow-sm)"><span>--shadow-sm</span></div>
          <div class="vis-shadow" style="box-shadow:var(--shadow-md)"><span>--shadow-md</span></div>
          <div class="vis-shadow" style="box-shadow:var(--shadow-lg)"><span>--shadow-lg</span></div>
        </div>
      </ui-panel>

      <!-- ══════════════ 标识 ══════════════ -->
      <ui-panel kicker="Brand" title="标识">
        <p class="vis-hint">
          VIS §2.0：蝉形是<b>辅助图形</b>，只出现在 favicon 与侧栏组合标两处 ——
          页头 / 空状态 / 弹层 / 错误态都不许进。
        </p>
        <div class="vis-brand">
          <span class="brand-mark" aria-hidden="true">
            <img class="logo-light" src="/brand/cicada-max.svg" alt="" />
            <img class="logo-dark" src="/brand/cicada-max-dark.svg" alt="" />
          </span>
          <span class="lv-wordmark">
            SiMuseor
            <small class="lv-sub">剧集导演台</small>
          </span>
        </div>
        <div class="vis-fav">
          <img src="/brand/png/favicon-16.png" alt="favicon 16px" width="16" height="16" />
          <img src="/brand/png/favicon-32.png" alt="favicon 32px" width="32" height="32" />
          <img src="/brand/png/favicon-48.png" alt="favicon 48px" width="48" height="48" />
          <img src="/brand/png/favicon-64.png" alt="favicon 64px" width="64" height="64" />
        </div>
      </ui-panel>
    </div>
  `,
  styles: `
    .vis-ref { max-width: 1240px; margin: 0 auto; padding: 26px 28px 72px; }
    .vis-note {
      margin: 0 0 16px; padding: 8px 12px;
      border-left: 2px solid var(--accent-line);
      background: var(--panel-3); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      font-size: 12px; color: var(--muted);
    }
    .vis-hint {
      margin: 0 0 12px; font-size: 12px; color: var(--muted);
      padding: 8px 12px;
      border-left: 2px solid var(--border);
      background: var(--panel-2); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    }
    .vis-hint b { color: var(--text-2); }
    .vis-row {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      padding: 8px 0; border-bottom: 1px dashed var(--border-soft);
    }
    .vis-row:last-child { border-bottom: 0; }
    .vis-row-label {
      flex: none; width: 92px;
      font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
      color: var(--muted);
    }
    .vis-row ui-field { flex: 0 1 320px; min-width: 240px; }
    .vis-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .vis-stack { display: flex; flex-direction: column; gap: 8px; justify-content: center; }
    .vis-sub { margin: 20px 0 10px; font-size: 12.5px; font-weight: 600; color: var(--text-2); }
    .vis-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
    .vis-radios { display: flex; flex-wrap: wrap; gap: 16px; }
    .vis-radio { text-align: center; }
    .vis-radio-box {
      width: 132px; height: 76px; margin-bottom: 6px;
      background: var(--accent-soft); border: 1px solid var(--accent-line);
      display: grid; place-items: center;
      color: var(--accent); font-size: 12px; font-weight: 600;
    }
    .vis-radio span { font-size: 10.5px; color: var(--muted); }
    .vis-shadows { display: flex; flex-wrap: wrap; gap: 18px; }
    .vis-shadow {
      width: 180px; height: 72px;
      border-radius: var(--radius); background: var(--panel); border: 1px solid var(--border);
      display: grid; place-items: center;
    }
    .vis-shadow span { font-family: "Cascadia Mono", Consolas, monospace; font-size: 10.5px; color: var(--muted); }
    .vis-brand {
      display: flex; align-items: baseline; gap: 10px;
      padding: 18px 20px; margin-bottom: 14px;
      background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    }
    .vis-fav { display: flex; gap: 20px; align-items: flex-end; padding: 12px 0; }
    .btn-toggle {
      height: 30px; padding: 0 12px;
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--panel); color: var(--text-2);
      font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
      display: inline-flex; align-items: center; text-decoration: none;
    }
    .btn-toggle:hover { background: var(--hover); border-color: var(--border-strong); color: var(--text); }

    /* 弹层样张：真实 .modal-overlay 是 position:fixed + inset:0，
       会盖住整屏（真弹层就该这样）。这里改成静态容器，只留遮罩的观感。 */
    .vis-modal-stage {
      position: relative; overflow: hidden;
      border-radius: var(--radius-sm);
    }
    .vis-modal-stage .modal-overlay {
      position: absolute; inset: 0;
      display: grid; place-items: center; padding: 24px;
    }
    .vis-modal-stage .modal { max-height: none; width: min(680px, 100%); }
    /* 参考页的品牌位演示。
       刻意**不**复用全局 .brand-wordmark / .brand-sub ——
       VIS Phase2 §1.1 规定「全站 .brand-wordmark 有且仅有 1 个实例
       （侧栏品牌位）」，参考页若也用它就变成 2 个，违反该约束
       （vis-check.mjs 1.5 项会判 FAIL）。此处用独立类名 lv- 前缀，
       视觉口径与全局一致：Barlow Condensed 400 / 20px / letter-spacing .028em。 */
    .lv-wordmark {
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-family: "Barlow Condensed", "Segoe UI", system-ui, sans-serif;
      font-size: 20px;
      font-weight: 400;
      letter-spacing: 0.028em;
      line-height: 1;
      white-space: nowrap;
      color: var(--text);
    }
    .lv-sub {
      font-family: "Inter", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.4;
      color: var(--muted);
    }
  `,
})
export class LabVisComponent {
  constructor(private theme: ThemeService) {}

  toggle(): void {
    this.theme.toggle();
  }

  next(): string {
    return this.theme.theme() === 'dark' ? '浅色' : '深色';
  }

  /** 假数据 —— 组件与样式是真的，数据是为了让它们渲染出东西。 */
  readonly searchItems: SearchItem[] = [
    {
      id: 'flux1-dev',
      name: 'flux1-dev.safetensors',
      author: 'black-forest-labs',
      source: 'Hugging Face',
      description: 'FLUX.1 dev 权重',
      downloads: 128400,
      likes: 2400,
      tags: ['文生图', 'FLUX'],
      task: '文生图',
      url: '',
      updated_at: '2026-11-10',
    },
    {
      id: 'wan22-t2v',
      name: 'wan22-t2v.safetensors',
      author: 'Wan-AI',
      source: 'ModelScope',
      description: 'WAN 2.2 视频生成',
      downloads: 86400,
      likes: 1200,
      tags: ['文生视频', 'WAN'],
      task: '文生视频',
      url: '',
      updated_at: '2026-11-08',
    },
  ];

  readonly libraryModels: LibraryModel[] = [
    {
      id: 'sdxl-realvis',
      name: 'RealVisXL_V4.0_lightning.safetensors',
      repo_id: 'x',
      source: 'Civitai',
      local_path: '/models/RealVisXL_V4.0_lightning.safetensors',
      size_bytes: 68719476736,
      file_count: 1,
      tags: ['文生图', 'SDXL'],
      created_at: '2026-11-01',
      files: [],
      params: '6B',
    },
    {
      id: 'ltx-video',
      name: 'ltx-video-0.9.7-distilled.safetensors',
      repo_id: 'x',
      source: 'Hugging Face',
      local_path: '/models/ltx-video-0.9.7-distilled.safetensors',
      size_bytes: 5583457487,
      file_count: 1,
      tags: ['文生视频', 'LTX'],
      created_at: '2026-10-28',
      files: [],
      params: '2B',
    },
  ];

  /**
   * 工作流卡的四态：ready / api / missing / broken。
   * state() 由 format 与缺依赖数决定（workflow-card.component.ts:525）。
   */
  readonly workflows: LocalWorkflow[] = [
    {
      name: 'wan22-t2v.json',
      path: '/workflows/wan22-t2v.json',
      folder: '',
      size: 24576000,
      mtime: 1763136000,
      nodes: 12,
      format: 'ui',
      main_model: 'wan2.2-t2v.safetensors',
      group: '视频',
      model_slots: [],
      deps: { have: [], missing: [] },
      node_deps: { have: [], missing: [], unknown: [] },
    },
    {
      name: 'flux1-dev.json',
      path: '/workflows/flux1-dev.json',
      folder: '',
      size: 12781585,
      mtime: 1763222400,
      nodes: 8,
      format: 'ui',
      main_model: 'flux1-dev.safetensors',
      model_slots: [],
      deps: { have: [], missing: [] },
      node_deps: { have: [], missing: [], unknown: [] },
    },
    {
      name: 'qwen-txt2img.json',
      path: '/workflows/qwen-txt2img.json',
      folder: '',
      size: 4404019,
      mtime: 1763136000,
      nodes: 6,
      format: 'ui',
      main_model: 'qwen-image.safetensors',
      group: '文生图',
      model_slots: [],
      deps: {
        have: [],
        missing: [
          { file: 'qwen-image.safetensors', node: 'UNETLoader', directory: 'diffusion_models', url: '' },
        ],
      },
      node_deps: { have: [], missing: [], unknown: [] },
    },
    {
      name: 'broken-workflow.json',
      path: '/workflows/broken-workflow.json',
      folder: '',
      size: 1126,
      mtime: 1763222400,
      nodes: 0,
      format: 'broken',
      main_model: '',
      error: 'JSON 语法错误：第 12 行缺少逗号',
      model_slots: [],
      deps: { have: [], missing: [] },
      node_deps: { have: [], missing: [], unknown: [] },
    },
  ];
}
