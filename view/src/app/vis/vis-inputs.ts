import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { CheckboxComponent } from '../ui/checkbox';
import { FieldComponent } from '../ui/field';
import { InputComponent } from '../ui/input';
import { SelectComponent } from '../ui/select';
import type { SelectOption } from '../ui/select';
import { SettingRowComponent } from '../ui/setting-row';
import { SwitchComponent } from '../ui/switch';
import { TextareaComponent } from '../ui/textarea';
import { UiMaterialModule } from '../ui/material';
import { RulesComponent } from '../ui/rules';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';
import { TextComponent } from '../ui/text';

/** 输入：文本 / 选择 / 多行 / 勾选 / 开关五种共享控件，Material 只留邮箱校验与单选示例。 */
@Component({
  selector: 'app-vis-inputs',
  imports: [
    CheckboxComponent,
    FieldComponent,
    InputComponent,
    ReactiveFormsModule,
    RulesComponent,
    SectionBlockComponent,
    SelectComponent,
    SettingRowComponent,
    SwitchComponent,
    TextareaComponent,
    TextComponent,
    UiMaterialModule,
    VisualPageComponent,
  ],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="输入框"
      hint="文本走 ui-input，选择走 ui-select，多行走 ui-textarea，勾选走 ui-checkbox，立即生效的开关走 ui-switch；标签、说明与错误由控件自己承担。"
    >
      <ui-section title="共享输入" pill="ui-input">
        <div class="field-grid">
          <ui-input label="模型 ID" placeholder="如 microsoft/Phi-3-mini-4k-instruct" />
          <ui-input label="Revision" value="main" />
          <ui-input
            label="仓库地址"
            [mono]="true"
            value="Comfy-Org/MiniMax-H3-Image"
            hint="支持粘贴完整仓库 URL。"
          />
          <ui-input label="代理端口" [mono]="true" inputmode="numeric" value="7890" />
          <ui-input
            label="仓库 ID"
            value="MiniMaxAI/MiniMax-H3"
            error="这个仓库不存在，检查拼写。"
          />
          <ui-input label="由系统托管" value="models/flux" [disabled]="true" />
        </div>
        <div class="field-grid field-grid-wide">
          <ui-input label="搜索模型" placeholder="搜索名称、来源或路径">
            <svg input-leading viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" />
              <path d="M10.3 10.3 13.6 13.6" />
            </svg>
          </ui-input>
          <ui-input label="保存目录" [mono]="true" value="models/flux">
            <span input-trailing>.safetensors</span>
          </ui-input>
        </div>
      </ui-section>

      <ui-section title="选择" pill="ui-select">
        <div class="field-grid">
          <ui-select
            label="下载源"
            placeholder="选一个来源"
            [options]="sources"
            [(value)]="source"
            hint="留空时按探针结果自动选。"
          >
            <svg select-leading viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.4 8a5.6 5.6 0 0 1 9.6-3.9M13.6 8a5.6 5.6 0 0 1-9.6 3.9" />
              <path d="M12 1.8v2.9h-2.9M4 14.2v-2.9h2.9" />
            </svg>
          </ui-select>
          <ui-select label="下载通路" size="sm" [options]="paths" [(value)]="path" />
          <ui-select
            label="缓存目录"
            [options]="caches"
            [value]="'models'"
            [disabled]="true"
            hint="由系统设置托管。"
          />
          <ui-select
            label="下载通路（校验失败）"
            [options]="paths"
            value="mirror"
            error="这条通路未启用，改选直连或代理。"
          />
        </div>
      </ui-section>

      <ui-section title="多行说明" pill="ui-textarea">
        <div class="field-grid">
          <ui-textarea
            label="备注"
            [rows]="3"
            placeholder="写给自己的备注，比如这张卡的训练参数"
            [(value)]="note"
            hint="只会保存在本地清单里。"
          />
          <ui-textarea
            label="失败原因"
            [rows]="4"
            value="连接被拒绝：目标端口未开放。"
            [disabled]="true"
          />
          <ui-textarea
            label="镜像地址"
            [rows]="2"
            value="https://hf-mirror.com"
            error="镜像地址需要以 http(s):// 开头。"
          />
        </div>
      </ui-section>

      <ui-section title="勾选" pill="ui-checkbox">
        <div class="choice-grid">
          <ui-checkbox [(checked)]="onlyWeights">只下载真实权重</ui-checkbox>
          <ui-checkbox [(checked)]="autoIndex">下载完成后自动入库</ui-checkbox>
          <ui-checkbox [(indeterminate)]="partial" [(checked)]="partialChecked">
            已选 3 / 8 个文件
          </ui-checkbox>
          <ui-checkbox [disabled]="true">自动更新（不可用）</ui-checkbox>
        </div>
      </ui-section>

      <ui-section title="开关" pill="ui-switch">
        <div class="choice-grid">
          <ui-switch label="深色主题跟随系统" [(checked)]="followSystem" />
          <ui-switch label="下载完成后校验哈希" size="sm" [(checked)]="verifyHash" />
          <ui-switch label="后台自动重试" [(checked)]="autoRetry" [disabled]="true" />
        </div>

        <div class="setting-demo">
          <ui-setting-row>
            <div settingText>
              <strong>代理优先</strong>
              <ui-text variant="hint">直连不通时自动改走本地代理。</ui-text>
            </div>
            <ui-switch settingControl ariaLabel="代理优先" [(checked)]="proxyFirst" />
          </ui-setting-row>
        </div>
      </ui-section>

      <ui-section title="外部标签" pill="ui-field">
        <ui-text variant="hint">
          控件自己没带标签时（筛选条、设置行）才用 ui-field 补一行外部标签；控件自带标签时不要再包一层，会出现两个标签。
        </ui-text>

        <div class="field-grid field-grid-wide">
          <ui-field label="来源（筛选用）">
            <ui-select [options]="sources" [(value)]="fieldSource" size="sm" />
          </ui-field>
          <ui-field label="备注（设置项用）">
            <ui-textarea [rows]="2" [(value)]="fieldNote" placeholder="只对自己可见" />
          </ui-field>
          <ui-field label="保留种子">
            <ui-checkbox [(checked)]="keepSeed" />
          </ui-field>
          <ui-field label="退出时提醒">
            <ui-switch [(checked)]="warnOnExit" />
          </ui-field>
        </div>
      </ui-section>

      <ui-section title="Material 补充" pill="Form field">
        <ui-text variant="hint">只剩邮箱校验与单选还用 Material；文本、选择、多行、勾选、开关不要再走这里。</ui-text>

        <div class="field-grid">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>邮箱</mat-label>
            <input matInput [formControl]="email" placeholder="name@example.com" />
            <mat-error>请输入邮箱地址</mat-error>
          </mat-form-field>

          <mat-radio-group value="stable" class="radio-col">
            <mat-radio-button value="stable">稳定版</mat-radio-button>
            <mat-radio-button value="nightly">每日构建</mat-radio-button>
          </mat-radio-group>
        </div>
      </ui-section>

      <ui-section title="选哪一个" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>ui-input</b>：一行文本；标签、说明、错误自带，两侧可投影图标与单位。</li>
          <li><b>ui-select</b>：选项超过 3 个、需要收纳；≤3 个互斥视图改用 <code>ui-segmented</code>。</li>
          <li>
            <b>ui-textarea</b>：两三行以上的备注与提示词；高度由 <code>rows</code> 定，不在页面里写高度。
          </li>
          <li><b>ui-checkbox</b>：需要再点保存的多选；整组未全选时用 <code>indeterminate</code>。</li>
          <li><b>ui-switch</b>：改完立即生效的二态设置；文案在左、开关在右时包 <code>ui-setting-row</code>。</li>
          <li>
            <b>ui-field</b>：只给没有自带标签的控件补外部标签；有标签的控件不要再包，避免两个标签。
          </li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisInputsComponent {
  readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });

  readonly source = signal('');
  readonly path = signal('proxy');
  readonly note = signal('');
  readonly fieldSource = signal('');
  readonly fieldNote = signal('');

  readonly onlyWeights = signal(true);
  readonly autoIndex = signal(false);
  readonly partial = signal(true);
  readonly partialChecked = signal(false);

  readonly followSystem = signal(true);
  readonly verifyHash = signal(true);
  readonly autoRetry = signal(false);
  readonly proxyFirst = signal(true);

  readonly keepSeed = signal(false);
  readonly warnOnExit = signal(true);

  readonly sources: SelectOption[] = [
    { value: 'hf', label: 'Hugging Face' },
    { value: 'modelscope', label: 'ModelScope' },
    { value: 'civitai', label: 'Civitai', disabled: true },
    { value: 'github', label: 'GitHub' },
  ];

  readonly paths: SelectOption[] = [
    { value: 'direct', label: '直连' },
    { value: 'proxy', label: '代理' },
    { value: 'mirror', label: '镜像' },
  ];

  readonly caches: SelectOption[] = [
    { value: 'models', label: 'models/' },
    { value: 'cache', label: 'cache/' },
  ];

  constructor() {
    this.email.markAsTouched();
  }
}
