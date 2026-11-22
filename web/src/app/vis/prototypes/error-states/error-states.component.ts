import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { BadgeComponent } from '../../../ui/badge.component';
import { EmptyComponent } from '../../../ui/empty.component';
import { PageHeaderComponent } from '../../../ui/page-header.component';

interface ToastItem {
  id: number;
  tone: 'error' | 'ok';
  title: string;
  body: string;
}

interface CopyRow {
  scene: string;
  bad: string;
  title: string;
  why: string;
  acts: string;
}

interface SpecRow {
  level: string;
  look: string;
  where: string;
  a11y: string;
  tone: 'err' | 'warn' | 'info' | 'ok' | '';
}

/**
 * VIS 原型 · 错误与反馈。
 *
 * 四层反馈（行内提示 / 字段错误 / Toast / 阻断弹层）＋ 两种非错误状态
 * （不可用门控 / 空状态）。这里的状态只用于演示，不接真实接口。
 */
@Component({
  selector: 'app-error-states-prototype',
  standalone: true,
  imports: [BadgeComponent, EmptyComponent, PageHeaderComponent],
  template: `
    <div class="proto-page">
      <ui-page-header
        kicker="VIS · Feedback"
        title="错误与反馈 · 统一层级"
        hint="不是所有失败都应该变成一条红色横条。按「影响范围 + 是否需要用户决策」分四层：行内提示、字段错误、Toast、阻断弹层；不可用与空状态不是错误。"
      />

      <!-- 01 现状 -->
      <section class="section">
        <h2><span class="num">01</span>现状：同一件事有六种写法</h2>
        <p class="lead">
          盘点自 web/src：下载页、模型发现弹层、环境页、模型库、节点页各自实现了不同的错误块；有的在页面顶部，有的在弹层里，有的只有一行纯文本。用户无法从外观判断「严重程度」与「该做什么」。
        </p>

        <div class="grid2">
          <div class="card bad">
            <div class="card-head">
              <h3>当前 · 页面顶部纯文本</h3>
              <span class="tag">downloads / discover</span>
            </div>
            <div class="card-body">
              <div class="notice error">
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.6M8 11.2v.2" /></svg>
                <div class="body">
                  <strong>Hugging Face 搜索失败：Client error '401 Unauthorized' for url …</strong>
                  <p>没有任何下一步；原始英文异常直接进页面。</p>
                </div>
              </div>
            </div>
          </div>

          <div class="card bad">
            <div class="card-head">
              <h3>当前 · 含糊的一句话</h3>
              <span class="tag">resolve</span>
            </div>
            <div class="card-body">
              <div class="notice warn">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 15 14H1z" /><path d="M8 6v4M8 12.2v.2" /></svg>
                <div class="body">
                  <strong>解析失败，请检查模型 ID / 网络 / token</strong>
                  <p>三个可能原因并列，用户不知道先查哪一个。</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="table-wrap">
          <table class="spec-table">
            <thead>
              <tr><th>位置</th><th>现状</th><th>问题</th></tr>
            </thead>
            <tbody>
              <tr><td>下载页</td><td><code>.notice.err</code> 顶部横条</td><td>没有标题 / 下一步；与成功提示同形</td></tr>
              <tr><td>发现弹层</td><td>弹层内再套一条 <code>.notice.err</code></td><td>两层容器 + 两种红；关闭弹层后错误消失，无法回看</td></tr>
              <tr><td>环境页</td><td>顶部 <code>role=alert</code> + 实例行内 <code>instanceError</code></td><td>同一错误在两处出现，文案不一致</td></tr>
              <tr><td>模型库</td><td><code>notice</code> 按 ok/err 切换底色</td><td>成功与失败只差颜色，图标与动作缺失</td></tr>
              <tr><td>源不可达</td><td>灰置站点 chip + 原生 title</td><td>方向正确，但没有统一成组件</td></tr>
              <tr><td>字段校验</td><td>大多没有字段级提示，直接 toast / 顶部块</td><td>用户不知道是哪一格错了</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 02 定稿 -->
      <section class="section">
        <h2><span class="num">02</span>定稿：四层反馈 + 两种非错误状态</h2>
        <p class="lead">
          先问两个问题：影响的是一个字段、一块区域、整页，还是需要用户做决定？再选层级。颜色只表达严重程度，不表达品牌。
        </p>

        <h3>L1 行内提示 · 影响一块区域，页面仍可继续用</h3>
        <div class="grid2">
          <div class="card">
            <div class="card-head">
              <h3>错误 · 可重试</h3>
              <ui-badge tone="red">role=alert</ui-badge>
            </div>
            <div class="card-body">
              @if (authInfo) {
                <div class="notice info" role="status">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.4v3.2M8 4.9v.2" /></svg>
                  <div class="body">
                    <strong>{{ authInfo }}</strong>
                    <p>当前页面状态没有丢失，可以继续操作。</p>
                  </div>
                </div>
              } @else {
                <div class="notice error" role="alert">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.6M8 11.2v.2" /></svg>
                  <div class="body">
                    <strong>Hugging Face 需要登录</strong>
                    <p>Token 无效或已过期。更新 Token 后重试，当前页面不会丢失。</p>
                    <div class="acts">
                      <button class="btn sm" type="button" (click)="resolveAuth('settings')">去设置</button>
                      <button class="btn sm" type="button" (click)="resolveAuth('retry')">重试</button>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>警告 · 可继续</h3>
              <ui-badge tone="orange">role=status</ui-badge>
            </div>
            <div class="card-body">
              @if (warnInfo) {
                <div class="notice info" role="status">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.4v3.2M8 4.9v.2" /></svg>
                  <div class="body">
                    <strong>{{ warnInfo }}</strong>
                    <p>这是可继续的提示，不需要用户停下手上的事。</p>
                  </div>
                </div>
              } @else {
                <div class="notice warn" role="status">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 15 14H1z" /><path d="M8 6v4M8 12.2v.2" /></svg>
                  <div class="body">
                    <strong>本机显存可能不足</strong>
                    <p>推荐组合预计 28.9 GB，显卡 16 GB。可继续下载，运行时需要分层加载。</p>
                    <div class="acts">
                      <button class="btn sm" type="button" (click)="acceptWarn()">仍要下载</button>
                      <button class="btn sm ghost" type="button" (click)="switchSmaller()">换更小版本</button>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>信息 · 不是错误</h3>
              <ui-badge tone="blue">role=status</ui-badge>
            </div>
            <div class="card-body">
              <div class="notice info" role="status">
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.4v3.2M8 4.9v.2" /></svg>
                <div class="body">
                  <strong>已切换到镜像</strong>
                  <p>直连超时，下载自动走 hf-mirror，速度 3.2 MB/s。</p>
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>成功 · 可撤销</h3>
              <ui-badge tone="green">role=status</ui-badge>
            </div>
            <div class="card-body">
              @if (undoDone) {
                <div class="notice info" role="status">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.4v3.2M8 4.9v.2" /></svg>
                  <div class="body">
                    <strong>已恢复 3 个文件 · 14.9 GB</strong>
                    <p>回到原目录，模型库与工作流引用未受影响。</p>
                  </div>
                </div>
              } @else {
                <div class="notice ok" role="status">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.4 6.2 11.6 13 4.8" /></svg>
                  <div class="body">
                    <strong>已移入回收站</strong>
                    <p>3 个文件 · 14.9 GB。可在资源管理器中恢复。</p>
                    <div class="acts">
                      <button class="btn sm" type="button" (click)="undoDone = true">撤销</button>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>

        <div class="l1-reset">
          <button class="link-btn" type="button" (click)="resetNotices()">重置 L1 示例</button>
        </div>

        <h3>L2 字段错误 · 只影响一个输入框</h3>
        <div class="card">
          <div class="card-body">
            <div class="field-demo">
              <label for="es-repo">模型 ID</label>
              <div class="input" [class.bad]="!!repoError">
                <input
                  id="es-repo"
                  type="text"
                  [value]="repoValue"
                  [attr.aria-invalid]="!!repoError"
                  [attr.aria-describedby]="repoError ? 'es-repo-err' : 'es-repo-ok'"
                  (input)="onRepoInput($event)"
                />
              </div>
              @if (repoError) {
                <span class="field-msg" id="es-repo-err" role="alert">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.6M8 11.2v.2" /></svg>
                  {{ repoError }}
                </span>
              } @else {
                <span class="field-msg ok" id="es-repo-ok">格式正确，可以解析。</span>
              }
            </div>
            <button class="link-btn" type="button" (click)="useValidRepo()">改用 Comfy-Org/MiniMax-H3-Image</button>
            <p class="hint">
              字段错误不弹 Toast、不占页面顶部；输入框加 <code>aria-invalid</code> 与
              <code>aria-describedby</code>，失焦或提交时出现，修正后立即消失。
            </p>
          </div>
        </div>

        <h3>L3 Toast · 非阻断，用户不需要停下手上的事</h3>
        <div class="grid2">
          <div class="card">
            <div class="card-head">
              <h3>错误 Toast · 自动消失但可关闭</h3>
              <ui-badge tone="red">6s · role=alert</ui-badge>
            </div>
            <div class="card-body">
              @if (demoError) {
                <div class="toast-demo">
                  <div class="toast error" role="alert">
                    <span class="ico" aria-hidden="true">!</span>
                    <div class="body">
                      <b>复制失败</b>
                      <p>剪贴板权限被浏览器拒绝。可手动选择路径。</p>
                    </div>
                    <button class="x" type="button" aria-label="关闭错误 Toast" (click)="demoError = false">×</button>
                  </div>
                </div>
              } @else {
                <p class="demo-off">已关闭。错误 Toast 6 秒自动消失，也可以手动关。</p>
              }
              <button class="btn sm trigger" type="button" (click)="triggerToast('error')">触发错误 Toast</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>成功 Toast · 不抢焦点</h3>
              <ui-badge tone="green">3s · role=status</ui-badge>
            </div>
            <div class="card-body">
              @if (demoOk) {
                <div class="toast-demo">
                  <div class="toast ok" role="status">
                    <span class="ico" aria-hidden="true">✓</span>
                    <div class="body">
                      <b>已复制路径</b>
                      <p>workspace/models/diffusion_models/</p>
                    </div>
                    <button class="x" type="button" aria-label="关闭成功 Toast" (click)="demoOk = false">×</button>
                  </div>
                </div>
              } @else {
                <p class="demo-off">已关闭。成功 Toast 3 秒自动消失。</p>
              }
              <button class="btn sm trigger" type="button" (click)="triggerToast('ok')">触发成功 Toast</button>
            </div>
          </div>
        </div>

        <h3>L4 阻断弹层 · 必须由用户做决定</h3>
        <div class="card">
          <div class="card-body dialog-body">
            <div class="dialog-demo">
              <div class="dialog">
                <h3>删除这个模型？</h3>
                <p>将从磁盘移除 3 个文件，模型库条目也会消失。工作流引用会变成缺失状态。</p>
                <div class="do">不可撤销的操作只在这里出现；普通失败不要用弹层。</div>
                <div class="row">
                  <button class="btn" type="button" (click)="cancelPreview()">取消</button>
                  <button class="btn danger" type="button" (click)="openDialog()">删除 3 个文件</button>
                </div>
              </div>
            </div>
            @if (dialogNote) {
              <p class="hint" role="status">{{ dialogNote }}</p>
            }
            <button class="btn sm trigger" type="button" (click)="openDialog()">打开删除确认弹层</button>
          </div>
        </div>

        <h3>N1 不可用 · 不是错误，是「现在没有这个入口」</h3>
        <div class="grid2">
          <div class="card">
            <div class="card-head">
              <h3>源门控</h3>
              <span class="tag">灰置 + hover 原因</span>
            </div>
            <div class="card-body">
              <div class="chips">
                <button
                  class="chip"
                  type="button"
                  [class.on]="gate === 'Hugging Face'"
                  (click)="gate = 'Hugging Face'"
                ><span class="dot"></span>Hugging Face</button>
                <button
                  class="chip down"
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="探针不可达：三条通路均超时"
                ><span class="dot"></span>Civitai</button>
                <button
                  class="chip"
                  type="button"
                  [class.on]="gate === 'ModelScope'"
                  (click)="gate = 'ModelScope'"
                ><span class="dot"></span>ModelScope</button>
              </div>
              <p class="hint">
                当前入口：{{ gate }}。不可达的源不提供入口，原因只进 hover 提示；页面不出现一整块红色说明。
              </p>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>空状态 / 无结果</h3>
              <span class="tag">中性 · 不用红</span>
            </div>
            <div class="card-body empty-body">
              <ui-empty
                icon="⌕"
                title="没有找到匹配的模型"
                hint="换个关键词，或切换来源。当前来源里没有符合条件的结果。"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- 03 文案 -->
      <section class="section">
        <h2><span class="num">03</span>文案公式：发生了什么 · 为什么 · 下一步</h2>
        <p class="lead">
          标题回答「发生了什么」，说明回答「为什么 + 下一步」，按钮只放一个主操作。原因不确定时不要并列三个猜测。
        </p>
        <div class="table-wrap">
          <table class="spec-table">
            <thead>
              <tr><th>场景</th><th>不要写</th><th>应该写</th></tr>
            </thead>
            <tbody>
              @for (row of copyRows; track row.scene) {
                <tr>
                  <td>{{ row.scene }}</td>
                  <td class="bad-copy">{{ row.bad }}</td>
                  <td>
                    <b>{{ row.title }}</b><br />
                    {{ row.why }}<br />
                    <span class="faint">{{ row.acts }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- 04 规格 -->
      <section class="section">
        <h2><span class="num">04</span>组件规格</h2>
        <div class="table-wrap">
          <table class="spec-table">
            <thead>
              <tr><th>层级</th><th>外观</th><th>位置 / 行为</th><th>无障碍</th></tr>
            </thead>
            <tbody>
              @for (row of specRows; track row.level) {
                <tr>
                  <td>
                    @if (row.tone) {
                      <span class="dot inline" [class.d-err]="row.tone === 'err'" [class.d-warn]="row.tone === 'warn'" [class.d-info]="row.tone === 'info'" [class.d-ok]="row.tone === 'ok'"></span>
                    }
                    {{ row.level }}
                  </td>
                  <td>{{ row.look }}</td>
                  <td>{{ row.where }}</td>
                  <td><code>{{ row.a11y }}</code></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="hint forbid">
          <strong>禁止：</strong>把原始异常 / 堆栈 / URL 直接印在页面上；同一错误在顶部和弹层各出现一次；用 Toast 承载需要用户决策的错误；用红色表达「没有结果」；同时给两个主按钮。
        </p>
      </section>

      <!-- 真实 Toast 栈：原型里用来验证触发/关闭/自动消失 -->
      @if (toasts.length) {
        <div class="toast-stack">
          @for (toast of toasts; track toast.id) {
            <div class="toast floating" [class.error]="toast.tone === 'error'" [class.ok]="toast.tone === 'ok'" [attr.role]="toast.tone === 'error' ? 'alert' : 'status'">
              <span class="ico" aria-hidden="true">{{ toast.tone === 'error' ? '!' : '✓' }}</span>
              <div class="body">
                <b>{{ toast.title }}</b>
                <p>{{ toast.body }}</p>
              </div>
              <button class="x" type="button" aria-label="关闭" (click)="dismissToast(toast.id)">×</button>
            </div>
          }
        </div>
      }

      <!-- 真实阻断弹层 -->
      @if (dialogOpen) {
        <div class="overlay" (click)="closeDialog()">
          <div
            class="dialog modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="es-dlg-title"
            aria-describedby="es-dlg-desc"
            (click)="$event.stopPropagation()"
          >
            <h3 id="es-dlg-title">删除这个模型？</h3>
            <p id="es-dlg-desc">将从磁盘移除 3 个文件，模型库条目也会消失。工作流引用会变成缺失状态。</p>
            <div class="do">这个操作不可撤销。Esc 或点遮罩可以取消。</div>
            <div class="row">
              <button #cancelBtn class="btn" type="button" (click)="closeDialog()">取消</button>
              <button class="btn danger" type="button" (click)="confirmDelete()">删除 3 个文件</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      /* VIS shell 的 .vis-main 不提供内边距，页面自管宽度与留白 */
      .proto-page {
        max-width: 1180px;
        margin: 0 auto;
        padding: 26px 28px 72px;
        width: 100%;
      }

      .section { margin: 0 0 42px; }
      .section:last-of-type { margin-bottom: 0; }
      .section > h2 {
        display: flex;
        align-items: baseline;
        gap: 9px;
        margin: 0 0 7px;
        padding-bottom: 9px;
        border-bottom: 1px solid var(--border);
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .section > h2 .num {
        font: 400 11px/1 "Cascadia Mono", Consolas, monospace;
        color: var(--muted);
        letter-spacing: 0.08em;
      }
      .section > p.lead {
        margin: 0 0 14px;
        max-width: 84ch;
        font-size: 12.5px;
        color: var(--muted);
      }
      h3 { margin: 22px 0 8px; font-size: 13.5px; font-weight: 600; }

      .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }

      .card {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }
      .card-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--panel-2);
      }
      .card-head h3 { margin: 0; font-size: 12px; font-weight: 600; }
      .card-head .tag {
        margin-left: auto;
        font: 10px/1 "Cascadia Mono", Consolas, monospace;
        color: var(--faint);
      }
      .card-head ui-badge { margin-left: auto; }
      .card-body { padding: 14px; }
      .bad { border-color: color-mix(in oklab, var(--err) 26%, var(--border)); }
      .bad .card-head { background: var(--err-soft); }
      .bad .card-head h3 { color: var(--err); }

      /* —— 行内提示 —— */
      .notice {
        display: flex;
        gap: 10px;
        padding: 11px 12px;
        border: 1px solid var(--border);
        border-left-width: 3px;
        border-radius: 10px;
        background: var(--panel);
        font-size: 12px;
      }
      .notice svg {
        flex: none;
        width: 16px;
        height: 16px;
        margin-top: 1px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
      }
      .notice .body { min-width: 0; }
      .notice strong { display: block; font-size: 12.5px; font-weight: 600; color: var(--text); }
      .notice p { margin: 2px 0 0; color: var(--muted); }
      .notice .acts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
      .notice.error {
        border-color: color-mix(in oklab, var(--err) 25%, var(--border));
        border-left-color: var(--err);
        background: var(--err-soft);
        color: var(--err);
      }
      .notice.warn {
        border-color: color-mix(in oklab, var(--warn) 25%, var(--border));
        border-left-color: var(--warn);
        background: var(--warn-soft);
        color: var(--warn);
      }
      .notice.info { border-color: var(--accent-line); border-left-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
      .notice.ok {
        border-color: color-mix(in oklab, var(--ok) 25%, var(--border));
        border-left-color: var(--ok);
        background: var(--ok-soft);
        color: var(--ok);
      }

      /* —— 字段 —— */
      .field-demo { display: flex; flex-direction: column; gap: 5px; max-width: 420px; }
      .field-demo label { font-size: 11.5px; color: var(--muted); }
      .input {
        display: flex;
        align-items: center;
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--input-bg);
      }
      .input.bad {
        border-color: var(--err);
        box-shadow: 0 0 0 3px color-mix(in oklab, var(--err) 14%, transparent);
      }
      .input input {
        width: 100%;
        height: auto;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: none;
        outline: 0;
        color: var(--text);
        font-size: 12.5px;
        box-shadow: none;
      }
      .field-msg {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--err);
      }
      .field-msg.ok { color: var(--ok); }
      .field-msg svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.6; }
      .link-btn {
        margin-top: 10px;
        height: auto;
        padding: 0;
        border: 0;
        background: none;
        color: var(--accent);
        font-size: 11.5px;
      }
      .link-btn:hover { background: none; text-decoration: underline; }
      .l1-reset { margin-top: 10px; }
      .l1-reset .link-btn { margin-top: 0; }

      /* —— Toast —— */
      .toast-demo {
        position: relative;
        min-height: 118px;
        padding: 14px;
        border: 1px dashed var(--border-strong);
        border-radius: 10px;
        background: var(--panel-2);
      }
      .toast {
        display: flex;
        gap: 10px;
        width: min(360px, 100%);
        margin-left: auto;
        padding: 11px 12px;
        border: 1px solid var(--border);
        border-radius: 11px;
        background: var(--panel);
        box-shadow: var(--shadow-md);
        font-size: 12px;
        text-align: left;
      }
      .toast.error {
        border-color: color-mix(in oklab, var(--err) 25%, var(--border));
        box-shadow: 0 18px 40px -20px color-mix(in oklab, var(--err) 45%, transparent);
      }
      .toast .ico {
        flex: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--err-soft);
        color: var(--err);
        font-size: 11px;
        font-weight: 700;
      }
      .toast.ok .ico { background: var(--ok-soft); color: var(--ok); }
      .toast .body { min-width: 0; flex: 1; }
      .toast b { display: block; font-size: 12px; font-weight: 600; }
      .toast p { margin: 2px 0 0; color: var(--muted); font-size: 11.5px; }
      .toast .x {
        border: 0;
        background: none;
        color: var(--faint);
        cursor: pointer;
        align-self: flex-start;
        padding: 0;
        width: 18px;
        height: 18px;
        font-size: 14px;
        line-height: 1;
      }
      .toast .x:hover { background: none; color: var(--text); }
      .trigger { margin-top: 10px; }
      .demo-off { margin: 0 0 10px; padding: 18px 0; text-align: center; font-size: 11.5px; color: var(--muted); }

      .toast-stack {
        position: fixed;
        right: 22px;
        bottom: 22px;
        z-index: 80;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(360px, calc(100vw - 44px));
      }
      .toast.floating { margin-left: 0; width: 100%; }

      /* —— 弹层 —— */
      .dialog-body { padding: 0; }
      .dialog-demo { padding: 20px; border-radius: var(--radius-sm); background: rgb(0 0 0 / 0.3); }
      .dialog {
        width: min(420px, 100%);
        margin: 0 auto;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--panel);
        box-shadow: var(--shadow-lg);
      }
      .dialog h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
      .dialog p { margin: 0; font-size: 12px; color: var(--muted); }
      .dialog .do {
        margin: 12px 0 0;
        padding: 9px 10px;
        border-radius: var(--radius-sm);
        background: var(--panel-3);
        font-size: 11.5px;
        color: var(--text-2);
      }
      .dialog .row { display: flex; justify-content: flex-end; gap: 7px; margin-top: 16px; }
      .dialog-body > .hint { padding: 0 20px; margin: 10px 0; }
      .dialog-body > .trigger { margin: 0 20px 18px; }

      .overlay {
        position: fixed;
        inset: 0;
        z-index: 90;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgb(0 0 0 / 0.48);
        backdrop-filter: blur(2px);
      }
      .dialog.modal { animation: pop 0.12s ease-out; }
      @keyframes pop {
        from { opacity: 0; transform: translateY(4px) scale(0.99); }
        to { opacity: 1; transform: none; }
      }

      /* —— 门控 / 空态 —— */
      .chips { display: flex; gap: 7px; flex-wrap: wrap; }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel);
        font-size: 11.5px;
        color: var(--text-2);
      }
      .chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }
      .chip.on { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
      .chip.down { opacity: 0.5; cursor: not-allowed; }
      .chip.down .dot { background: var(--faint); }
      .empty-body { padding: 0; }
      .empty-body ui-empty { display: block; padding: 6px 0; }

      /* —— 表格 —— */
      .table-wrap { overflow-x: auto; }
      .spec-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 14px; }
      .spec-table th,
      .spec-table td {
        padding: 8px 9px;
        border-bottom: 1px solid var(--border-soft);
        text-align: left;
        vertical-align: top;
      }
      .spec-table th {
        color: var(--muted);
        font-weight: 500;
        font-size: 10.5px;
        background: var(--panel-2);
      }
      .spec-table td:first-child { width: 118px; }
      .spec-table tr:last-child td { border-bottom: 0; }
      .bad-copy { color: var(--err); text-decoration: line-through; text-decoration-color: color-mix(in oklab, var(--err) 35%, transparent); }
      .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
      .dot.inline { margin-right: 5px; }
      .d-err { background: var(--err); }
      .d-warn { background: var(--warn); }
      .d-info { background: var(--accent); }
      .d-ok { background: var(--ok); }
      .forbid {
        margin-top: 12px;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-left: 3px solid var(--err);
        border-radius: var(--radius-sm);
        background: var(--panel);
        font-size: 11.5px;
        color: var(--muted);
      }

      .hint { margin-top: 10px; font-size: 11.5px; color: var(--muted); }
      .faint { color: var(--faint); }
      code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 10.5px; color: var(--text-2); }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 11px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--panel);
        color: var(--text-2);
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        height: auto;
      }
      .btn.sm { min-height: 27px; padding: 0 9px; font-size: 11.5px; }
      .btn.ghost { border-color: transparent; background: none; color: var(--muted); }
      .btn.danger { border-color: var(--err); background: var(--err); color: var(--panel); }
      .btn.danger:hover { background: var(--err); border-color: var(--err); color: var(--panel); }

      @media (max-width: 900px) {
        .grid2 { grid-template-columns: 1fr; }
        .spec-table td:first-child { width: auto; }
      }
    `,
  ],
})
export class ErrorStatesPrototypeComponent implements OnDestroy {
  authInfo = '';
  warnInfo = '';
  undoDone = false;
  repoValue = 'MiniMaxAI/MiniMax-H3-Image';
  repoError = '这个仓库不存在。检查拼写，或从发现页选择模型。';
  demoError = true;
  demoOk = true;
  dialogOpen = false;
  dialogNote = '';
  gate = 'Hugging Face';
  toasts: ToastItem[] = [];

  @ViewChild('cancelBtn') private cancelBtn?: ElementRef<HTMLButtonElement>;

  private toastSeq = 0;
  private toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly copyRows: CopyRow[] = [
    {
      scene: '鉴权失败',
      bad: "搜索失败：Client error '401 Unauthorized' for url …",
      title: 'Hugging Face 需要登录',
      why: 'Token 无效或已过期。更新 Token 后重试。',
      acts: '[去设置] [重试]',
    },
    {
      scene: '仓库不存在',
      bad: '解析失败，请检查模型 ID / 网络 / token',
      title: '模型不存在',
      why: 'huggingface.co 上没有这个仓库。检查模型 ID，或从发现页重新选择。',
      acts: '[返回发现]',
    },
    {
      scene: '下载中断',
      bad: '下载失败',
      title: '下载连接中断',
      why: '已下载 8.1 GB，可继续。当前通路 3.8 MB/s。',
      acts: '[继续下载] [查看日志]',
    },
    {
      scene: '显存不足',
      bad: '装不下',
      title: '本机显存可能不足',
      why: '预计 28.9 GB，显卡 16 GB。可换 W4A8 更小组合，或仍要下载。',
      acts: '[换更小版本] [仍要下载]',
    },
    {
      scene: '磁盘不足',
      bad: 'No space left on device',
      title: '磁盘空间不足',
      why: '还需要 12.4 GB，当前可用 3.1 GB。清理后重试。',
      acts: '[打开资源管理器]',
    },
  ];

  readonly specRows: SpecRow[] = [
    { level: '行内错误', look: '3px 左描边 + 淡红底 + 图标 + 标题 + 说明 + 最多两个按钮', where: '出现在受影响区域上方；不自动消失；可重试', a11y: 'role="alert"', tone: 'err' },
    { level: '行内警告', look: '同上，琥珀色', where: '可继续的操作前；给出「仍要继续」', a11y: 'role="status"', tone: 'warn' },
    { level: '提示', look: '淡靛底 / 左描边', where: '解释自动行为（切镜像、重试成功）', a11y: 'role="status"', tone: 'info' },
    { level: '成功', look: '淡绿底 + 对勾', where: '只在有后续动作（撤销 / 打开）时需要', a11y: 'role="status"', tone: 'ok' },
    { level: '字段错误', look: '输入框红边 + 下方 11px 说明', where: '紧贴字段；不弹 Toast', a11y: 'aria-invalid + aria-describedby', tone: '' },
    { level: 'Toast', look: '360px，右下角，阴影，关闭按钮', where: '错误 6s、成功 3s；悬停暂停', a11y: 'role="alert" / role="status"', tone: '' },
    { level: '阻断弹层', look: '居中 420px，唯一主操作', where: '删除 / 覆盖 / 不可撤销', a11y: 'role="alertdialog" + 焦点圈闭 + Esc', tone: '' },
    { level: '不可用', look: '灰置 chip / 禁用按钮', where: '原因进 hover 提示', a11y: 'aria-disabled="true" + title', tone: '' },
    { level: '空状态', look: '中性图标 + 一句标题 + 一句说明', where: '无数据，不是失败', a11y: '普通文本，不播报为错误', tone: '' },
  ];

  ngOnDestroy(): void {
    for (const timer of this.toastTimers.values()) clearTimeout(timer);
    this.toastTimers.clear();
  }

  resolveAuth(mode: 'settings' | 'retry'): void {
    this.authInfo = mode === 'settings'
      ? '已打开 Token 设置 · 更新后回到本页重试'
      : '重试成功 · Hugging Face 搜索已恢复';
  }

  resetNotices(): void {
    this.authInfo = '';
    this.warnInfo = '';
    this.undoDone = false;
  }

  acceptWarn(): void {
    this.warnInfo = '已继续下载 · 运行时按需分层加载';
  }

  switchSmaller(): void {
    this.warnInfo = '已切换到 W4A8 单文件组合 · 预计 28.9 GB';
  }

  onRepoInput(event: Event): void {
    this.repoValue = (event.target as HTMLInputElement).value;
    this.repoError = this.validateRepo(this.repoValue);
  }

  useValidRepo(): void {
    this.repoValue = 'Comfy-Org/MiniMax-H3-Image';
    this.repoError = '';
  }

  private validateRepo(raw: string): string {
    const value = raw.trim();
    if (!value) return '模型 ID 不能为空。';
    if (!/^[\w.-]+\/[\w.-]+$/.test(value)) return '模型 ID 需要「组织/仓库」两段。';
    if (value.toLowerCase().startsWith('minimaxai/')) {
      return '这个仓库不存在。检查拼写，或从发现页选择模型。';
    }
    return '';
  }

  triggerToast(tone: 'error' | 'ok'): void {
    if (tone === 'error') {
      this.demoError = true;
      this.showToast('error', '复制失败', '剪贴板权限被浏览器拒绝。可手动选择路径。');
    } else {
      this.demoOk = true;
      this.showToast('ok', '已复制路径', 'workspace/models/diffusion_models/');
    }
  }

  private showToast(tone: 'error' | 'ok', title: string, body: string): void {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, tone, title, body }];
    const timer = setTimeout(() => this.dismissToast(id), tone === 'error' ? 6000 : 3000);
    this.toastTimers.set(id, timer);
  }

  dismissToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (timer) clearTimeout(timer);
    this.toastTimers.delete(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  cancelPreview(): void {
    this.dialogNote = '已取消（预览里的操作没有副作用）。';
  }

  openDialog(): void {
    this.dialogOpen = true;
    this.dialogNote = '';
    setTimeout(() => this.cancelBtn?.nativeElement.focus(), 0);
  }

  closeDialog(): void {
    this.dialogOpen = false;
  }

  confirmDelete(): void {
    this.dialogOpen = false;
    this.dialogNote = '已删除 3 个文件 · 模型库条目已移除，可在回收站恢复。';
    this.showToast('ok', '已删除 3 个文件', '模型库条目已移除，可在回收站恢复。');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.dialogOpen) this.closeDialog();
  }
}
