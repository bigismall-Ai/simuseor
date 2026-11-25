import { Component } from '@angular/core';
import { UiButtonComponent } from '../../../../ui/button';
import { FieldComponent } from '../../../../ui/field';
import { InputComponent } from '../../../../ui/input';
import { PanelComponent } from '../../../../ui/panel';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { VisualPageComponent } from '../../../visual-page';

/**
 * 原型组件：结构件。
 *
 * 页面骨架的三件套：ui-section（区块）、ui-panel（面板）、ui-field（字段）。
 * 这里只摆真实组件，几何与间距全部来自组件自身与全局 token，页面样式只做布局。
 */
@Component({
  selector: 'app-proto-structure',
  imports: [
    FieldComponent,
    InputComponent,
    PanelComponent,
    SectionBlockComponent,
    UiButtonComponent,
    VisualPageComponent,
  ],
  styleUrl: './structure.scss',
  template: `
    <app-visual-page
      title="结构件"
      hint="区块、面板、字段：页面只组合这三层，不自己写 section / panel / label 结构。"
    >
      <ui-section title="区块 · ui-section" pill="Section">
        <div class="stack">
          <ui-section title="默认区块" pill="Card">
            <p class="body">
              标题在内容外，右侧 pill 只放一个短标签。区块内容直接铺开，
              表格与列表自己带表面，不再套第二层卡。
            </p>
          </ui-section>

          <ui-section title="纯文字区块" pill="Plain" [plain]="true">
            <p class="body">
              说明、规则、清单用 <code>[plain]="true"</code>：去掉外层卡，
              避免「卡片里再包一张卡片」。
            </p>
          </ui-section>
        </div>
        <p class="note">
          页面里的每个区块都用 <code>ui-section</code>；标题层级固定 <code>h2</code>，
          不放大标题，也不在区块之间另写分隔线。
        </p>
      </ui-section>

      <ui-section title="面板 · ui-panel" pill="Panel">
        <div class="cols">
          <ui-panel
            kicker="Instance"
            title="实例 A"
            hint="给了 kicker / title / hint 才画标题分隔线。"
          >
            <div panel-actions>
              <ui-button variant="ghost" size="sm" type="button">设置</ui-button>
              <ui-button variant="primary" size="sm" type="button">启动</ui-button>
            </div>
            <p class="body">
              面板承载一块完整内容：表单、列表、设置分组。右侧动作槽用
              <code>panel-actions</code> 投影，不写绝对定位。
            </p>
          </ui-panel>

          <ui-panel>
            <p class="body">
              无标题面板不画分隔线，只留容器本身；适合把已有区块包成并列栏。
            </p>
          </ui-panel>
        </div>
      </ui-section>

      <ui-section title="字段 · ui-field" pill="Field">
        <div class="fields">
          <ui-field label="仓库地址">
            <ui-input
              ariaLabel="仓库地址"
              placeholder="black-forest-labs/FLUX.1-dev"
              hint="支持 owner/repo 或完整 URL。"
            />
          </ui-field>

          <ui-field label="本地目录">
            <ui-input
              ariaLabel="本地目录"
              placeholder="D:/models/flux"
              error="目录不存在，检查路径"
            />
          </ui-field>
        </div>
        <p class="note">
          <code>ui-field</code> 只负责标签与控件的关联；输入框本身仍用
          <code>ui-input</code>。标签自动挂到投影进来的第一个控件，点标签能聚焦。
        </p>
      </ui-section>

      <ui-section title="分工" pill="Rules" [plain]="true">
        <ul class="rules">
          <li><b>ui-section</b>：页面级分区，标题在内容外；不用于弹层内部。</li>
          <li><b>ui-panel</b>：一块完整内容的面板；同屏可并列，最多两层。</li>
          <li><b>ui-field</b>：表单一行；控件由调用方投影，视觉原语不在这里重画。</li>
          <li><b>顺序</b>：页面 → ui-section → ui-panel / 表格 / 列表 → 控件。</li>
        </ul>
      </ui-section>
    </app-visual-page>
  `,
})
export class ProtoStructureComponent {}
