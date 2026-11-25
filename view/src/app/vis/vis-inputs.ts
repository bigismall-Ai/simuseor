import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { InputComponent } from '../ui/input';
import { UiMaterialModule } from '../ui/material';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';
import { TextComponent } from '../ui/text';

/** 输入框：Material form-field / input / select / checkbox / radio。 */
@Component({
  selector: 'app-vis-inputs',
  standalone: true,
  imports: [
    TextComponent,
    InputComponent,
    ReactiveFormsModule,
    SectionBlockComponent,
    UiMaterialModule,
    VisualPageComponent,
  ],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="输入框"
      hint="文本输入走 ui-input（标签在上、错误在下）；选择、多行与勾选仍用 Material。"
    >
      <ui-section title="共享输入" pill="ui-input">
        <div class="field-grid">
          <ui-input label="模型 ID" placeholder="如 microsoft/Phi-3-mini-4k-instruct" />
          <ui-input label="Revision" value="main" />
          <ui-input label="仓库地址" [mono]="true" value="Comfy-Org/MiniMax-H3-Image" hint="支持粘贴完整仓库 URL。" />
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
      <ui-section title="Material 补充" pill="Form field">
          <ui-text variant="hint">仅在选择、多行、勾选这类 Material 原生控件上使用；文本输入不要再走这里。</ui-text>

          <div class="field-grid">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>模型 ID</mat-label>
              <input matInput placeholder="如 microsoft/Phi-3-mini-4k-instruct" />
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Revision</mat-label>
              <input matInput value="main" />
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>保存目录</mat-label>
              <input matInput value="models/flux" />
              <span matTextSuffix class="field-suffix mono">.safetensors</span>
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>已禁用</mat-label>
              <input matInput value="由系统托管" disabled />
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>邮箱</mat-label>
              <input matInput [formControl]="email" placeholder="name@example.com" />
              <mat-error>请输入邮箱地址</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>多行说明</mat-label>
              <textarea matInput rows="3" placeholder="写给自己的备注"></textarea>
            </mat-form-field>
          </div>
        </ui-section>

      <ui-section title="选择" pill="Select">
          <div class="field-grid">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>下载源</mat-label>
              <mat-select value="hf">
                <mat-option value="hf">Hugging Face</mat-option>
                <mat-option value="modelscope">ModelScope</mat-option>
                <mat-option value="civitai">Civitai</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>下载通路</mat-label>
              <mat-select value="proxy">
                <mat-option value="direct">直连</mat-option>
                <mat-option value="proxy">代理</mat-option>
                <mat-option value="mirror">镜像</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        </ui-section>

      <ui-section title="勾选与开关" pill="Choice">
          <div class="choice-grid">
            <mat-checkbox checked>只下载真实权重</mat-checkbox>
            <mat-checkbox>下载完成后自动入库</mat-checkbox>
            <mat-checkbox disabled>自动更新（不可用）</mat-checkbox>

            <mat-radio-group value="stable" class="radio-col">
              <mat-radio-button value="stable">稳定版</mat-radio-button>
              <mat-radio-button value="nightly">每日构建</mat-radio-button>
            </mat-radio-group>

            <mat-slide-toggle checked>深色主题跟随系统</mat-slide-toggle>
          </div>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisInputsComponent {
  readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });

  constructor() {
    this.email.markAsTouched();
  }
}
