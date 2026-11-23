import { UiButtonComponent } from '../../../../ui/button';
import { ToastComponent } from '../../../../ui/toast';
import { SourceChipComponent } from '../../../../ui/source-chip';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { BadgeComponent } from '../../../../ui/badge';
import { EmptyComponent } from '../../../../ui/empty';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { UiMaterialModule } from '../../../../ui/material';
import { ProtoShellComponent } from '../../proto-shell';

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
  selector: 'app-proto-error-states',
  imports: [
    ProtoShellComponent,
    PageHeaderComponent,
    BadgeComponent,
    EmptyComponent,
    UiMaterialModule,
      UiButtonComponent,
    ToastComponent,
    SourceChipComponent,
  ],
  styleUrl: './error-states.scss',
  template: `
    <app-proto-shell active="downloads" title="错误与反馈" hint="四层反馈 · 非错误状态">
      <div class="page">
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
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 5v3.6M8 11.2v.2" />
                  </svg>
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
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 2 15 14H1z" />
                    <path d="M8 6v4M8 12.2v.2" />
                  </svg>
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
                <tr>
                  <th>位置</th>
                  <th>现状</th>
                  <th>问题</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>下载页</td>
                  <td><code>.notice.err</code> 顶部横条</td>
                  <td>没有标题 / 下一步；与成功提示同形</td>
                </tr>
                <tr>
                  <td>发现弹层</td>
                  <td>弹层内再套一条 <code>.notice.err</code></td>
                  <td>两层容器 + 两种红；关闭弹层后错误消失，无法回看</td>
                </tr>
                <tr>
                  <td>环境页</td>
                  <td>顶部 <code>role=alert</code> + 实例行内 <code>instanceError</code></td>
                  <td>同一错误在两处出现，文案不一致</td>
                </tr>
                <tr>
                  <td>模型库</td>
                  <td><code>notice</code> 按 ok/err 切换底色</td>
                  <td>成功与失败只差颜色，图标与动作缺失</td>
                </tr>
                <tr>
                  <td>源不可达</td>
                  <td>灰置站点 chip + 原生 title</td>
                  <td>方向正确，但没有统一成组件</td>
                </tr>
                <tr>
                  <td>字段校验</td>
                  <td>大多没有字段级提示，直接 toast / 顶部块</td>
                  <td>用户不知道是哪一格错了</td>
                </tr>
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
                @if (authInfo()) {
                  <div class="notice info" role="status">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 7.4v3.2M8 4.9v.2" />
                    </svg>
                    <div class="body">
                      <strong>{{ authInfo() }}</strong>
                      <p>当前页面状态没有丢失，可以继续操作。</p>
                    </div>
                  </div>
                } @else {
                  <div class="notice error" role="alert">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3.6M8 11.2v.2" />
                    </svg>
                    <div class="body">
                      <strong>Hugging Face 需要登录</strong>
                      <p>Token 无效或已过期。更新 Token 后重试，当前页面不会丢失。</p>
                      <div class="acts">
                        <ui-button variant="secondary" size="sm" type="button" (click)="resolveAuth('settings')">
                          去设置
                        </ui-button>
                        <ui-button variant="secondary" size="sm" type="button" (click)="resolveAuth('retry')">
                          重试
                        </ui-button>
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
                @if (warnInfo()) {
                  <div class="notice info" role="status">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 7.4v3.2M8 4.9v.2" />
                    </svg>
                    <div class="body">
                      <strong>{{ warnInfo() }}</strong>
                      <p>这是可继续的提示，不需要用户停下手上的事。</p>
                    </div>
                  </div>
                } @else {
                  <div class="notice warn" role="status">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M8 2 15 14H1z" />
                      <path d="M8 6v4M8 12.2v.2" />
                    </svg>
                    <div class="body">
                      <strong>本机显存可能不足</strong>
                      <p>推荐组合预计 28.9 GB，显卡 16 GB。可继续下载，运行时需要分层加载。</p>
                      <div class="acts">
                        <ui-button variant="secondary" size="sm" type="button" (click)="acceptWarn()">仍要下载</ui-button>
                        <ui-button variant="ghost" size="sm" type="button" (click)="switchSmaller()">
                          换更小版本
                        </ui-button>
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
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 7.4v3.2M8 4.9v.2" />
                  </svg>
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
                @if (undoDone()) {
                  <div class="notice info" role="status">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 7.4v3.2M8 4.9v.2" />
                    </svg>
                    <div class="body">
                      <strong>已恢复 3 个文件 · 14.9 GB</strong>
                      <p>回到原目录，模型库与工作流引用未受影响。</p>
                    </div>
                  </div>
                } @else {
                  <div class="notice ok" role="status">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 8.4 6.2 11.6 13 4.8" />
                    </svg>
                    <div class="body">
                      <strong>已移入回收站</strong>
                      <p>3 个文件 · 14.9 GB。可在资源管理器中恢复。</p>
                      <div class="acts">
                        <ui-button variant="secondary" size="sm" type="button" (click)="undoDone.set(true)">
                          撤销
                        </ui-button>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>

          <div class="l1-reset">
            <ui-button variant="secondary" type="button" (click)="resetNotices()">重置 L1 示例</ui-button>
          </div>

          <h3>L2 字段错误 · 只影响一个输入框</h3>
          <div class="card">
            <div class="card-body">
              <div class="field-demo">
                <label for="es-repo">模型 ID</label>
                <div class="input" [class.bad]="!!repoError()">
                  <input
                    id="es-repo"
                    type="text"
                    [value]="repoValue()"
                    [attr.aria-invalid]="!!repoError()"
                    [attr.aria-describedby]="repoError() ? 'es-repo-err' : 'es-repo-ok'"
                    (input)="onRepoInput($event)"
                  />
                </div>
                @if (repoError()) {
                  <span class="field-msg" id="es-repo-err" role="alert">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3.6M8 11.2v.2" />
                    </svg>
                    {{ repoError() }}
                  </span>
                } @else {
                  <span class="field-msg ok" id="es-repo-ok">格式正确，可以解析。</span>
                }
              </div>
              <ui-button variant="secondary" type="button" (click)="useValidRepo()">
                改用 Comfy-Org/MiniMax-H3-Image
              </ui-button>
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
                @if (demoError()) {
                  <div class="toast-demo">
                    <ui-toast tone="error" title="复制失败" [dismissible]="true" (dismiss)="demoError.set(false)">
                      剪贴板权限被浏览器拒绝。可手动选择路径。
                    </ui-toast>
                  </div>
                } @else {
                  <p class="demo-off">已关闭。错误 Toast 6 秒自动消失，也可以手动关。</p>
                }
                <ui-button class="trigger" variant="secondary" size="sm" type="button" (click)="triggerToast('error')">
                  触发错误 Toast
                </ui-button>
              </div>
            </div>

            <div class="card">
              <div class="card-head">
                <h3>成功 Toast · 不抢焦点</h3>
                <ui-badge tone="green">3s · role=status</ui-badge>
              </div>
              <div class="card-body">
                @if (demoOk()) {
                  <div class="toast-demo">
                    <ui-toast tone="ok" title="已复制路径" [dismissible]="true" (dismiss)="demoOk.set(false)">
                      workspace/models/diffusion_models/
                    </ui-toast>
                  </div>
                } @else {
                  <p class="demo-off">已关闭。成功 Toast 3 秒自动消失。</p>
                }
                <ui-button class="trigger" variant="secondary" size="sm" type="button" (click)="triggerToast('ok')">
                  触发成功 Toast
                </ui-button>
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
                    <ui-button variant="secondary" type="button" (click)="cancelPreview()">取消</ui-button>
                    <ui-button variant="danger" type="button" (click)="openDialog()">
                      删除 3 个文件
                    </ui-button>
                  </div>
                </div>
              </div>
              @if (dialogNote()) {
                <p class="hint" role="status">{{ dialogNote() }}</p>
              }
              <ui-button class="trigger" variant="secondary" size="sm" type="button" (click)="openDialog()">
                打开删除确认弹层
              </ui-button>
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
                  <ui-source-chip
                    label="Hugging Face"
                    [active]="gate() === 'Hugging Face'"
                    (picked)="gate.set('Hugging Face')"
                  />
                  <ui-source-chip
                    label="Civitai"
                    state="down"
                    tip="探针不可达：三条通路均超时"
                  />
                  <ui-source-chip
                    label="ModelScope"
                    [active]="gate() === 'ModelScope'"
                    (picked)="gate.set('ModelScope')"
                  />
                </div>
                <p class="hint">
                  当前入口：{{ gate() }}。不可达的源不提供入口，原因只进 hover
                  提示；页面不出现一整块红色说明。
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
                <tr>
                  <th>场景</th>
                  <th>不要写</th>
                  <th>应该写</th>
                </tr>
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
                <tr>
                  <th>层级</th>
                  <th>外观</th>
                  <th>位置 / 行为</th>
                  <th>无障碍</th>
                </tr>
              </thead>
              <tbody>
                @for (row of specRows; track row.level) {
                  <tr>
                    <td>
                      @if (row.tone) {
                        <span
                          class="dot inline"
                          [class.d-err]="row.tone === 'err'"
                          [class.d-warn]="row.tone === 'warn'"
                          [class.d-info]="row.tone === 'info'"
                          [class.d-ok]="row.tone === 'ok'"
                        ></span>
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
            <strong>禁止：</strong>把原始异常 / 堆栈 / URL 直接印在页面上；同一错误在顶部和弹层各出现一次；用
            Toast 承载需要用户决策的错误；用红色表达「没有结果」；同时给两个主按钮。
          </p>
        </section>

        <!-- 真实 Toast 栈：原型里用来验证触发/关闭/自动消失 -->
        @if (toasts().length) {
          <div class="toast-stack">
            @for (toast of toasts(); track toast.id) {
              <ui-toast
                class="floating"
                [tone]="toast.tone"
                [title]="toast.title"
                [dismissible]="true"
                (dismiss)="dismissToast(toast.id)"
              >
                {{ toast.body }}
              </ui-toast>
            }
          </div>
        }

        <!-- 真实阻断弹层 -->
        @if (dialogOpen()) {
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
              <p id="es-dlg-desc">
                将从磁盘移除 3 个文件，模型库条目也会消失。工作流引用会变成缺失状态。
              </p>
              <div class="do">这个操作不可撤销。Esc 或点遮罩可以取消。</div>
              <div class="row">
                <ui-button #cancelBtn variant="secondary" type="button" (click)="closeDialog()">
                  取消
                </ui-button>
                <ui-button variant="danger" type="button" (click)="confirmDelete()">
                  删除 3 个文件
                </ui-button>
              </div>
            </div>
          </div>
        }
      </div>
    </app-proto-shell>
  `,
})
export class ProtoErrorStatesComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly cancelBtn = viewChild<UiButtonComponent>('cancelBtn');

  readonly authInfo = signal('');
  readonly warnInfo = signal('');
  readonly undoDone = signal(false);
  readonly repoValue = signal('MiniMaxAI/MiniMax-H3-Image');
  readonly repoError = signal('这个仓库不存在。检查拼写，或从发现页选择模型。');
  readonly demoError = signal(true);
  readonly demoOk = signal(true);
  readonly dialogOpen = signal(false);
  readonly dialogNote = signal('');
  readonly gate = signal('Hugging Face');
  readonly toasts = signal<ToastItem[]>([]);

  private toastSeq = 0;
  private readonly toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

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
    {
      level: '行内错误',
      look: '3px 左描边 + 淡红底 + 图标 + 标题 + 说明 + 最多两个按钮',
      where: '出现在受影响区域上方；不自动消失；可重试',
      a11y: 'role="alert"',
      tone: 'err',
    },
    {
      level: '行内警告',
      look: '同上，琥珀色',
      where: '可继续的操作前；给出「仍要继续」',
      a11y: 'role="status"',
      tone: 'warn',
    },
    {
      level: '提示',
      look: '淡靛底 / 左描边',
      where: '解释自动行为（切镜像、重试成功）',
      a11y: 'role="status"',
      tone: 'info',
    },
    {
      level: '成功',
      look: '淡绿底 + 对勾',
      where: '只在有后续动作（撤销 / 打开）时需要',
      a11y: 'role="status"',
      tone: 'ok',
    },
    {
      level: '字段错误',
      look: '输入框红边 + 下方 11px 说明',
      where: '紧贴字段；不弹 Toast',
      a11y: 'aria-invalid + aria-describedby',
      tone: '',
    },
    {
      level: 'Toast',
      look: '360px，右下角，阴影，关闭按钮',
      where: '错误 6s、成功 3s；悬停暂停',
      a11y: 'role="alert" / role="status"',
      tone: '',
    },
    {
      level: '阻断弹层',
      look: '居中 420px，唯一主操作',
      where: '删除 / 覆盖 / 不可撤销',
      a11y: 'role="alertdialog" + 焦点圈闭 + Esc',
      tone: '',
    },
    {
      level: '不可用',
      look: '灰置 chip / 禁用按钮',
      where: '原因进 hover 提示',
      a11y: 'aria-disabled="true" + title',
      tone: '',
    },
    {
      level: '空状态',
      look: '中性图标 + 一句标题 + 一句说明',
      where: '无数据，不是失败',
      a11y: '普通文本，不播报为错误',
      tone: '',
    },
  ];

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const timer of this.toastTimers.values()) clearTimeout(timer);
      this.toastTimers.clear();
    });
  }

  resolveAuth(mode: 'settings' | 'retry'): void {
    this.authInfo.set(
      mode === 'settings'
        ? '已打开 Token 设置 · 更新后回到本页重试'
        : '重试成功 · Hugging Face 搜索已恢复',
    );
  }

  resetNotices(): void {
    this.authInfo.set('');
    this.warnInfo.set('');
    this.undoDone.set(false);
  }

  acceptWarn(): void {
    this.warnInfo.set('已继续下载 · 运行时按需分层加载');
  }

  switchSmaller(): void {
    this.warnInfo.set('已切换到 W4A8 单文件组合 · 预计 28.9 GB');
  }

  onRepoInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.repoValue.set(value);
    this.repoError.set(this.validateRepo(value));
  }

  useValidRepo(): void {
    this.repoValue.set('Comfy-Org/MiniMax-H3-Image');
    this.repoError.set('');
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
      this.demoError.set(true);
      this.showToast('error', '复制失败', '剪贴板权限被浏览器拒绝。可手动选择路径。');
    } else {
      this.demoOk.set(true);
      this.showToast('ok', '已复制路径', 'workspace/models/diffusion_models/');
    }
  }

  private showToast(tone: 'error' | 'ok', title: string, body: string): void {
    const id = ++this.toastSeq;
    this.toasts.update((list) => [...list, { id, tone, title, body }]);
    const timer = setTimeout(() => this.dismissToast(id), tone === 'error' ? 6000 : 3000);
    this.toastTimers.set(id, timer);
  }

  dismissToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (timer) clearTimeout(timer);
    this.toastTimers.delete(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  cancelPreview(): void {
    this.dialogNote.set('已取消（预览里的操作没有副作用）。');
  }

  openDialog(): void {
    this.dialogOpen.set(true);
    this.dialogNote.set('');
    afterNextRender(() => this.cancelBtn()?.focus(), { injector: this.injector });
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  confirmDelete(): void {
    this.dialogOpen.set(false);
    this.dialogNote.set('已删除 3 个文件 · 模型库条目已移除，可在回收站恢复。');
    this.showToast('ok', '已删除 3 个文件', '模型库条目已移除，可在回收站恢复。');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.dialogOpen()) this.closeDialog();
  }
}
