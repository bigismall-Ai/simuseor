import { UiButtonComponent } from '../../ui/button';
import { Component, signal } from '@angular/core';
import { UiMaterialModule } from '../../ui/material';
import { PageHeaderComponent } from '../../ui/page-header';
import { ProtoShellComponent } from './proto-shell';

interface Location {
  key: string;
  label: string;
  size: string;
  active?: boolean;
}

interface AssetRow {
  id: string;
  name: string;
  folder: string;
  type: string;
  size: string;
  modified: string;
  link: string;
  tone: 'green' | 'blue' | 'orange' | 'gray';
  checksum: string;
  refs: string[];
}

/** VIS 原型 · 资源管理器：背景层在真实布局里的第一张样张。 */
@Component({
  selector: 'app-proto-resource-manager',
  standalone: true,
  imports: [PageHeaderComponent, ProtoShellComponent, UiButtonComponent, UiMaterialModule],
  styleUrl: './resource-manager.scss',
  template: `
    <app-proto-shell active="resources" title="资源 / 本机" hint="按目录浏览模型、工作流与节点">
      <ui-page-header
        kicker="ASSETS · RESOURCES"
        title="资源管理器"
        hint="按目录查看本机资产的实际落点、占用和可清理项。删除只动文件，不改模型库与工作流索引。"
      >
        <ui-button variant="secondary" type="button">在文件中打开</ui-button>
        <ui-button variant="primary" type="button">重新扫描</ui-button>
      </ui-page-header>

      <section class="rm-stats" aria-label="占用概览">
        @for (stat of stats; track stat.label) {
          <div class="stat" [class.warn]="stat.tone === 'warn'">
            <span>{{ stat.label }}</span>
            <b>{{ stat.value }}</b>
            <small>{{ stat.meta }}</small>
          </div>
        }
      </section>

      <div class="rm-layout">
        <aside class="rm-panel" aria-label="位置">
          <div class="rm-panel-head">
            <h2>位置</h2>
            <span>5 个根</span>
          </div>
          <div class="tree">
            @for (loc of locations; track loc.key) {
              <button
                class="tree-item"
                type="button"
                [class.active]="activeKey() === loc.key"
                (click)="activeKey.set(loc.key)"
              >
                <span class="tree-mark" aria-hidden="true"></span>
                <span class="tree-label">{{ loc.label }}</span>
                <span class="tree-size">{{ loc.size }}</span>
              </button>
            }
          </div>
          <div class="tree-foot">
            <span class="status-dot" aria-hidden="true"></span>
            磁盘可用 2.1 TB
          </div>
        </aside>

        <section class="rm-panel" aria-label="文件列表">
          <div class="rm-panel-head">
            <h2>模型 / 扩散模型</h2>
            <span>6 个文件 · 45.6 GB</span>
          </div>
          <div class="rm-table-wrap">
            <table class="rm-table">
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  <th scope="col">类型</th>
                  <th scope="col" class="num">大小</th>
                  <th scope="col">修改时间</th>
                  <th scope="col">引用</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows; track row.id) {
                  <tr
                    [class.selected]="selected().id === row.id"
                    (click)="selected.set(row)"
                  >
                    <td>
                      <span class="file-name">{{ row.name }}</span>
                      <small>{{ row.folder }}</small>
                    </td>
                    <td>{{ row.type }}</td>
                    <td class="num mono">{{ row.size }}</td>
                    <td class="muted">{{ row.modified }}</td>
                    <td><span class="badge" [class]="'badge ' + row.tone">{{ row.link }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="rm-table-foot">
            <span>已选中 1 个 · 45.6 GB</span>
            <span class="muted">按大小排序</span>
          </div>
        </section>

        <aside class="rm-panel detail" aria-label="文件详情">
          <div class="rm-panel-head">
            <h2>文件详情</h2>
            <span>只读</span>
          </div>
          <div class="detail-body">
            <div class="detail-cover" aria-hidden="true">
              <span class="mono">SAFETENSORS</span>
            </div>
            <b class="detail-name">{{ selected().name }}</b>
            <span class="detail-path mono">{{ selected().folder }}/{{ selected().name }}</span>

            <dl class="detail-list">
              <div><dt>大小</dt><dd class="mono">{{ selected().size }}</dd></div>
              <div><dt>修改</dt><dd>{{ selected().modified }}</dd></div>
              <div><dt>校验</dt><dd class="mono">{{ selected().checksum }}</dd></div>
              <div><dt>引用</dt><dd>{{ selected().refs.length }} 个工作流</dd></div>
            </dl>

            <div class="detail-refs">
              @for (ref of selected().refs; track ref) {
                <span class="ref-pill">{{ ref }}</span>
              }
            </div>

            <div class="detail-actions">
              <ui-button variant="secondary" type="button">定位</ui-button>
              <ui-button variant="danger" type="button">删除</ui-button>
            </div>
          </div>
        </aside>
      </div>
    </app-proto-shell>
  `,
})
export class ProtoResourceManagerComponent {
  readonly activeKey = signal('models');

  readonly stats = [
    { label: '总占用', value: '386.4 GB', meta: '本机 5 个根目录', tone: 'normal' },
    { label: '模型权重', value: '362.1 GB', meta: '128 个文件', tone: 'normal' },
    { label: '工作流', value: '1.2 GB', meta: '46 个文件', tone: 'normal' },
    { label: '自定义节点', value: '18.3 GB', meta: '12 个仓库', tone: 'normal' },
    { label: '可清理', value: '4.8 GB', meta: '缓存与失联文件', tone: 'warn' },
  ];

  readonly locations: Location[] = [
    { key: 'models', label: '模型', size: '362.1 GB', active: true },
    { key: 'workflows', label: '工作流', size: '1.2 GB' },
    { key: 'nodes', label: '自定义节点', size: '18.3 GB' },
    { key: 'io', label: '输入 / 输出', size: '4.8 GB' },
    { key: 'cache', label: '缓存', size: '0.9 GB' },
  ];

  readonly rows: AssetRow[] = [
    {
      id: 'flux',
      name: 'flux1-dev.safetensors',
      folder: 'models/diffusion_models',
      type: '扩散模型',
      size: '23.8 GB',
      modified: '2 天前',
      link: '已引用',
      tone: 'green',
      checksum: 'sha256:8f3c…a1d2',
      refs: ['文生视频 · 短镜头', 'FLUX 图生图'],
    },
    {
      id: 'sdxl',
      name: 'sd_xl_base_1.0.safetensors',
      folder: 'models/diffusion_models',
      type: '扩散模型',
      size: '6.9 GB',
      modified: '5 天前',
      link: '已引用',
      tone: 'green',
      checksum: 'sha256:31b2…77e0',
      refs: ['角色一致性工作台'],
    },
    {
      id: 'wan',
      name: 'wan2.2_t2v_14b.safetensors',
      folder: 'models/diffusion_models',
      type: '视频模型',
      size: '14.2 GB',
      modified: '昨天',
      link: '未引用',
      tone: 'gray',
      checksum: 'sha256:0c9d…4f18',
      refs: [],
    },
    {
      id: 'clip',
      name: 'clip_l.safetensors',
      folder: 'models/text_encoders',
      type: '文本编码器',
      size: '246 MB',
      modified: '2 周前',
      link: '已引用',
      tone: 'green',
      checksum: 'sha256:6a11…9c3e',
      refs: ['文生视频 · 短镜头', 'FLUX 图生图', '角色一致性工作台'],
    },
    {
      id: 'vae',
      name: 'ae.safetensors',
      folder: 'models/vae',
      type: 'VAE',
      size: '335 MB',
      modified: '2 周前',
      link: '已引用',
      tone: 'green',
      checksum: 'sha256:2d84…b6f7',
      refs: ['文生视频 · 短镜头'],
    },
    {
      id: 'lora',
      name: 'orphan_lora_v3.safetensors',
      folder: 'models/loras',
      type: 'LoRA',
      size: '128 MB',
      modified: '3 个月前',
      link: '失联',
      tone: 'orange',
      checksum: 'sha256:aa02…51be',
      refs: [],
    },
  ];

  readonly selected = signal<AssetRow>(this.rows[0]);
}
