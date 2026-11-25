import { NoticeComponent } from '../../../../ui/notice';
import { TableComponent } from '../../../../ui/table';
import { UiButtonComponent } from '../../../../ui/button';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { BadgeComponent } from '../../../../ui/badge';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { PanelComponent } from '../../../../ui/panel';
import { UiMaterialModule } from '../../../../ui/material';
import { ProtoShellComponent } from '../../proto-shell';

type BadgeTone = 'gray' | 'blue' | 'green' | 'orange' | 'red';

interface PathChip {
  text: string;
  tone: BadgeTone;
}

interface ProbeSource {
  key: string;
  mark: string;
  name: string;
  sub: string;
  paths: PathChip[];
  verdictText: string;
  verdictTone: BadgeTone;
  latency: string;
  time: string;
  busy: boolean;
  down: boolean;
  local: boolean;
  canUseProxy: boolean;
  why: string | null;
}

/** 统一源探针原型：探针结论、三种时间态、门控到发现页/下载页的形态。样例数据写死在组件里。 */
@Component({
  selector: 'app-proto-source-probe',
  imports: [
    ProtoShellComponent,
    PageHeaderComponent,
    PanelComponent,
    BadgeComponent,
    UiMaterialModule,
    UiButtonComponent,
    TableComponent,
    NoticeComponent,
  ],
  styleUrl: './source-probe.scss',
  template: `
    <app-proto-shell active="resources" title="统一源探针" hint="结论、时间态与下游门控">
      <div class="page">
        <ui-page-header
          kicker="VIS Draft · Source Probe & Source Gating"
          title="统一源探针 · 源可用性门控"
          hint="这一页回答三件事：一次探测怎么覆盖所有对外源、探针结论长什么样、结论怎么作用到发现页与下载页。"
        />

        <ui-notice tone="warn" icon="!">
          页内所有延迟、耗时与时间点都是<b>示意值</b>，不是实测结果；灰色源是拿来说明「不可达」长什么样的示例。
        </ui-notice>

        <!-- ══════════════ 00 ══════════════ -->
        <section class="proto-section">
          <h2 class="proto-h2"><span class="num">00</span>结论速览</h2>
          <p class="lead">先给结论，再看形态。下面每一条都对应页内某一节。</p>
          <div class="cols3">
            @for (point of overview; track point.title) {
              <div class="tile">
                <b>{{ point.title }}</b>
                <span class="tiny">{{ point.text }}</span>
              </div>
            }
          </div>
        </section>

        <!-- ══════════════ 01 ══════════════ -->
        <section class="proto-section">
          <ui-panel
            kicker="Connection"
            title="源状态"
            hint="7 个源一次探完 · 结论带延迟与时间戳 · 不可达源整行灰置并给一行原因"
          >
            <div panel-actions class="head-actions">
              <ui-badge tone="gray">{{ probeSummary() }}</ui-badge>
              <ui-badge [tone]="retested() ? 'blue' : 'gray'">{{ lastProbe() }}</ui-badge>
              <ui-button variant="secondary" type="button" (click)="retestAll()" [disabled]="retestingAll()">
                {{ retestingAll() ? '探测中…' : '重新探测全部' }}
              </ui-button>
            </div>

            <div class="src-list">
              @for (s of sources(); track s.key) {
                <div
                  [class]="
                    'src-row' +
                    (s.down ? ' is-down' : '') +
                    (s.local ? ' is-local' : '') +
                    (s.busy ? ' is-busy' : '')
                  "
                >
                  <div class="src-id">
                    <span class="src-mark">{{ s.mark }}</span>
                    <div class="src-id-text">
                      <span class="src-name">{{ s.name }}</span>
                      <span class="src-sub mono">{{ s.sub }}</span>
                    </div>
                  </div>

                  <div class="src-path">
                    @for (p of s.paths; track p.text) {
                      <ui-badge [tone]="p.tone">{{ p.text }}</ui-badge>
                    }
                  </div>

                  <div class="src-verdict">
                    @if (s.busy) {
                      <span class="skel w60"></span>
                      <span class="skel w40"></span>
                    } @else {
                      <ui-badge [tone]="s.verdictTone">{{ s.verdictText }}</ui-badge>
                      <span class="tiny mono">{{ s.latency }}</span>
                    }
                  </div>

                  <span class="src-time mono">{{ s.busy ? '—' : s.time }}</span>

                  <div class="src-act">
                    @if (s.canUseProxy && !s.busy) {
                      <ui-button variant="secondary" size="xs" type="button" (click)="useProxy(s.key)">改走代理</ui-button>
                    }
                    @if (!s.local) {
                      <ui-button
                        [variant]="s.canUseProxy ? 'ghost' : 'secondary'"
                        size="xs"
                        type="button"
                        (click)="retestOne(s.key)"
                        [disabled]="s.busy"
                      >
                        {{ s.busy ? '探测中' : '重新探测' }}
                      </ui-button>
                    }
                  </div>
                </div>

                @if (s.why) {
                  <p class="src-why">{{ s.why }}</p>
                }
              }
            </div>

            <div class="cols2 hint-row">
              <div class="probe-hint">
                <b>字段各回答一个问题：</b>源名与接口 = 这是谁；通路列 = 直连 / 代理 / 镜像各自的结果；
                结论 = 当前生效通路能不能用；延迟 = 用的是哪条路径的数；时间 = 这个结论有多旧。
              </div>
              <div class="probe-hint">
                <b>为什么不通行只给一列：</b>用户要的是「现在能不能用」，不是「八种可能里中了哪一种」。
                失败分类（DNS / 超时 / TLS / 4xx / 5xx）留在详情与规格里，界面上只留一句人话 + 一个可执行动作。
              </div>
            </div>
          </ui-panel>
        </section>

        <!-- ══════════════ 02 ══════════════ -->
        <section class="proto-section">
          <h2 class="proto-h2"><span class="num">02</span>三种时间态</h2>
          <p class="lead">探针是异步的，界面必须能说清「现在看到的是新结论还是旧结论」。</p>
          <div class="cols3">
            <div class="state-card">
              <div class="state-head">
                <span class="kicker">State 1</span>
                <b>探测中</b>
              </div>
              <div class="state-body">
                <div class="state-row is-busy">
                  <span class="src-mark">CI</span>
                  <div class="state-id">
                    <b>CivitAI</b>
                    <span class="mono">civitai.red/api/v1/models</span>
                  </div>
                  <ui-badge tone="gray">探测中…</ui-badge>
                </div>
                <div class="loading-line">正在探测 4 / 7 · 直连与代理并行</div>
                <p class="tiny">
                  其它源<b>保留上一次结论</b>，不清空 —— 探测是后台动作，不该让整页退回空白。
                </p>
              </div>
            </div>

            <div class="state-card">
              <div class="state-head">
                <span class="kicker">State 2</span>
                <b>结果已过期</b>
              </div>
              <div class="state-body">
                <div class="state-row is-stale">
                  <span class="src-mark">MS</span>
                  <div class="state-id">
                    <b>ModelScope</b>
                    <span class="mono">modelscope.cn/openapi/v1/models</span>
                  </div>
                  <div class="state-verdict">
                    <ui-badge tone="orange">结果已过期</ui-badge>
                    <span class="tiny mono">96 ms · 4 小时前</span>
                  </div>
                </div>
                <p class="tiny">
                  过期的结论<b>照旧可用</b>，但字色降级、徽章换成「已过期」。过期<b>不等于不可用</b>，
                  更不等于未知 —— 它是一个仍然有效但可能不准的结论。
                </p>
              </div>
            </div>

            <div class="state-card">
              <div class="state-head">
                <span class="kicker">State 3</span>
                <b>重新探测</b>
              </div>
              <div class="state-body">
                <ul class="state-list tiny">
                  <li>入口在每张源卡右上角 + 面板顶部「重新探测全部」。</li>
                  <li>点单源 = 只探这一个源的两条通路；点全部 = 7 个源并发探一轮。</li>
                  <li><b>冷却 10 秒</b>：连续点不重复打外网，也不让按钮变成假忙碌。</li>
                  <li>触发后台刷新时<b>先返回旧结论</b>，不阻塞页面。</li>
                  <li>改代理地址、改某源通路、改镜像前缀 → <b>立即作废该源缓存</b>，不必等 TTL。</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <!-- ══════════════ 03 ══════════════ -->
        <section class="proto-section">
          <h2 class="proto-h2"><span class="num">03</span>门控怎么作用到下游</h2>
          <p class="lead">
            用户的要求是「探针探出来连不上的源，就不要在发现页或者下载里支持」。
            <b>「不提供可选入口」有两种做法，代价不同</b>，这里并排摆出来。
          </p>

          <div class="split">
            <div class="option-card">
              <div class="option-head">
                <div>
                  <p class="kicker">Option A</p>
                  <b>入口直接消失</b>
                </div>
                <ui-badge tone="gray">未采纳</ui-badge>
              </div>
              <div class="option-body">
                <div class="mock">
                  <div class="mock-bar">
                    <span class="mock-count"><b>128</b><span>个模型</span></span>
                    <span class="tiny">来自 2 个源</span>
                  </div>
                  <div class="mock-filters">
                    <span class="vis-mock-chip on">全部</span>
                    <span class="vis-mock-chip">Hugging Face</span>
                    <span class="vis-mock-chip">ModelScope</span>
                    <span class="tiny mock-tail">来源筛选</span>
                  </div>
                  <div class="mock-row">
                    <div class="mock-card"></div>
                    <div class="mock-card"></div>
                    <div class="mock-card"></div>
                  </div>
                </div>
                <ui-notice tone="error" icon="!">
                  <b>代价：</b>CivitAI 的入口整个不见了，用户会以为「这个产品不支持 CivitAI」，
                  而不是「现在这台机器连不上 CivitAI」。网络一换，界面自己变了，用户无从察觉。
                </ui-notice>
                <ui-notice tone="ok" icon="✓">
                  <b>好处：</b>最干净，不给任何可能失败的点击。
                </ui-notice>
              </div>
            </div>

            <div class="option-card">
              <div class="option-head">
                <div>
                  <p class="kicker">Option B</p>
                  <b>灰置 + 一行原因</b>
                </div>
                <ui-badge tone="green">推荐</ui-badge>
              </div>
              <div class="option-body">
                <div class="mock">
                  <div class="mock-bar">
                    <span class="mock-count"><b>128</b><span>个模型</span></span>
                    <span class="tiny">来自 2 个可用源</span>
                  </div>
                  <div class="mock-filters">
                    <span class="vis-mock-chip on">全部</span>
                    <span class="vis-mock-chip">Hugging Face</span>
                    <span class="vis-mock-chip">ModelScope</span>
                    <span class="vis-mock-chip off" title="直连超时，已停用">CivitAI</span>
                    <span class="tiny mock-tail">来源筛选</span>
                  </div>
                  <p class="mock-notice">
                    CivitAI 当前不可达（直连超时），已停用该源的搜索与下载。
                    <a href="#source-probe-decisions">代理通路可用 → 去设置</a>
                  </p>
                  <div class="mock-row">
                    <div class="mock-card"></div>
                    <div class="mock-card"></div>
                    <div class="mock-card"></div>
                  </div>
                </div>
                <ui-notice tone="ok" icon="✓">
                  <b>好处：</b>灰置的 chip <b>不是可选入口</b>（点不动、不发请求），满足了「不提供该源的可选入口」；
                  同时把原因说清楚，并给一个能修的动作。源还在，只是现在到不了。
                </ui-notice>
                <ui-notice tone="error" icon="!">
                  <b>代价：</b>界面上多了一行状态说明；筛选条里会留一个不可点的灰 chip。
                </ui-notice>
              </div>
            </div>
          </div>

          <h3 class="proto-h3">下载页同一套语言</h3>
          <div class="split">
            <div class="option-card">
              <div class="option-head">
                <div>
                  <p class="kicker">Option A</p>
                  <b>来源下拉里没有 CivitAI</b>
                </div>
                <ui-badge tone="gray">未采纳</ui-badge>
              </div>
              <div class="option-body">
                <div class="mock mock-plain">
                  <label class="mock-label" for="probe-download-source-a">下载源</label>
                  <select id="probe-download-source-a" disabled>
                    <option>Hugging Face</option>
                    <option>ModelScope</option>
                  </select>
                  <p class="tiny">用户看到「没有 CivitAI」，不知道是自己没配还是网络问题。</p>
                </div>
              </div>
            </div>

            <div class="option-card">
              <div class="option-head">
                <div>
                  <p class="kicker">Option B</p>
                  <b>选项保留但禁用，并写清原因</b>
                </div>
                <ui-badge tone="green">推荐</ui-badge>
              </div>
              <div class="option-body">
                <div class="mock mock-plain">
                  <label class="mock-label" for="probe-download-source-b">下载源</label>
                  <select id="probe-download-source-b" disabled>
                    <option>Hugging Face（可达）</option>
                    <option>ModelScope（可达）</option>
                    <option>CivitAI — 不可达（直连超时）</option>
                  </select>
                  <p class="mock-notice">CivitAI 不可达，已从可选项中停用。</p>
                </div>
              </div>
            </div>
          </div>

          <h3 class="proto-h3">四种状态在界面上要能分开</h3>
          <div class="table-card">
            <ui-table>
<table>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>徽章</th>
                    <th>提供入口</th>
                    <th>发请求</th>
                    <th>界面文案</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><b>可用</b></td>
                    <td><ui-badge tone="green">可用</ui-badge></td>
                    <td>是</td>
                    <td>是</td>
                    <td class="muted">正常，不加任何额外说明</td>
                  </tr>
                  <tr>
                    <td>
                      <b>降级</b><br /><span class="tiny">主通路失败、备用通路成功</span>
                    </td>
                    <td><ui-badge tone="orange">已降级 · 走代理</ui-badge></td>
                    <td>是（标注降级）</td>
                    <td>是（走备用通路）</td>
                    <td class="muted">「直连不通，已改走代理 · 412 ms」</td>
                  </tr>
                  <tr>
                    <td><b>不可用</b></td>
                    <td><ui-badge tone="red">不可用</ui-badge></td>
                    <td><b>否</b>（灰置）</td>
                    <td><b>否</b></td>
                    <td class="muted">「直连超时 · 代理可用 → 去设置」</td>
                  </tr>
                  <tr>
                    <td>
                      <b>未知</b><br /><span class="tiny">未探测 / 结果已过期</span>
                    </td>
                    <td><ui-badge tone="gray">未探测</ui-badge></td>
                    <td>是（<b>不门控</b>）</td>
                    <td>是</td>
                    <td class="muted">「还没探过 · 探测一次」——没探过不等于不可用</td>
                  </tr>
                </tbody>
              </table>
</ui-table>
            <p class="tiny table-foot">
              <b>关键一条：</b>「不可用」才门控，「未知」不门控。否则第一次打开应用、还没探测过，
              所有源都不出现 —— 那不叫门控，那叫把产品藏起来。
            </p>
          </div>
        </section>

        <!-- ══════════════ 04 ══════════════ -->
        <section class="proto-section">
          <h2 class="proto-h2"><span class="num">04</span>默认配置怎么写才不像随手定的</h2>
          <p class="lead">
            「HF 和 GH 默认走代理、CivitAI 默认直连」这件事，光给一个开关位，用户只会当成随手一勾。
            写法上要给出<b>依据</b>，并且给出<b>这默认值在什么条件下会失效</b>。
          </p>

          <div class="table-card">
            <ui-table>
<table>
                <thead>
                  <tr>
                    <th>源</th>
                    <th>默认通路</th>
                    <th>为什么是这个值</th>
                    <th>探针能改吗</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><b>Hugging Face</b></td>
                    <td><ui-badge tone="blue">经代理</ui-badge></td>
                    <td class="muted">墙内直连最容易失败；权重体积大，失败一次代价高（重来一遍）。</td>
                    <td class="muted">否（探针只报告，不改配置）</td>
                  </tr>
                  <tr>
                    <td><b>GitHub</b></td>
                    <td><ui-badge tone="blue">经代理</ui-badge></td>
                    <td class="muted">
                      节点清单、官方模板、工作流都走 raw.githubusercontent.com，直连不稳且失败是「整个节点页空掉」。
                    </td>
                    <td class="muted">否</td>
                  </tr>
                  <tr>
                    <td><b>CivitAI</b></td>
                    <td><ui-badge tone="gray">直连</ui-badge></td>
                    <td class="muted">
                      直连多数可用；套代理会多一跳、明显变慢。不可达时探针会提示「代理可用」，一键改。
                    </td>
                    <td class="muted">否（给「改走代理」按钮，但那是用户的动作）</td>
                  </tr>
                  <tr>
                    <td><b>ModelScope</b></td>
                    <td><ui-badge tone="gray">直连</ui-badge></td>
                    <td class="muted">魔搭本身境内可直连，默认不需要代理。</td>
                    <td class="muted">否</td>
                  </tr>
                  <tr>
                    <td><b>ComfyUI 官方模板 / ComfyHub</b></td>
                    <td><ui-badge tone="gray">直连</ui-badge></td>
                    <td class="muted">免鉴权固定源；模板走 raw 域（已并入 GitHub 一起探）。</td>
                    <td class="muted">否</td>
                  </tr>
                  <tr>
                    <td><b>Demo</b></td>
                    <td><ui-badge tone="gray">本地</ui-badge></td>
                    <td class="muted">本地假数据，不出网，不参与探测；所有外网源都不可用时的兜底。</td>
                    <td class="muted">—</td>
                  </tr>
                </tbody>
              </table>
</ui-table>
            <p class="probe-hint">
              <b>一句话口径：</b>默认走代理的两个源，是「失败代价最高」的那两个；默认直连的，是「直连本来就通」的那些。
              默认不是猜的，是按<b>失败代价</b>排的。
            </p>
          </div>
        </section>

        <!-- ══════════════ 05 ══════════════ -->
        <section class="proto-section">
          <h2 class="proto-h2"><span class="num">05</span>候选方案 · 探针放在哪</h2>
          <p class="lead">同样的探针结论，放的位置不同，设置页的信息密度和用户的动线也不同。</p>

          <div class="split">
            <div class="option-card">
              <div class="option-head">
                <div>
                  <p class="kicker">Option A</p>
                  <b>内嵌在设置页每张源卡里</b>
                </div>
                <ui-badge tone="gray">备选</ui-badge>
              </div>
              <div class="option-body">
                <div class="mini-panel">
                  <div class="mini-head">
                    <b>Hugging Face</b>
                    <ui-badge tone="green">可达 · 312 ms</ui-badge>
                  </div>
                  <div class="mini-fields">
                    <span class="mini-field">
                      <span class="mock-label">Access Token</span>
                      <span class="mini-input">私有仓库需要</span>
                    </span>
                    <span class="mini-field">
                      <span class="mock-label">启用代理</span>
                      <span class="mini-check">✓ 经 127.0.0.1:7890</span>
                    </span>
                  </div>
                  <p class="tiny">直连 ✕ 超时 · 代理 ✓ · 3 分钟前 [重新探测]</p>
                </div>
                <ul class="state-list tiny">
                  <li><b>好处：</b>配置与结论挨着，改完立刻看到结果；不需要跳转。</li>
                  <li>
                    <b>代价：</b>4 张源卡各挂一条探测带，设置页变长一倍；「改配置」和「看状态」两件事挤在一张卡里。
                  </li>
                  <li><b>代价：</b>「重新探测全部」没有天然位置；批量重探要在每张卡上点 4 次。</li>
                </ul>
              </div>
            </div>

            <div class="option-card">
              <div class="option-head">
                <div>
                  <p class="kicker">Option B</p>
                  <b>独立「连接体检」面板 + 设置页摘要</b>
                </div>
                <ui-badge tone="green">推荐</ui-badge>
              </div>
              <div class="option-body">
                <div class="mini-panel">
                  <div class="mini-head">
                    <b>连接体检</b>
                    <ui-badge tone="orange">1 个源不可用</ui-badge>
                  </div>
                  <p class="tiny">
                    7 个源 · 5 可用 · 1 不可用 · 1 未探测 · 上次 3 分钟前 [重新探测全部]
                  </p>
                  <div class="mini-list">
                    <div class="mini-row">
                      <b>Hugging Face</b>
                      <ui-badge tone="green">可达</ui-badge>
                      <span class="tiny mono">312 ms</span>
                    </div>
                    <div class="mini-row">
                      <b>CivitAI</b>
                      <ui-badge tone="red">不可用</ui-badge>
                      <span class="tiny mono">直连超时</span>
                    </div>
                  </div>
                </div>
                <div class="mini-panel">
                  <div class="mini-head"><b>设置页里的摘要位</b></div>
                  <p class="tiny">连接体检 · 5 可用 · 1 不可用（CivitAI） [打开体检]</p>
                </div>
                <ul class="state-list tiny">
                  <li>
                    <b>好处：</b>状态集中在一处，一眼看完、一键重探；设置页保持干净，「默认配置」不被诊断信息淹没。
                  </li>
                  <li><b>代价：</b>想看某个源的明细要多点一次；改完代理后要记得回体检面板重探。</li>
                </ul>
              </div>
            </div>
          </div>

          <div class="probe-hint">
            <b>推荐 Option B。</b>理由：设置页这一轮的主题是「减负」，把 7 条诊断信息塞回 4 张源卡里，
            等于把刚减下去的复杂度换个地方再加回来。体检面板让「状态」和「配置」各占一页各说一件事；
            设置页只留一行摘要 + 入口，不丢信息。
          </div>
        </section>

        <!-- ══════════════ 06 ══════════════ -->
        <section class="proto-section" id="source-probe-decisions">
          <h2 class="proto-h2"><span class="num">06</span>需要拍板的点</h2>
          <p class="lead">这一页已经把选项摆开了，下面四条是真正需要拍板的。</p>
          <div class="table-card">
            <ui-table>
<table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>决策点</th>
                    <th>推荐</th>
                    <th>另一选项的代价</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="num">1</td>
                    <td><b>不可达源是消失还是灰置？</b></td>
                    <td><ui-badge tone="green">灰置 + 一行原因</ui-badge></td>
                    <td class="muted">消失更干净，但用户会以为产品不支持这个源，且网络一变界面自己变了</td>
                  </tr>
                  <tr>
                    <td class="num">2</td>
                    <td><b>探针结果放设置页还是独立面板？</b></td>
                    <td><ui-badge tone="green">独立「连接体检」面板</ui-badge></td>
                    <td class="muted">内嵌则设置页变长一倍，与「减负」目标相反</td>
                  </tr>
                  <tr>
                    <td class="num">3</td>
                    <td><b>探针能不能自动改配置？</b></td>
                    <td><ui-badge tone="green">不能，只给「改走代理」按钮</ui-badge></td>
                    <td class="muted">自动改 = 机器替用户改网络策略；误判时用户很难察觉已被改动</td>
                  </tr>
                  <tr>
                    <td class="num">4</td>
                    <td><b>老用户的 CivitAI 代理开关要不要跟着改默认值？</b></td>
                    <td><ui-badge tone="green">不自动改，设置页提示差异</ui-badge></td>
                    <td class="muted">自动改 = 偷偷改用户已保存的设置；不自动改 = 新老用户行为不一致</td>
                  </tr>
                </tbody>
              </table>
</ui-table>
          </div>
        </section>
      </div>
    </app-proto-shell>
  `,
})
export class ProtoSourceProbeComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  readonly overview = [
    {
      title: '探针覆盖范围',
      text: '一次探测覆盖 7 个源；每个源探两条通路（直连 / 经代理），Hugging Face 另探镜像。结论只回答「能不能连上」，不回答「要不要下载」。',
    },
    {
      title: '门控 · 推荐',
      text: '不可达源在发现页与下载页灰置 + 一行原因，不直接消失。消失 = 用户以为产品没这个源；灰置 = 用户知道有、知道为什么、知道去哪修。',
    },
    {
      title: '默认通路',
      text: 'Hugging Face 与 GitHub 默认走代理（墙内直连最易失败）；CivitAI 默认直连。每条默认旁边都写清「为什么是这个值」。',
    },
    {
      title: '缓存与失效',
      text: '可达结论缓存 15 分钟、不可达 3 分钟。命中过期缓存时先返回旧结论并后台刷新，界面标「结果已过期」而不是假装没探过。',
    },
    {
      title: '逃生口',
      text: '每个源有「始终启用（忽略探针）」开关，放在高级区、默认关闭。探针误判时源不会被锁死。',
    },
    {
      title: '本轮边界',
      text: '页面上的延迟与时间点都是示意值；原型只演示形态与交互，不向任何站点发真实探测请求。',
    },
  ];

  readonly sources = signal<ProbeSource[]>([
    {
      key: 'huggingface',
      mark: 'HF',
      name: 'Hugging Face',
      sub: 'huggingface.co/api/models',
      paths: [
        { text: '直连 ✕ 超时', tone: 'gray' },
        { text: '代理 ✓', tone: 'green' },
      ],
      verdictText: '可达',
      verdictTone: 'green',
      latency: '312 ms · 经代理',
      time: '3 分钟前',
      busy: false,
      down: false,
      local: false,
      canUseProxy: false,
      why: null,
    },
    {
      key: 'github',
      mark: 'GH',
      name: 'GitHub',
      sub: 'api.github.com · raw.githubusercontent.com',
      paths: [
        { text: '直连 ✕ 超时', tone: 'gray' },
        { text: '代理 ✓', tone: 'green' },
      ],
      verdictText: '可达',
      verdictTone: 'green',
      latency: '185 ms · 经代理',
      time: '3 分钟前',
      busy: false,
      down: false,
      local: false,
      canUseProxy: false,
      why: null,
    },
    {
      key: 'civitai',
      mark: 'CI',
      name: 'CivitAI',
      sub: 'civitai.red/api/v1/models',
      paths: [
        { text: '直连 ✕ 超时', tone: 'gray' },
        { text: '代理 ✓ 210 ms', tone: 'green' },
      ],
      verdictText: '不可用',
      verdictTone: 'red',
      latency: '当前生效通路失败',
      time: '3 分钟前',
      busy: false,
      down: true,
      local: false,
      canUseProxy: true,
      why:
        '为什么：直连 5 秒超时（到 civitai.red:443 无响应），按当前设置走直连 → 不可用；经代理 210 ms 可达 —— 改走代理即可恢复，所以给的是「改走代理」而不是只给「重新探测」。',
    },
    {
      key: 'modelscope',
      mark: 'MS',
      name: 'ModelScope',
      sub: 'modelscope.cn/openapi/v1/models',
      paths: [
        { text: '直连 ✓', tone: 'green' },
        { text: '代理 —', tone: 'gray' },
      ],
      verdictText: '可达',
      verdictTone: 'green',
      latency: '96 ms · 直连',
      time: '3 分钟前',
      busy: false,
      down: false,
      local: false,
      canUseProxy: false,
      why: null,
    },
    {
      key: 'templates',
      mark: 'TP',
      name: 'ComfyUI 官方模板',
      sub: 'raw.githubusercontent.com/Comfy-Org/…',
      paths: [{ text: '直连 ✓', tone: 'green' }],
      verdictText: '可达',
      verdictTone: 'green',
      latency: '140 ms · 直连',
      time: '3 分钟前',
      busy: false,
      down: false,
      local: false,
      canUseProxy: false,
      why: null,
    },
    {
      key: 'comfyhub',
      mark: 'CH',
      name: 'ComfyHub',
      sub: 'comfy.org/workflows/download',
      paths: [{ text: '直连 ✓', tone: 'green' }],
      verdictText: '可达',
      verdictTone: 'green',
      latency: '220 ms · 直连',
      time: '3 分钟前',
      busy: false,
      down: false,
      local: false,
      canUseProxy: false,
      why: null,
    },
    {
      key: 'demo',
      mark: 'DM',
      name: 'Demo（离线演示）',
      sub: '本地假数据 · 不出网',
      paths: [{ text: '本地', tone: 'gray' }],
      verdictText: '不探测',
      verdictTone: 'gray',
      latency: '恒可用',
      time: '—',
      busy: false,
      down: false,
      local: true,
      canUseProxy: false,
      why: null,
    },
  ]);

  readonly retestingAll = signal(false);
  readonly lastProbe = signal('上次探测 · 3 分钟前');
  readonly retested = signal(false);

  readonly probeSummary = computed(() => {
    const list = this.sources();
    const down = list.filter((s) => s.down).length;
    const local = list.filter((s) => s.local).length;
    const ok = list.filter((s) => !s.local && !s.down).length;
    return `${list.length} 个源 · ${ok} 可用 · ${down} 不可用 · ${local} 本地`;
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers.clear();
    });
  }

  retestAll(): void {
    if (this.retestingAll()) return;
    this.retestingAll.set(true);
    this.sources.update((list) => list.map((s) => (s.local ? s : { ...s, busy: true })));
    this.later(() => {
      this.sources.update((list) =>
        list.map((s) => (s.local ? s : { ...s, busy: false, time: '刚刚' })),
      );
      this.lastProbe.set('上次探测 · 刚刚');
      this.retested.set(true);
      this.retestingAll.set(false);
    }, 1200);
  }

  retestOne(key: string): void {
    const source = this.sources().find((s) => s.key === key);
    if (!source || source.local || source.busy) return;
    this.sources.update((list) => list.map((s) => (s.key === key ? { ...s, busy: true } : s)));
    this.later(() => {
      this.sources.update((list) =>
        list.map((s) => (s.key === key ? { ...s, busy: false, time: '刚刚' } : s)),
      );
      this.lastProbe.set('上次探测 · 刚刚');
      this.retested.set(true);
    }, 900);
  }

  /** 不可达源的「改走代理」：只给动作，不自动改配置 —— 与决策表第 3 条一致。 */
  useProxy(key: string): void {
    this.sources.update((list) =>
      list.map((s) =>
        s.key === key
          ? {
              ...s,
              down: false,
              canUseProxy: false,
              why: null,
              verdictText: '可达',
              verdictTone: 'green' as BadgeTone,
              latency: '210 ms · 经代理',
              time: '刚刚',
            }
          : s,
      ),
    );
    this.lastProbe.set('上次探测 · 刚刚');
    this.retested.set(true);
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }
}
