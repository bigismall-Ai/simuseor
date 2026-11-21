import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import {
  DefMap,
  GraphInput,
  GraphIssue,
  GraphLink,
  GraphNode,
  GraphWidget,
  NodeDef,
  WorkflowGraph,
  applyDefs,
  autoLayout,
  cardHeight,
  connect,
  createNode,
  defsFromObjectInfo,
  disconnect,
  inputSource,
  SUPPLY_LINK_TYPES,
  isSupplyNode,
  nodeById,
  parseWorkflow,
  removeNode,
  serializeWorkflow,
  validateGraph,
  visibleInputs,
} from '../core/workflow-graph';
import {
  LocalWorkflow,
  WorkflowFile,
  WorkflowModelDep,
  WorkflowNodeDep,
  errMsg,
} from '../core/types';

type View = 'canvas' | 'ui' | 'api';
type Mode = 'pipeline' | 'free';
type InspTab = 'node' | 'deps' | 'checks';

const CARD_WIDTH = 210;
/** 跨过一列以上的线走顶部/底部总线，不再横穿画布 */
const BUS_SPAN = 320;
const BUS_GAP = 7;
const BUS_OFFSET = 30;

interface EdgeView {
  link: GraphLink;
  d: string;
  color: string;
  supply: boolean;
  hot: boolean;
  dim: boolean;
}

const ROLES: Record<string, string> = {
  model: '#6366f1',
  clip: '#0284c7',
  cond: '#8b5cf6',
  latent: '#d97706',
  image: '#059669',
  util: '#71717a',
};

@Component({
  selector: 'app-workflow-editor',
  standalone: true,
  imports: [FormsModule],
  host: {
    '(document:keydown)': 'onKey($event)',
    '(document:pointerup)': 'onDocPointerUp()',
  },
  template: `
    <div class="ed">
      <header class="top">
        <button class="back" (click)="back()" title="返回工作流列表">
          <svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" /></svg>
        </button>
        <div class="doc">
          <b>{{ file?.name || '工作流' }}</b>
          <small>{{ file ? (file.folder ? file.folder + ' / ' : '') + file.name + '.json' : path }}</small>
        </div>
        @if (file) {
          <span class="fmt-badge" [class.bad]="format === 'broken'">{{ formatLabel }}</span>
        }

        <div class="tabs" role="tablist">
          <button
            class="tab"
            [class.on]="view === 'canvas'"
            [disabled]="!graph"
            (click)="setView('canvas')"
            title="在画布上改参数、连线、增删节点"
          >画布</button>
          <button
            class="tab"
            [class.on]="view === 'ui'"
            [disabled]="format === 'api'"
            [title]="format === 'api' ? 'API 格式没有布局信息，无法生成 UI JSON' : 'UI 格式的原始 JSON'"
            (click)="setView('ui')"
          >{{ format === 'broken' ? 'JSON' : 'UI JSON' }}</button>
          <button
            class="tab"
            [class.on]="view === 'api'"
            [disabled]="format === 'broken'"
            [title]="format === 'ui' ? '根据当前画布生成的 API 预览（只读）' : 'API 格式 JSON'"
            (click)="setView('api')"
          >API</button>
        </div>

        <span class="spacer"></span>
        @if (jsonDirty) { <span class="json-dirty" title="JSON 有未应用的修改">JSON</span> }
        @if (dirty) { <span class="dirty" title="有未保存的修改"></span> }
        <button class="tb-ghost" title="撤销 (Ctrl+Z)" [disabled]="!canUndo" (click)="undo()">
          <svg viewBox="0 0 16 16"><path d="M5 6H2.5V3.5" /><path d="M2.8 6a5.5 5.5 0 1 1-1 4" /></svg>
        </button>
        <button class="tb-ghost" title="重做 (Ctrl+Shift+Z)" [disabled]="!canRedo" (click)="redo()">
          <svg viewBox="0 0 16 16"><path d="M11 6h2.5V3.5" /><path d="M13.2 6a5.5 5.5 0 1 0 1 4" /></svg>
        </button>
        <button class="btn primary" [disabled]="saving || !file" (click)="save()">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </header>

      @if (errorText) {
        <div class="banner err">
          <span>{{ errorText }}</span>
          <button class="banner-act" (click)="loadFile()">重新载入</button>
        </div>
      }
      @if (format === 'broken' && graph === null) {
        <div class="banner warn">
          <span>这个文件不是有效的工作流：UI 格式需要 nodes 数组，API 格式需要 class_type。可在下方修正后点「应用修改」。</span>
        </div>
      }

      <div class="main">
        <nav class="rail" aria-label="编辑器工具">
          <button class="rbtn on" title="选择 / 移动 (V)">
            <svg viewBox="0 0 18 18"><path d="M4 2.5 14 9l-4.4 1.1L7.4 15z" /></svg>
          </button>
          <button class="rbtn" title="添加节点" [disabled]="!graph" (click)="openPalette()">
            <svg viewBox="0 0 18 18"><path d="M9 3.5v11M3.5 9h11" /></svg>
          </button>
          <button class="rbtn" title="自动整理布局" [disabled]="!graph" (click)="layoutNow()">
            <svg viewBox="0 0 18 18"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="11" y="11" width="4.5" height="4.5" rx="1" /><path d="M7 4.7h3.2v6.4H11" /></svg>
          </button>
          <div class="rail-sep"></div>
          <button class="rbtn" title="依赖与模型" [disabled]="!graph" (click)="setInspTab('deps')">
            <svg viewBox="0 0 18 18"><path d="M6.2 3.5h5.6l3 3v5.6l-3 3H6.2l-3-3V6.5z" /><path d="M6.5 9h5" /></svg>
          </button>
          <button class="rbtn" title="检查结果" [disabled]="!graph" (click)="setInspTab('checks')">
            <svg viewBox="0 0 18 18"><path d="M9 2.5 16 15H2z" /><path d="M9 7v3.5M9 12.7v.1" /></svg>
            @if (issueErrors || issueWarns) { <span class="dot"></span> }
          </button>
        </nav>

        @if (loading) {
          <section class="ui-empty">正在读取工作流…</section>
        } @else if (view === 'canvas' && graph) {
          <section
            class="canvas"
            #canvas
            (pointerdown)="onCanvasDown($event)"
            (pointermove)="onCanvasMove($event)"
            (pointerup)="onCanvasUp($event)"
            (wheel)="onWheel($event)"
          >
            <div class="canvas-tools" (pointerdown)="$event.stopPropagation()">
              <div class="seg">
                <button [class.on]="mode === 'pipeline'" (click)="setMode('pipeline')" title="按数据流自动排版，不改文件里的坐标">流水线</button>
                <button [class.on]="mode === 'free'" [disabled]="format === 'api'" (click)="setMode('free')" title="恢复文件里的原始坐标，可拖动节点">自由</button>
              </div>
              <div class="seg">
                <button
                  data-testid="wf-supply"
                  [class.on]="showSupplyLinks"
                  [attr.aria-pressed]="showSupplyLinks"
                  (click)="toggleSupply()"
                  title="加载器、模型、采样器等配置连线默认收起；选中相关节点时会自动出现"
                >供给线{{ showSupplyLinks ? ' · 开' : '' }}</button>
                <button
                  data-testid="wf-bus-route"
                  [class.on]="busRouting"
                  [attr.aria-pressed]="busRouting"
                  (click)="busRouting = !busRouting"
                  title="需要拐弯的线走顶部/底部总线桥架；关闭后只有跨列长线走总线，短连线在列间走圆角折线"
                >总线走线{{ busRouting ? ' · 开' : '' }}</button>
              </div>
              <span class="hint">
                @if (mode === 'pipeline') { 拐弯走上下总线；选中节点看直接上下游 }
                @else { 拖动节点移动，滚轮缩放；拐弯走上下总线 }
              </span>
            </div>

            <div class="stage" [style.transform]="stageTransform">
              <svg class="wires" [attr.width]="stageSize.w" [attr.height]="stageSize.h">
                @for (rail of busRails(); track rail.kind) {
                  <rect
                    class="bus-tray"
                    [attr.x]="rail.x"
                    [attr.y]="rail.y - 3"
                    [attr.width]="rail.width"
                    [attr.height]="rail.count * 7 + 6"
                    rx="8"
                  ></rect>
                  <path class="bus-rail" [attr.d]="rail.d"></path>
                  <text class="bus-label" [attr.x]="rail.x + 4" [attr.y]="rail.kind === 'top' ? rail.y - 7 : rail.y + rail.count * 7 + 15">
                    {{ rail.kind === 'top' ? '上总线' : '下总线' }}
                  </text>
                }
                @for (edge of visibleEdges(); track edge.link.id) {
                  <path class="wire-hit" [attr.d]="edge.d" (pointerdown)="selectLink(edge.link, $event)">
                    <title>{{ edge.link.type || '连线' }}</title>
                  </path>
                  <path
                    class="wire"
                    [class.on]="selectedLink === edge.link.id"
                    [class.hot]="edge.hot"
                    [class.dim]="edge.dim"
                    [class.supply]="edge.supply"
                    [attr.d]="edge.d"
                    [attr.stroke]="edge.color"
                  ></path>
                }
                @if (linking && tempPath()) {
                  <path class="wire temp" [attr.d]="tempPath()" stroke="#4f46e5"></path>
                }
              </svg>

              @for (n of graph.nodes; track n.id) {
                <article
                  class="node"
                  [class.sel]="selectedId === n.id"
                  [class.faded]="focusId != null && !focusNodes.has(n.id)"
                  [style.left.px]="left(n)"
                  [style.top.px]="top(n)"
                  [style.width.px]="210"
                  (pointerdown)="onNodeDown(n, $event)"
                  (pointerenter)="hoverId = n.id"
                  (pointerleave)="hoverId = null"
                >
                  <header class="n-head">
                    <i class="n-dot" [style.background]="roleOf(n)"></i>
                    <span class="n-title" [title]="n.title">{{ n.title }}</span>
                    <span class="n-type" [title]="n.type">{{ n.type }}</span>
                  </header>
                  <div class="n-body">
                    @for (row of rows(n); track row.index) {
                      <div class="inrow">
                        <button
                          class="port in"
                          [class.linked]="row.input.link != null"
                          [attr.data-node]="n.id"
                          [attr.data-slot]="row.index"
                          (pointerdown)="onInputPortDown(n, row.input, row.index, $event)"
                          (pointerup)="onInputPortUp(n.id, row.index, $event)"
                          [title]="row.input.link != null ? '点击断开' : '把输出拖到这里'"
                        ></button>
                        <span class="iname" [title]="row.input.name">{{ row.input.name }}</span>
                        <span class="chip" [class.dim]="!row.source" [title]="row.source?.title || '未连接'">
                          {{ row.source ? row.source.title : '未连接' }}
                        </span>
                      </div>
                    }
                    @for (w of n.widgets; track $index) {
                      <div class="wrow">
                        <span class="wk" [title]="w.name">{{ w.label || w.name }}</span>
                        <span class="wv" [title]="widgetText(w)">{{ widgetText(w) }}</span>
                      </div>
                    }
                    @if (n.outputs.length) {
                      <div class="outs">
                        @for (out of n.outputs; track $index) {
                          <div class="outrow">
                            <span class="oname" [title]="out.name + ' · ' + out.type">{{ out.name }}</span>
                            <button
                              class="port out"
                              (pointerdown)="onOutputPortDown(n, $index, $event)"
                              [title]="'拖动到输入端口连接 · ' + (out.type || '任意')"
                            ></button>
                          </div>
                        }
                      </div>
                    }
                  </div>
                </article>
              }
            </div>

            @if (paletteOpen) {
              <div class="palette" (pointerdown)="$event.stopPropagation()">
                <div class="pal-head">
                  <input
                    #paletteInput
                    class="pal-search"
                    placeholder="搜索节点名 / 类型 / 分类"
                    [(ngModel)]="paletteQuery"
                    (ngModelChange)="filterPalette()"
                    (keydown.enter)="addFirst()"
                    (keydown.escape)="closePalette()"
                  />
                  <button class="pal-close" (click)="closePalette()" title="关闭">×</button>
                </div>
                @if (!objectInfo) {
                  <div class="pal-empty">正在读取节点定义…</div>
                } @else if (!paletteList.length) {
                  <div class="pal-empty">
                    {{ hasDefs ? '没有匹配的节点' : '节点库不可用（实例没开，也没有缓存）' }}
                  </div>
                } @else {
                  <div class="pal-list">
                    @for (def of paletteList; track def.type) {
                      <button class="pal-item" (click)="addNode(def)">
                        <b>{{ def.title }}</b>
                        <small>{{ def.type }}@if (def.category) { · {{ def.category }} }</small>
                      </button>
                    }
                  </div>
                }
                <div class="pal-foot">
                  {{ hasDefs ? '节点定义：' + (objectInfo?.available ? '本机实例' : '磁盘缓存') : '节点定义不可用' }}
                  <button class="link" (click)="refreshDefs()">刷新</button>
                </div>
              </div>
            }

            <div class="status">
              @if (issueErrors) {
                <span class="bad">{{ issueErrors }} 个错误</span>
              } @else if (issueWarns) {
                <span class="warn">{{ issueWarns }} 个提醒</span>
              } @else {
                <span class="ok">
                  <svg viewBox="0 0 12 12"><path d="M2 6.4 4.7 9 10 3.2" /></svg>
                  检查通过
                </span>
              }
              <span class="sep"></span>
              <span><b>{{ graph.nodes.length }}</b> 节点</span>
              <span class="sep"></span>
              <span><b>{{ graph.links.length }}</b> 连线</span>
              @if (!showSupplyLinks && hiddenSupplyCount) {
                <button class="status-link" (click)="toggleSupply()" title="展开加载器 / 图片输入等供给连线">
                  {{ hiddenSupplyCount }} 条供给线已收起
                </button>
              }
              <span class="sep"></span>
              <span>{{ defsState }}</span>
              <span class="sep"></span>
              <span class="zoom">
                <button (click)="zoomBy(-0.1)" title="缩小">−</button>
                <span>{{ zoomLabel }}</span>
                <button (click)="zoomBy(0.1)" title="放大">+</button>
                <button class="fit" (click)="fitView()" title="适应画布">适应</button>
              </span>
            </div>
          </section>
        } @else if (view !== 'canvas') {
          <section class="docview">
            <div class="code-wrap">
              <div class="tabs-note">
                @if (jsonEditable) {
                  <b>{{ format === 'broken' ? '原始 JSON' : (view === 'api' ? 'API 格式' : 'UI 格式') }}</b>
                  · 改完点「应用修改」，或直接保存
                } @else {
                  <b>API 预览</b> · 由当前画布生成，只读；保存仍按 UI 格式写回
                }
              </div>
              <textarea
                class="jsonarea"
                spellcheck="false"
                [readonly]="!jsonEditable"
                [(ngModel)]="jsonText"
                (ngModelChange)="onJsonInput()"
              ></textarea>
              @if (jsonError) { <div class="jsonerr">{{ jsonError }}</div> }
            </div>
            <aside class="side-note">
              <h3>{{ jsonEditable ? '结构检查' : '导出说明' }}</h3>
              @if (graph) {
                <div class="check" [class.bad]="issueErrors > 0">
                  <svg viewBox="0 0 12 12"><path d="M2 6.4 4.7 9 10 3.2" /></svg>
                  {{ issueErrors ? issueErrors + ' 个结构错误' : 'JSON 结构与连线检查通过' }}
                </div>
                @for (issue of issues.slice(0, 6); track $index) {
                  <div class="check" [class.warn]="issue.level === 'warn'" [class.bad]="issue.level === 'error'">
                    <svg viewBox="0 0 12 12"><path d="M6 1.8 11 10H1z" /><path d="M6 5v2.4" /></svg>
                    <span>{{ issue.message }}</span>
                  </div>
                }
              } @else {
                <p>修正 JSON 语法后点「应用修改」，编辑器会识别它是 UI 还是 API 格式。</p>
              }
              <h3>当前文件</h3>
              <p class="mono">
                {{ formatLabel }} · {{ graph?.nodes?.length || 0 }} 节点 · {{ graph?.links?.length || 0 }} 连线
                @if (file) { · {{ sizeText(file.size) }} }
              </p>
              <div class="note-actions">
                <button class="btn" [disabled]="!jsonEditable" (click)="applyJson()">应用到画布</button>
                <button class="btn" [disabled]="!jsonEditable" (click)="resetJson()">重新生成</button>
                <button class="btn" (click)="copyJson()">复制</button>
              </div>
              <h3>保存策略</h3>
              <p>覆盖原文件前会先复制一份同名 <code>.bak</code>；结构校验失败时不会落盘。</p>
            </aside>
          </section>
        }

        @if (graph && view === 'canvas') {
          <aside class="insp">
            <div class="insp-head">
              <div class="insp-tabs">
                <button [class.on]="inspectTab === 'node'" (click)="setInspTab('node')">节点</button>
                <button [class.on]="inspectTab === 'deps'" (click)="setInspTab('deps')">依赖</button>
                <button [class.on]="inspectTab === 'checks'" (click)="setInspTab('checks')">
                  检查 <b>{{ issues.length }}</b>
                </button>
              </div>
              @if (selNode) {
                <div class="insp-title">
                  <i class="n-dot" [style.background]="roleOf(selNode)"></i>
                  <b>{{ selNode.title }}</b>
                  <span>#{{ selNode.id }}</span>
                </div>
                <p class="insp-sub">{{ selNode.type }}</p>
              } @else {
                <div class="insp-title"><b>没有选中节点</b></div>
                <p class="insp-sub">点一张卡片开始编辑</p>
              }
            </div>

            <div class="insp-body">
              @if (inspectTab === 'node') {
                @if (selNode; as node) {
                  <div class="grp">
                    <p class="grp-h">名称</p>
                    <input class="rename" [value]="node.title" (change)="renameNode(node, $event)" />
                    <p class="mono muted">{{ node.type }} · #{{ node.id }}</p>
                  </div>

                  @if (node.widgets.length) {
                    <div class="grp">
                      <p class="grp-h">参数</p>
                      @for (w of node.widgets; track $index) {
                        <label class="wf-field">
                          <span class="flabel" [title]="w.name">{{ w.label || w.name }}</span>
                          @switch (w.kind) {
                            @case ('number') {
                              <input
                                class="fnum"
                                type="number"
                                [value]="w.value"
                                [attr.min]="w.min ?? null"
                                [attr.max]="w.max ?? null"
                                [attr.step]="w.step ?? 1"
                                (change)="setWidget(node, w, $event)"
                              />
                            }
                            @case ('combo') {
                              <select class="fselect" [value]="str(w.value)" (change)="setWidget(node, w, $event)">
                                @for (o of w.options ?? []; track o) {
                                  <option [value]="o">{{ o }}</option>
                                }
                              </select>
                            }
                            @case ('toggle') {
                              <input class="fcheck" type="checkbox" [checked]="!!w.value" (change)="setWidget(node, w, $event)" />
                            }
                            @case ('raw') {
                              <textarea class="ftext mono" rows="2" [value]="rawText(w)" (change)="setWidget(node, w, $event)"></textarea>
                            }
                            @default {
                              <textarea class="ftext" rows="3" [value]="str(w.value)" (change)="setWidget(node, w, $event)"></textarea>
                            }
                          }
                        </label>
                      }
                    </div>
                  } @else {
                    <p class="empty">这个节点没有可调参数。</p>
                  }

                  <div class="grp">
                    <p class="grp-h">连线</p>
                    @for (input of node.inputs; track $index) {
                      <div class="conn">
                        <i [style.border-color]="roleOf(node)"></i>
                        <span [title]="input.name">{{ input.name }}</span>
                        <em [class.warn]="input.link == null && !input.widget">
                          {{ input.widget ? '控件' : sourceName(input) }}
                        </em>
                        @if (input.link != null) {
                          <button class="conn-x" (click)="breakInput(input)" title="断开">断开</button>
                        }
                      </div>
                    }
                    @if (!node.inputs.length) { <p class="empty">没有输入端口。</p> }
                  </div>
                } @else {
                  <div class="ui-empty small">
                    <p>选择节点后在这里改参数。</p>
                    <p class="muted">拖动输出端口到另一个节点的输入端口即可连线；点击已连接的输入端口断开。</p>
                  </div>
                }
              } @else if (inspectTab === 'deps') {
                @if (depItem) {
                  <div class="grp">
                    <p class="grp-h">模型 · {{ depItem.deps?.have?.length || 0 }} 已有 / {{ depItem.deps?.missing?.length || 0 }} 缺失</p>
                    @for (m of depItem.deps?.have ?? []; track m.file) {
                      <div class="dep"><span class="ok-dot"></span><span [title]="m.file">{{ m.file }}</span><em>{{ m.directory }}</em></div>
                    }
                    @for (m of depItem.deps?.missing ?? []; track m.file) {
                      <div class="dep miss"><span class="miss-dot"></span><span [title]="m.file">{{ m.file }}</span><em>{{ m.directory }}</em></div>
                    }
                  </div>
                  <div class="grp">
                    <p class="grp-h">节点包 · {{ depItem.node_deps?.have?.length || 0 }} 已有 / {{ depItem.node_deps?.missing?.length || 0 }} 缺失</p>
                    @for (p of depItem.node_deps?.have ?? []; track p.id) {
                      <div class="dep"><span class="ok-dot"></span><span [title]="p.name">{{ p.name }}</span><em>{{ p.node_count }} 节点</em></div>
                    }
                    @for (p of depItem.node_deps?.missing ?? []; track p.id) {
                      <div class="dep miss"><span class="miss-dot"></span><span [title]="p.name">{{ p.name }}</span><em>{{ p.node_count }} 节点</em></div>
                    }
                    @for (u of depItem.node_deps?.unknown ?? []; track u) {
                      <div class="dep"><span class="unknown-dot"></span><span [title]="u">{{ u }}</span><em>未收录</em></div>
                    }
                  </div>
                  <p class="empty">依赖按磁盘上的文件计算；改完参数后回列表可刷新。</p>
                } @else {
                  <p class="empty">没有取到依赖信息。</p>
                }
              } @else {
                @if (!issues.length) {
                  <div class="check-pass">
                    <svg viewBox="0 0 12 12"><path d="M2 6.4 4.7 9 10 3.2" /></svg>
                    结构、连线与必填输入检查通过。
                  </div>
                } @else {
                  @for (issue of issues; track $index) {
                    <button class="issue" [class.err]="issue.level === 'error'" (click)="focusNode(issue.nodeId)">
                      <b>{{ issue.level === 'error' ? '错误' : '提醒' }}</b>
                      <span>{{ issue.message }}</span>
                    </button>
                  }
                }
                <p class="empty">检查只针对结构与端口；模型文件是否齐全看「依赖」。</p>
              }
            </div>

            @if (selNode) {
              <div class="insp-foot">
                <button class="btn" (click)="centerSelected()">在画布居中</button>
                <button class="btn danger" (click)="deleteSelected()">删除节点</button>
              </div>
            }
          </aside>
        }
      </div>

      @if (notice) {
        <div class="toast" [class.err]="noticeErr">
          <span>{{ notice }}</span>
          <button (click)="notice = ''" title="关闭">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .ed {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: flex;
      flex-direction: column;
      background: var(--bg);
      color: var(--text);
    }

    /* ---------------- 顶栏 ---------------- */
    .top {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 54px;
      flex: none;
      padding: 0 14px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }
    .back {
      width: 30px; height: 30px; flex: none; display: grid; place-items: center;
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--panel); color: var(--muted); cursor: pointer; padding: 0;
    }
    .back:hover { color: var(--text); border-color: var(--border-strong); }
    .back svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .doc { display: flex; flex-direction: column; gap: 1px; min-width: 0; max-width: 340px; }
    .doc b { font-size: 13.5px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .doc small { font: 10.5px/1.3 'Cascadia Mono', Consolas, monospace; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fmt-badge {
      flex: none; height: 19px; display: inline-flex; align-items: center; padding: 0 6px;
      border-radius: 4px; background: var(--panel-3); color: var(--muted);
      font: 600 9.5px/1 'Cascadia Mono', Consolas, monospace; letter-spacing: 0.05em;
    }
    .fmt-badge.bad { background: var(--err-soft, #fee2e2); color: var(--err); }
    .tabs { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 9px; background: var(--panel-3); }
    .tab {
      height: 28px; padding: 0 13px; border: 0; border-radius: 7px; background: none;
      color: var(--muted); font-size: 12.5px; font-weight: 550; cursor: pointer;
    }
    .tab:hover:not(:disabled) { color: var(--text); }
    .tab.on { background: var(--panel); color: var(--text); box-shadow: var(--shadow-sm); }
    .tab:disabled { opacity: 0.4; cursor: default; }
    .spacer { flex: 1; }
    .dirty { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); flex: none; }
    .json-dirty {
      flex: none; padding: 2px 5px; border-radius: 4px; background: var(--accent-soft);
      color: var(--accent); font: 600 9px/1.2 'Cascadia Mono', Consolas, monospace;
    }
    .tb-ghost {
      width: 30px; height: 30px; display: grid; place-items: center; border: 0;
      border-radius: var(--radius-sm); background: none; color: var(--muted); cursor: pointer; padding: 0;
    }
    .tb-ghost:hover:not(:disabled) { background: var(--hover); color: var(--text); }
    .tb-ghost:disabled { opacity: 0.35; cursor: default; }
    .tb-ghost svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .btn {
      height: 30px; padding: 0 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--panel); color: var(--text-2); font-size: 12px; font-weight: 550;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
    }
    .btn:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    /* 实心填充态用 --primary / --on-primary，不用 --accent：
       --accent 是**文字 / 描边 / 图标态**，深色下提亮成 #a5b4fc，
       白字压上去只有 1.99:1；--primary 两主题同为 #4f46e5，白字 6.29:1（VIS §3.3）。
       hover 同全局 button.primary：**不改用 --primary-hover**（深色 #6366f1 上白字
       4.47:1，差 0.03 不达 AA），可点性靠描边 + cursor + :focus-visible 承担。 */
    .btn.primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
    .btn.primary:hover:not(:disabled) { background: var(--primary); border-color: var(--accent); color: var(--on-primary); }
    .btn.danger:hover { color: var(--err); border-color: var(--err); }

    /* ---------------- 提示条 ---------------- */
    .banner {
      flex: none; display: flex; align-items: center; gap: 10px;
      padding: 7px 16px; font-size: 11.5px; line-height: 1.5;
      background: var(--warn-soft); color: var(--warn);
      border-bottom: 1px solid var(--border-soft);
    }
    .banner.err { background: var(--err-soft, #fef2f2); color: var(--err); }
    .banner span { flex: 1; min-width: 0; }
    .banner-act { border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; font-weight: 650; font-size: 11.5px; }

    /* ---------------- 主体三栏 ---------------- */
    .main { flex: 1; min-height: 0; display: flex; }

    .rail {
      width: 50px; flex: none; background: var(--panel); border-right: 1px solid var(--border);
      display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0;
    }
    .rbtn {
      width: 34px; height: 34px; display: grid; place-items: center; border: 0;
      border-radius: 9px; background: none; color: var(--muted); cursor: pointer; position: relative; padding: 0;
    }
    .rbtn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
    .rbtn:disabled { opacity: 0.35; cursor: default; }
    .rbtn.on { background: var(--accent-soft); color: var(--accent); }
    .rbtn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.55; stroke-linecap: round; stroke-linejoin: round; }
    .rbtn .dot { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 2px var(--panel); }
    .rail-sep { width: 24px; height: 1px; background: var(--border-soft); margin: 4px 0; }

    .ui-empty { flex: 1; display: grid; place-items: center; color: var(--muted); font-size: 12px; padding: 40px; }

    /* ---------------- 画布 ---------------- */
    .canvas {
      flex: 1; min-width: 0; position: relative; overflow: hidden; touch-action: none;
      background:
        radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--faint) 34%, transparent) 1px, transparent 0) 0 0 / 18px 18px,
        var(--bg);
    }
    .canvas-tools { position: absolute; left: 14px; top: 14px; z-index: 5; display: flex; align-items: center; gap: 10px; }
    .seg { display: flex; padding: 2px; border-radius: var(--radius-sm); background: color-mix(in oklab, var(--panel) 88%, transparent); border: 1px solid var(--border); backdrop-filter: blur(8px); }
    .seg button { height: 24px; padding: 0 9px; border: 0; border-radius: 5px; background: none; color: var(--muted); font-size: 11.5px; font-weight: 550; cursor: pointer; }
    .seg button.on { background: var(--panel); color: var(--text); box-shadow: var(--shadow-sm); }
    .seg button:disabled { opacity: 0.4; cursor: default; }
    .hint { font-size: 11px; color: var(--faint); }

    .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    .wires { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
    .wire { fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; opacity: 0.62; transition: opacity 0.14s, stroke-width 0.14s; }
    .wire.on { opacity: 1; stroke-width: 2.4; }
    .wire.supply { stroke-dasharray: 4 4; opacity: 0.45; }
    .wire.hot { opacity: 0.95; stroke-width: 2.2; stroke-dasharray: none; }
    .wire.dim { opacity: 0.06; }
    .wire.temp { opacity: 0.9; stroke-dasharray: 4 4; stroke-width: 1.8; }
    .wire-hit { fill: none; stroke: transparent; stroke-width: 12; pointer-events: stroke; cursor: pointer; }
    .bus-tray { fill: color-mix(in oklab, var(--panel-2) 82%, transparent); stroke: var(--border-soft); stroke-width: 1; pointer-events: none; }
    .bus-rail { fill: none; stroke: var(--border-strong); stroke-width: 1.5; stroke-linecap: round; opacity: 0.8; pointer-events: none; }
    .bus-label { font: 9.5px/1 'Cascadia Mono', Consolas, monospace; letter-spacing: 0.08em; fill: var(--muted); pointer-events: none; }

    .node {
      position: absolute; border-radius: 10px; background: var(--panel);
      border: 1px solid var(--border); box-shadow: var(--shadow-sm);
      cursor: default; user-select: none; transition: box-shadow 0.15s, border-color 0.15s, opacity 0.15s;
    }
    .node:hover { border-color: var(--border-strong); box-shadow: 0 10px 26px -18px rgb(0 0 0 / 0.4); }
    .node.sel { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), 0 14px 30px -20px rgb(0 0 0 / 0.35); }
    .node.faded { opacity: 0.42; }
    .node.faded:hover { opacity: 1; }
    .n-head { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px 0 11px; border-bottom: 1px solid var(--border-soft); }
    .n-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
    .n-title { flex: 1; min-width: 0; font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .n-type { max-width: 82px; font: 8.5px/1 'Cascadia Mono', Consolas, monospace; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .n-body { padding: 8px 10px 8px 14px; }
    .inrow { height: 22px; display: flex; align-items: center; gap: 6px; position: relative; min-width: 0; }
    .iname { flex: none; max-width: 76px; font-size: 9.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip {
      flex: 1; min-width: 0; height: 17px; display: inline-flex; align-items: center; padding: 0 5px;
      border-radius: 4px; background: var(--panel-3); color: var(--text-2); font-size: 9.5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .chip.dim { color: var(--faint); background: transparent; box-shadow: inset 0 0 0 1px var(--border-soft); }
    .wrow { height: 27px; display: flex; align-items: center; gap: 8px; min-width: 0; }
    .wk { flex: none; width: 82px; font-size: 9.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wv { flex: 1; min-width: 0; font: 10px/1.3 'Cascadia Mono', Consolas, monospace; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .outs { margin-top: 8px; }
    .outrow { height: 20px; display: flex; align-items: center; justify-content: flex-end; position: relative; }
    .oname { font: 9.5px/1 'Cascadia Mono', Consolas, monospace; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .port {
      position: absolute; width: 8px; height: 8px; padding: 0; border-radius: 50%;
      border: 1.5px solid var(--border-strong); background: var(--panel); cursor: crosshair; z-index: 3;
      transition: border-color 0.12s, transform 0.12s, background 0.12s;
    }
    .port::before { content: ''; position: absolute; inset: -7px; border-radius: 50%; }
    .port:hover { border-color: var(--accent); transform: scale(1.35); }
    .port.in { left: -18px; top: 7px; }
    .port.in.linked { border-color: var(--accent); background: var(--accent); }
    .port.out { right: -14px; top: 6px; border-color: var(--accent); }
    .port.out:hover { background: var(--accent); }

    /* ---------------- 节点库 ---------------- */
    .palette {
      position: absolute; left: 60px; top: 58px; z-index: 8; width: 330px; max-height: calc(100% - 110px);
      display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow-md); overflow: hidden;
    }
    .pal-head { display: flex; align-items: center; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border-soft); }
    .pal-search { flex: 1; min-width: 0; height: 30px; padding: 0 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-2); color: var(--text); font: inherit; font-size: 12px; }
    .pal-search:focus { outline: none; border-color: var(--accent-line); }
    .pal-close { width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: var(--muted); font-size: 17px; line-height: 1; cursor: pointer; }
    .pal-close:hover { background: var(--panel-3); color: var(--text); }
    .pal-list { flex: 1; min-height: 0; overflow-y: auto; padding: 5px; }
    .pal-item { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: none; text-align: left; cursor: pointer; }
    .pal-item:hover { background: var(--panel-3); }
    .pal-item b { display: block; font-size: 12px; font-weight: 600; color: var(--text); }
    .pal-item small { display: block; margin-top: 1px; font: 9.5px/1.4 'Cascadia Mono', Consolas, monospace; color: var(--faint); }
    .pal-empty { padding: 18px 12px; font-size: 11.5px; color: var(--muted); text-align: center; }
    .pal-foot { flex: none; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-top: 1px solid var(--border-soft); font-size: 10px; color: var(--faint); }
    .pal-foot .link { margin-left: auto; border: 0; background: none; color: var(--accent); font-size: 10px; cursor: pointer; padding: 0; }

    /* ---------------- 状态条 ---------------- */
    .status {
      position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 5;
      display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 6px 0 12px;
      border-radius: 999px; background: color-mix(in oklab, var(--panel) 88%, transparent);
      border: 1px solid var(--border); backdrop-filter: blur(10px); box-shadow: var(--shadow-sm);
      font-size: 11px; color: var(--muted); white-space: nowrap;
    }
    .status b { font-weight: 600; color: var(--text-2); }
    .status .sep { width: 1px; height: 13px; background: var(--border); }
    .status .ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ok); font-weight: 550; }
    .status .ok svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .status .bad { color: var(--err); font-weight: 600; }
    .status .warn { color: var(--warn); font-weight: 600; }
    .status-link { border: 0; background: none; color: var(--accent); font-size: 11px; cursor: pointer; padding: 0; }
    .status-link:hover { text-decoration: underline; }
    .zoom { display: flex; align-items: center; gap: 2px; }
    .zoom button { width: 22px; height: 22px; border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; display: grid; place-items: center; padding: 0; }
    .zoom button:hover { background: var(--panel-3); color: var(--text); }
    .zoom span { min-width: 34px; text-align: center; font: 10.5px/1 'Cascadia Mono', Consolas, monospace; color: var(--text-2); }
    .zoom .fit { width: auto; padding: 0 6px; font-size: 10px; }

    /* ---------------- 检查器 ---------------- */
    .insp { width: 300px; flex: none; background: var(--panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
    .insp-head { padding: 12px 14px 10px; border-bottom: 1px solid var(--border-soft); }
    .insp-tabs { display: flex; gap: 2px; margin: 0 0 9px; padding: 2px; border-radius: 7px; background: var(--panel-3); }
    .insp-tabs button { flex: 1; height: 24px; border: 0; border-radius: 5px; background: none; color: var(--muted); font-size: 11px; font-weight: 550; cursor: pointer; }
    .insp-tabs button.on { background: var(--panel); color: var(--text); box-shadow: var(--shadow-sm); }
    .insp-tabs b { font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
    .insp-title { display: flex; align-items: center; gap: 7px; }
    .insp-title b { font-size: 13px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .insp-title span { margin-left: auto; font: 9px/1 'Cascadia Mono', Consolas, monospace; color: var(--faint); flex: none; }
    .insp-sub { margin: 3px 0 0 13px; font: 10px/1.4 'Cascadia Mono', Consolas, monospace; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .insp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 18px; }
    .grp { margin-bottom: 15px; }
    .grp-h { font-size: 9.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase; color: var(--faint); margin: 0 0 7px; }
    .rename { width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); color: var(--text); font: inherit; font-size: 12px; }
    .rename:focus { outline: none; border-color: var(--accent-line); }
    .muted { color: var(--faint); }
    .mono { font-family: 'Cascadia Mono', Consolas, monospace; font-size: 10px; }
    /* 原本还继承全局 .field { min-width: 0 }：全局类改名为 .ui-field 后，这里显式补回，
       视觉保持不变。 */
    .wf-field { display: flex; align-items: center; gap: 8px; min-height: 28px; margin-bottom: 5px; min-width: 0; }
    .flabel { flex: 1; min-width: 0; font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fnum { width: 82px; flex: none; height: 26px; padding: 0 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); color: var(--text); font: 10.5px/1 'Cascadia Mono', Consolas, monospace; text-align: right; }
    .fselect { max-width: 150px; flex: none; height: 26px; padding: 0 5px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); color: var(--text-2); font: 10.5px/1 'Cascadia Mono', Consolas, monospace; }
    .fcheck { width: 15px; height: 15px; flex: none; accent-color: var(--accent); }
    .ftext { width: 100%; min-height: 54px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); color: var(--text-2); font: 10.5px/1.5 'Cascadia Mono', Consolas, monospace; resize: vertical; }
    .conn { border: 1px solid var(--border-soft); border-radius: 7px; padding: 6px 8px; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--text-2); }
    .conn i { width: 6px; height: 6px; border-radius: 50%; border: 1.4px solid var(--border-strong); flex: none; }
    .conn span { flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .conn em { margin-left: auto; font: 9px/1 'Cascadia Mono', Consolas, monospace; color: var(--faint); font-style: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
    .conn em.warn { color: var(--warn); }
    .conn-x { flex: none; border: 0; background: none; color: var(--accent); font-size: 9.5px; cursor: pointer; padding: 0; text-decoration: underline; }
    .dep { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 10.5px; color: var(--text-2); min-width: 0; }
    .dep span:nth-child(2) { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dep em { flex: none; font: 9px/1 'Cascadia Mono', Consolas, monospace; color: var(--faint); font-style: normal; }
    .dep.miss { color: var(--warn); }
    .ok-dot, .miss-dot, .unknown-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--ok); }
    .miss-dot { background: var(--warn); }
    .unknown-dot { background: var(--faint); }
    .issue { display: block; width: 100%; padding: 7px 8px; margin-bottom: 5px; border: 1px solid var(--border-soft); border-radius: 7px; background: var(--panel-2); text-align: left; cursor: pointer; }
    .issue b { display: block; font-size: 9.5px; color: var(--warn); margin-bottom: 2px; }
    .issue.err b { color: var(--err); }
    .issue span { font-size: 10.5px; line-height: 1.5; color: var(--text-2); word-break: break-word; }
    .check-pass { display: flex; align-items: flex-start; gap: 7px; padding: 8px 9px; border-radius: 7px; background: var(--ok-soft); color: var(--ok); font-size: 11px; line-height: 1.55; }
    .check-pass svg { width: 12px; height: 12px; flex: none; margin-top: 1px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .insp-foot { padding: 10px 14px; border-top: 1px solid var(--border-soft); display: flex; gap: 7px; }
    .insp-foot .btn { flex: 1; }
    .empty { margin: 2px 0 0; padding: 4px 0; font-size: 11px; line-height: 1.6; color: var(--faint); }
    .ui-empty.small { padding: 20px 0; text-align: left; display: block; }
    .ui-empty.small p { margin: 0 0 8px; font-size: 11.5px; line-height: 1.6; }

    /* ---------------- JSON 视图 ---------------- */
    .docview { flex: 1; min-width: 0; display: flex; background: var(--panel-2); }
    .code-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .tabs-note { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--border-soft); background: var(--panel); font-size: 11px; color: var(--muted); }
    .tabs-note b { color: var(--text-2); font-weight: 600; }
    .jsonarea { flex: 1; min-height: 0; width: 100%; padding: 14px 16px 60px; border: 0; outline: none; resize: none; background: var(--panel); color: var(--text-2); font: 11.5px/19px 'Cascadia Mono', Consolas, 'JetBrains Mono', monospace; tab-size: 2; white-space: pre; overflow: auto; }
    .jsonarea[readonly] { background: var(--panel-2); }
    .jsonerr { flex: none; padding: 8px 16px; border-top: 1px solid var(--border-soft); background: var(--err-soft, #fef2f2); color: var(--err); font-size: 11.5px; white-space: pre-wrap; }
    .side-note { width: 300px; flex: none; border-left: 1px solid var(--border); background: var(--panel); padding: 14px; overflow-y: auto; }
    .side-note h3 { margin: 14px 0 5px; font-size: 11px; font-weight: 650; letter-spacing: 0.04em; }
    .side-note h3:first-child { margin-top: 0; }
    .side-note p { margin: 0 0 8px; font-size: 11px; line-height: 1.6; color: var(--muted); }
    .side-note code { font: 10px/1.4 'Cascadia Mono', Consolas, monospace; color: var(--text-2); }
    .check { display: flex; align-items: flex-start; gap: 7px; padding: 4px 0; font-size: 10.5px; line-height: 1.5; color: var(--muted); }
    .check svg { width: 12px; height: 12px; flex: none; margin-top: 1px; fill: none; stroke: var(--ok); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .check.warn { color: var(--warn); }
    .check.warn svg { stroke: var(--warn); }
    .check.bad { color: var(--err); }
    .check.bad svg { stroke: var(--err); }
    .note-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; }
    .note-actions .btn { height: 28px; font-size: 11px; }

    /* ---------------- 提示 ---------------- */
    .toast {
      position: fixed; right: 22px; bottom: 22px; z-index: 80; display: flex; align-items: center; gap: 10px;
      max-width: min(420px, calc(100vw - 44px)); padding: 10px 10px 10px 14px; border-radius: var(--radius);
      background: var(--panel); color: var(--text); font-size: 12px; box-shadow: 0 18px 48px -24px rgb(0 0 0 / 0.55);
      border: 1px solid var(--border);
    }
    .toast.err { color: var(--err); border-color: var(--err); }
    .toast span { flex: 1; min-width: 0; line-height: 1.5; }
    .toast button { flex: none; width: 22px; height: 22px; border: 0; border-radius: 5px; background: none; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
    .toast button:hover { background: var(--panel-3); }

    @media (max-width: 1180px) {
      .insp { width: 272px; }
      .hint { display: none; }
    }
    @media (max-width: 980px) {
      .insp { display: none; }
    }
  `],
})
export class WorkflowEditorComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLElement>;
  @ViewChild('paletteInput') paletteInput?: ElementRef<HTMLInputElement>;

  path = '';
  file: WorkflowFile | null = null;
  graph: WorkflowGraph | null = null;
  format: 'ui' | 'api' | 'broken' = 'ui';
  view: View = 'canvas';
  mode: Mode = 'pipeline';
  inspectTab: InspTab = 'node';

  defs: DefMap = {};
  objectInfo: { available: boolean; source: string; nodes: Record<string, unknown>; error?: string } | null = null;

  selectedId: number | null = null;
  selectedLink: number | null = null;
  hoverId: number | null = null;
  /** 加载器、图片输入这类「供料」连线默认收起，选中相关节点时自动出现 */
  showSupplyLinks = false;
  /** 所有需要拐弯的线都走顶部/底部总线；关闭后退回列间圆角折线 */
  busRouting = true;
  issues: GraphIssue[] = [];

  positions: Record<number, [number, number]> = {};
  pan = { x: 24, y: 20 };
  scale = 1;

  loading = true;
  saving = false;
  dirty = false;
  errorText = '';
  notice = '';
  noticeErr = false;

  jsonText = '';
  jsonError = '';
  jsonDirty = false;

  paletteOpen = false;
  paletteQuery = '';
  paletteList: NodeDef[] = [];

  depItem: LocalWorkflow | null = null;

  private graphVersion = 0;
  private focusCache: { key: string; set: Set<number> } | null = null;
  private history: string[] = [];
  private histIndex = -1;
  private savedSnapshot = '';
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  private panning: { sx: number; sy: number; px: number; py: number } | null = null;
  private dragging: { id: number; sx: number; sy: number; px: number; py: number } | null = null;
  linking: { from: number; slot: number } | null = null;
  private linkPoint: [number, number] = [0, 0];

  ngOnInit(): void {
    this.path = this.route.snapshot.queryParamMap.get('path') || '';
    this.loadObjectInfo();
    if (!this.path) {
      this.loading = false;
      this.errorText = '地址里缺少工作流路径。请从工作流列表点「用编辑器打开」。';
      return;
    }
    this.loadFile();
  }

  ngOnDestroy(): void {
    if (this.historyTimer) clearTimeout(this.historyTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
  }

  /* ------------------------------------------------------------ 读取 */

  loadFile(): void {
    if (this.dirty && !window.confirm('放弃未保存的修改并重新载入？')) return;
    this.loading = true;
    this.errorText = '';
    this.jsonError = '';
    this.api.readWorkflowFile(this.path).subscribe({
      next: (file) => {
        this.file = file;
        this.format = file.format;
        this.graph = null;
        if (file.data) {
          try {
            this.graph = parseWorkflow(file.data, file.format, this.defs);
            this.format = this.graph.format === 'api' ? 'api' : 'ui';
          } catch (err) {
            this.format = 'broken';
            this.errorText = err instanceof Error ? err.message : '无法解析工作流';
          }
        }
        this.loading = false;
        this.selectedId = null;
        this.selectedLink = null;
        this.view = this.graph ? 'canvas' : 'ui';
        this.mode = 'pipeline';
        this.inspectTab = 'node';
        this.afterGraphLoad();
        this.loadDeps();
        setTimeout(() => this.fitView(), 0);
      },
      error: (err) => {
        this.loading = false;
        this.errorText = errMsg(err, '读取工作流失败');
      },
    });
  }

  private loadObjectInfo(refresh = false): void {
    this.api.workflowObjectInfo(refresh).subscribe({
      next: (info) => {
        this.objectInfo = info;
        this.defs = defsFromObjectInfo(info.nodes);
        if (this.graph) {
          applyDefs(this.graph, this.defs);
          this.recalcIssues();
          this.refreshPositions();
          if (this.view !== 'canvas' && !this.jsonDirty) this.syncJsonText();
        }
        this.filterPalette();
      },
      error: () => {
        this.objectInfo = { available: false, source: '', nodes: {} };
      },
    });
  }

  private loadDeps(): void {
    this.api.localWorkflows().subscribe({
      next: (res) => {
        const key = this.samePathKey(this.path);
        this.depItem = res.items.find((item) => this.samePathKey(item.path) === key) ?? null;
      },
      error: () => (this.depItem = null),
    });
  }

  private samePathKey(value: string): string {
    return value.replace(/\\/g, '/').toLowerCase();
  }

  private afterGraphLoad(): void {
    this.refreshPositions();
    this.recalcIssues();
    this.jsonDirty = false;
    this.syncJsonText();
    this.savedSnapshot = this.snapshot();
    this.history = [this.savedSnapshot];
    this.histIndex = 0;
    this.dirty = false;
  }

  private refreshPositions(): void {
    this.graphVersion += 1;
    this.positions = this.graph ? autoLayout(this.graph) : {};
  }

  private recalcIssues(): void {
    this.issues = this.graph ? validateGraph(this.graph, this.defs) : [];
    if (this.selectedId != null && !this.graph?.nodes.some((n) => n.id === this.selectedId)) {
      this.selectedId = null;
    }
  }

  /* ------------------------------------------------------------ 视图切换 */

  setView(view: View): void {
    if (view === 'canvas' && !this.graph) return;
    if (view === 'ui' && this.format === 'api') return;
    this.view = view;
    if (view !== 'canvas' && !this.jsonDirty) this.syncJsonText();
  }

  setMode(mode: Mode): void {
    if (mode === 'free' && this.format === 'api') return;
    this.mode = mode;
  }

  setInspTab(tab: InspTab): void {
    this.inspectTab = tab;
  }

  get formatLabel(): string {
    return this.format === 'api' ? 'API' : this.format === 'broken' ? '语法错误' : 'UI';
  }

  get zoomLabel(): string {
    return `${Math.round(this.scale * 100)}%`;
  }

  /** 当前真正被收起的供给线数量（选中节点时它的直连会临时出现，不算收起） */
  get hiddenSupplyCount(): number {
    if (!this.graph || this.showSupplyLinks) return 0;
    const selected = this.selectedId;
    return this.edges().filter((edge) => {
      if (!edge.supply) return false;
      return !(selected != null && (edge.link.from === selected || edge.link.to === selected));
    }).length;
  }

  get defsState(): string {
    if (!this.objectInfo) return '节点库读取中';
    if (this.objectInfo.available) return '节点库可用';
    return this.objectInfo.nodes && Object.keys(this.objectInfo.nodes).length ? '节点库（缓存）' : '节点库不可用';
  }

  get canSave(): boolean {
    return !this.saving && !!this.file && (!!this.graph || this.format === 'broken');
  }

  get hasDefs(): boolean {
    return !!this.objectInfo && Object.keys(this.objectInfo.nodes || {}).length > 0;
  }

  get jsonEditable(): boolean {
    if (this.format === 'broken') return true;
    if (this.view === 'ui') return this.format === 'ui';
    if (this.view === 'api') return this.format === 'api';
    return false;
  }

  get canUndo(): boolean {
    return this.histIndex > 0;
  }

  get canRedo(): boolean {
    return this.histIndex >= 0 && this.histIndex < this.history.length - 1;
  }

  get issueErrors(): number {
    return this.issues.filter((i) => i.level === 'error').length;
  }

  get issueWarns(): number {
    return this.issues.filter((i) => i.level === 'warn').length;
  }

  get stageTransform(): string {
    return `translate3d(${this.pan.x}px, ${this.pan.y}px, 0) scale(${this.scale})`;
  }

  get stageSize(): { w: number; h: number } {
    let w = 1400;
    let h = 900;
    for (const node of this.graph?.nodes ?? []) {
      w = Math.max(w, this.left(node) + CARD_WIDTH + 240);
      h = Math.max(h, this.top(node) + cardHeight(node) + 220);
    }
    return { w, h };
  }

  /* ------------------------------------------------------------ 位置 */

  left(node: GraphNode): number {
    return this.mode === 'pipeline' ? (this.positions[node.id]?.[0] ?? node.pos[0]) : node.pos[0];
  }

  top(node: GraphNode): number {
    return this.mode === 'pipeline' ? (this.positions[node.id]?.[1] ?? node.pos[1]) : node.pos[1];
  }

  get selNode(): GraphNode | null {
    return this.graph ? nodeById(this.graph, this.selectedId) : null;
  }

  roleOf(node: GraphNode): string {
    const type = node.type.toLowerCase();
    if (type.includes('checkpoint') || type.includes('unet') || type.includes('loader') || type.includes('merge')) {
      if (type.includes('clip') || type.includes('text')) return ROLES['clip'];
      if (type.includes('vae')) return ROLES['image'];
      return ROLES['model'];
    }
    if (type.includes('clip') || type.includes('text') || type.includes('conditioning') || type.includes('prompt')) return ROLES['cond'];
    if (type.includes('sampler') || type.includes('guider') || type.includes('scheduler') || type.includes('noise') || type.includes('latent')) return ROLES['latent'];
    if (type.includes('decode') || type.includes('save') || type.includes('preview') || type.includes('image')) return ROLES['image'];
    return ROLES['util'];
  }

  rows(node: GraphNode): Array<{ input: GraphInput; index: number; source: GraphNode | null }> {
    if (!this.graph) return [];
    return visibleInputs(node).map(({ input, index }) => ({
      input,
      index,
      source: inputSource(this.graph as WorkflowGraph, input)?.node ?? null,
    }));
  }

  sourceName(input: GraphInput): string {
    if (!this.graph) return '未连接';
    const src = inputSource(this.graph, input);
    return src ? src.node.title : '未连接';
  }

  inputIndex(node: GraphNode, slot: number): number {
    const visible = visibleInputs(node);
    const found = visible.findIndex((row) => row.index === slot);
    return found >= 0 ? found : visible.length;
  }

  inputY(node: GraphNode, slot: number): number {
    return this.top(node) + 30 + 8 + this.inputIndex(node, slot) * 22 + 11;
  }

  outputY(node: GraphNode, slot: number): number {
    const inputs = visibleInputs(node).length;
    const widgets = node.widgets.length;
    return this.top(node) + 30 + 8 + inputs * 22 + widgets * 27 + 8 + slot * 20 + 10;
  }

  edges(): EdgeView[] {
    const graph = this.graph;
    const bounds = this.nodeBounds();
    if (!graph || !bounds) return [];
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const items = graph.links
      .map((link) => {
        const from = nodeById(graph, link.from);
        const to = nodeById(graph, link.to);
        if (!from || !to) return null;
        const sx = this.left(from) + CARD_WIDTH;
        const sy = this.outputY(from, link.fromSlot);
        const ex = this.left(to);
        const ey = this.inputY(to, link.toSlot);
        return { link, from, to, sx, sy, ex, ey, span: Math.abs(ex - sx) };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const useBus = (item: { sy: number; ey: number; span: number }): boolean =>
      this.busRouting ? Math.abs(item.ey - item.sy) >= 2 : item.span > BUS_SPAN;
    // 供给线只在「选中」时揭示，不跟悬停走：避免鼠标划过节点时整条总线跳车道。
    const selected = this.selectedId;
    const isVisible = (item: { link: GraphLink; from: GraphNode; to: GraphNode }): boolean => {
      const portType = (item.link.type || item.to.inputs[item.link.toSlot]?.type || '').toUpperCase();
      const supply = isSupplyNode(item.from) || SUPPLY_LINK_TYPES.has(portType);
      if (!supply || this.showSupplyLinks) return true;
      return selected != null && (item.link.from === selected || item.link.to === selected);
    };
    const topItems = items.filter((item) => isVisible(item) && useBus(item) && (item.sy + item.ey) / 2 < centerY);
    const topBase = Math.max(10, bounds.minY - BUS_OFFSET - topItems.length * BUS_GAP);
    const bottomBase = bounds.maxY + BUS_OFFSET;
    let topLane = 0;
    let bottomLane = 0;
    const out: EdgeView[] = [];

    for (const item of items) {
      const { link, from, to, sx, sy, ex, ey } = item;
      const portType = (link.type || to.inputs[link.toSlot]?.type || '').toUpperCase();
      const supply = isSupplyNode(from) || SUPPLY_LINK_TYPES.has(portType);
      if (!isVisible(item)) {
        out.push({ link, d: '', color: this.roleOf(from), supply, hot: false, dim: false });
        continue;
      }
      let points: Array<[number, number]>;
      if (!useBus(item)) {
        // 相邻列：在列间空隙里走一个圆角 Z，不碰卡片
        const jitter = ((link.id % 5) - 2) * 3;
        const midX = (sx + ex) / 2 + (Math.abs(ey - sy) < 2 ? 0 : jitter);
        points = [[sx, sy], [midX, sy], [midX, ey], [ex, ey]];
      } else {
        // 跨列：从输出口落到顶部/底部总线，沿总线走，再升到输入口
        const useTop = (sy + ey) / 2 < centerY;
        const lane = useTop ? topLane++ : bottomLane++;
        const busY = useTop ? topBase + lane * BUS_GAP : bottomBase + lane * BUS_GAP;
        const outX = sx + 16 + (link.id % 3) * 5;
        const inX = ex - 16 - (link.id % 3) * 5;
        points = [[sx, sy], [outX, sy], [outX, busY], [inX, busY], [inX, ey], [ex, ey]];
      }
      out.push({
        link,
        d: roundedPath(points),
        color: this.roleOf(from),
        supply,
        hot: false,
        dim: false,
      });
    }
    return out;
  }

  /** 顶部/底部总线桥架。只画实际有跨列线的一侧。 */
  busRails(): Array<{ kind: 'top' | 'bottom'; d: string; x: number; y: number; width: number; count: number }> {
    const graph = this.graph;
    const bounds = this.nodeBounds();
    if (!graph || !bounds) return [];
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const selected = this.selectedId;
    let top = 0;
    let bottom = 0;
    for (const link of graph.links) {
      const from = nodeById(graph, link.from);
      const to = nodeById(graph, link.to);
      if (!from || !to) continue;
      const sx = this.left(from) + CARD_WIDTH;
      const sy = this.outputY(from, link.fromSlot);
      const ex = this.left(to);
      const ey = this.inputY(to, link.toSlot);
      const span = Math.abs(ex - sx);
      const bus = this.busRouting ? Math.abs(ey - sy) >= 2 : span > BUS_SPAN;
      if (!bus) continue;
      const portType = (link.type || to.inputs[link.toSlot]?.type || '').toUpperCase();
      const supply = isSupplyNode(from) || SUPPLY_LINK_TYPES.has(portType);
      const direct = selected != null && (link.from === selected || link.to === selected);
      const visible = !supply || this.showSupplyLinks || direct;
      if (!visible) continue;
      if ((sy + ey) / 2 < centerY) top += 1;
      else bottom += 1;
    }
    const x1 = bounds.minX - 40;
    const x2 = bounds.maxX + 40;
    const rails: Array<{ kind: 'top' | 'bottom'; d: string; x: number; y: number; width: number; count: number }> = [];
    if (top) {
      const y = Math.max(10, bounds.minY - BUS_OFFSET - top * BUS_GAP);
      rails.push({ kind: 'top', d: `M ${x1} ${y} L ${x2} ${y}`, x: x1, y, width: x2 - x1, count: top });
    }
    if (bottom) {
      const y = bounds.maxY + BUS_OFFSET;
      rails.push({ kind: 'bottom', d: `M ${x1} ${y} L ${x2} ${y}`, x: x1, y, width: x2 - x1, count: bottom });
    }
    return rails;
  }

  private nodeBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    const graph = this.graph;
    if (!graph || !graph.nodes.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      minX = Math.min(minX, this.left(node));
      minY = Math.min(minY, this.top(node));
      maxX = Math.max(maxX, this.left(node) + CARD_WIDTH);
      maxY = Math.max(maxY, this.top(node) + cardHeight(node));
    }
    return { minX, minY, maxX, maxY };
  }

  visibleEdges(): EdgeView[] {
    const focus = this.focusId;
    const selected = this.selectedId;
    const out: EdgeView[] = [];
    for (const edge of this.edges()) {
      const selectedDirect = selected != null && (edge.link.from === selected || edge.link.to === selected);
      if (edge.supply && !this.showSupplyLinks && !selectedDirect) continue;
      const hot = focus != null && (edge.link.from === focus || edge.link.to === focus);
      out.push({ ...edge, hot, dim: focus != null && !hot });
    }
    return out;
  }

  toggleSupply(): void {
    this.showSupplyLinks = !this.showSupplyLinks;
  }

  get focusId(): number | null {
    return this.hoverId ?? this.selectedId;
  }

  /**
   * 选中/悬停节点 + 直接上下游。
   *
   * 不做整条链路的传递闭包：在生成图里，输出节点的祖先几乎就是全图，
   * 全量高亮等于没高亮。选到哪一步，就只把这一步的进出线点亮。
   */
  get focusNodes(): Set<number> {
    const id = this.focusId;
    const key = `${id ?? 'none'}|${this.graphVersion}`;
    if (this.focusCache?.key === key) return this.focusCache.set;
    const set = new Set<number>();
    if (id != null && this.graph) {
      set.add(id);
      for (const link of this.graph.links) {
        if (link.from === id) set.add(link.to);
        if (link.to === id) set.add(link.from);
      }
    }
    this.focusCache = { key, set };
    return set;
  }

  tempPath(): string {
    if (!this.graph || !this.linking) return '';
    const from = nodeById(this.graph, this.linking.from);
    if (!from) return '';
    const sx = this.left(from) + CARD_WIDTH;
    const sy = this.outputY(from, this.linking.slot);
    const ex = this.linkPoint[0];
    const ey = this.linkPoint[1];
    const midX = Math.max(sx + 24, (sx + ex) / 2);
    return roundedPath([[sx, sy], [midX, sy], [midX, ey], [ex, ey]]);
  }

  /* ------------------------------------------------------------ 画布交互 */

  onCanvasDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('.node') ||
      target?.closest('.palette') ||
      target?.closest('.status') ||
      target?.closest('.canvas-tools') ||
      target?.closest('.wire-hit')
    ) {
      return;
    }
    if (this.paletteOpen) this.closePalette();
    this.panning = { sx: event.clientX, sy: event.clientY, px: this.pan.x, py: this.pan.y };
    this.selectedId = null;
    this.selectedLink = null;
  }

  onCanvasMove(event: PointerEvent): void {
    if (this.panning) {
      this.pan.x = this.panning.px + (event.clientX - this.panning.sx);
      this.pan.y = this.panning.py + (event.clientY - this.panning.sy);
      return;
    }
    if (this.dragging && this.graph) {
      const moved =
        Math.abs(event.clientX - this.dragging.sx) > 2 ||
        Math.abs(event.clientY - this.dragging.sy) > 2;
      // 流水线布局是算出来的，第一次真的拖动才落到节点坐标上；
      // 只是点一下选中，不该把整份工作流的坐标改掉。
      if (this.mode === 'pipeline' && moved && this.format === 'ui') {
        for (const node of this.graph.nodes) {
          node.pos = [...(this.positions[node.id] ?? node.pos)];
        }
        this.mode = 'free';
      }
      if (this.mode === 'free') {
        const node = nodeById(this.graph, this.dragging.id);
        if (node) {
          node.pos = [
            Math.round(this.dragging.px + (event.clientX - this.dragging.sx) / this.scale),
            Math.round(this.dragging.py + (event.clientY - this.dragging.sy) / this.scale),
          ];
        }
      }
      return;
    }
    if (this.linking) this.linkPoint = this.graphPoint(event);
  }

  onCanvasUp(_event?: PointerEvent): void {
    if (this.dragging) {
      this.dragging = null;
      this.recordNow();
      this.recalcIssues();
    }
    this.panning = null;
    this.linking = null;
  }

  onDocPointerUp(): void {
    // 指针在画布外松开时取消连线/拖拽，避免状态卡住
    if (this.linking) this.linking = null;
    if (this.dragging) {
      this.dragging = null;
      this.recordNow();
      this.recalcIssues();
    }
    this.panning = null;
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect) return;
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const next = Math.min(1.8, Math.max(0.3, this.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
    if (next === this.scale) return;
    this.pan.x = mx - ((mx - this.pan.x) * next) / this.scale;
    this.pan.y = my - ((my - this.pan.y) * next) / this.scale;
    this.scale = next;
  }

  zoomBy(delta: number): void {
    this.scale = Math.min(1.8, Math.max(0.3, Math.round((this.scale + delta) * 100) / 100));
  }

  fitView(): void {
    const graph = this.graph;
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!graph || !graph.nodes.length || !rect || !rect.width) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      minX = Math.min(minX, this.left(node));
      minY = Math.min(minY, this.top(node));
      maxX = Math.max(maxX, this.left(node) + CARD_WIDTH);
      maxY = Math.max(maxY, this.top(node) + cardHeight(node));
    }
    const pad = 90;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    this.scale = Math.min(1.25, Math.max(0.45, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h)));
    this.pan.x = (rect.width - w * this.scale) / 2 - minX * this.scale;
    this.pan.y = (rect.height - h * this.scale) / 2 - minY * this.scale;
  }

  private graphPoint(event: PointerEvent | WheelEvent): [number, number] {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [
      (event.clientX - rect.left - this.pan.x) / this.scale,
      (event.clientY - rect.top - this.pan.y) / this.scale,
    ];
  }

  onNodeDown(node: GraphNode, event: PointerEvent): void {
    event.stopPropagation();
    if (event.button !== 0) return;
    this.selectedId = node.id;
    this.selectedLink = null;
    if (this.inspectTab === 'checks') this.inspectTab = 'node';
    if (this.format === 'api') return;
    this.dragging = {
      id: node.id,
      sx: event.clientX,
      sy: event.clientY,
      px: this.left(node),
      py: this.top(node),
    };
  }

  selectLink(link: GraphLink, event: PointerEvent): void {
    event.stopPropagation();
    this.selectedLink = link.id;
    this.selectedId = null;
    this.inspectTab = 'node';
  }

  onOutputPortDown(node: GraphNode, slot: number, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.linking = { from: node.id, slot };
    this.linkPoint = this.graphPoint(event);
  }

  onInputPortDown(node: GraphNode, input: GraphInput, _index: number, event: PointerEvent): void {
    event.stopPropagation();
    if (input.link == null || !this.graph) return;
    disconnect(this.graph, input.link);
    this.recordNow();
    this.recalcIssues();
  }

  onInputPortUp(nodeId: number, slot: number, event: PointerEvent): void {
    event.stopPropagation();
    const linking = this.linking;
    if (!linking || !this.graph) return;
    const link = connect(this.graph, linking.from, linking.slot, nodeId, slot);
    this.linking = null;
    if (!link) {
      this.flash('端口类型不匹配，换一个输入试试', true);
      return;
    }
    this.selectedId = nodeId;
    this.selectedLink = null;
    this.recordNow();
    this.recalcIssues();
  }

  layoutNow(): void {
    if (!this.graph) return;
    this.refreshPositions();
    if (this.mode === 'free') {
      for (const node of this.graph.nodes) {
        node.pos = [...(this.positions[node.id] ?? node.pos)];
      }
      this.recordNow();
    }
  }

  /* ------------------------------------------------------------ 选中 / 编辑 */

  renameNode(node: GraphNode, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (!value || value === node.title) return;
    node.title = value;
    this.recordNow();
    this.recalcIssues();
  }

  setWidget(node: GraphNode, widget: GraphWidget, event: Event): void {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (widget.kind === 'number') {
      let value = Number(el.value);
      if (!Number.isFinite(value)) value = 0;
      if (widget.min !== undefined) value = Math.max(widget.min, value);
      if (widget.max !== undefined) value = Math.min(widget.max, value);
      widget.value = value;
    } else if (widget.kind === 'toggle') {
      widget.value = (el as HTMLInputElement).checked;
    } else if (widget.kind === 'raw') {
      const text = el.value;
      try {
        widget.value = JSON.parse(text);
      } catch {
        widget.value = text;
      }
    } else {
      widget.value = el.value;
    }
    this.markDirty();
    this.queueHistory();
  }

  breakInput(input: GraphInput): void {
    if (!this.graph || input.link == null) return;
    disconnect(this.graph, input.link);
    this.recordNow();
    this.recalcIssues();
  }

  deleteSelected(): void {
    if (!this.graph) return;
    if (this.selectedLink != null) {
      disconnect(this.graph, this.selectedLink);
      this.selectedLink = null;
      this.recordNow();
      this.recalcIssues();
      return;
    }
    if (this.selectedId == null) return;
    removeNode(this.graph, this.selectedId);
    this.selectedId = null;
    this.recordNow();
    this.recalcIssues();
  }

  centerSelected(): void {
    const node = this.selNode;
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!node || !rect) return;
    this.pan.x = rect.width / 2 - (this.left(node) + CARD_WIDTH / 2) * this.scale;
    this.pan.y = rect.height / 2 - (this.top(node) + cardHeight(node) / 2) * this.scale;
  }

  focusNode(id?: number): void {
    if (id == null || !this.graph) return;
    this.selectedId = id;
    this.selectedLink = null;
    this.inspectTab = 'node';
    this.centerSelected();
  }

  /* ------------------------------------------------------------ 节点库 */

  openPalette(): void {
    if (!this.graph) return;
    this.paletteOpen = true;
    this.paletteQuery = '';
    this.filterPalette();
    setTimeout(() => this.paletteInput?.nativeElement.focus(), 0);
  }

  closePalette(): void {
    this.paletteOpen = false;
  }

  refreshDefs(): void {
    this.loadObjectInfo(true);
  }

  filterPalette(): void {
    const query = this.paletteQuery.trim().toLowerCase();
    const list = Object.values(this.defs).filter((def) => {
      const category = def.category.toLowerCase();
      if (category === 'api node' || category === 'group') return false;
      if (['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode'].includes(def.type)) return false;
      if (!query) return true;
      return `${def.title} ${def.type} ${def.category}`.toLowerCase().includes(query);
    });
    list.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    this.paletteList = list.slice(0, 80);
  }

  addFirst(): void {
    const first = this.paletteList[0];
    if (first) this.addNode(first);
  }

  addNode(def: NodeDef): void {
    if (!this.graph) return;
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    const at = rect
      ? this.graphPoint({
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        } as PointerEvent)
      : [80, 80] as [number, number];
    const node = createNode(this.graph, def, [at[0] - CARD_WIDTH / 2, at[1] - 80]);
    this.selectedId = node.id;
    this.selectedLink = null;
    this.inspectTab = 'node';
    this.closePalette();
    this.recordNow();
    this.refreshPositions();
    this.recalcIssues();
    if (this.mode === 'free') this.centerSelected();
    this.flash(`已添加「${def.title}」`);
  }

  /* ------------------------------------------------------------ JSON */

  private syncJsonText(): void {
    if (!this.file) return;
    if (!this.graph) {
      this.jsonText = this.file.raw;
      return;
    }
    const data =
      this.view === 'api' && this.format === 'ui'
        ? this.apiPreview(this.graph)
        : serializeWorkflow(this.graph);
    this.jsonText = JSON.stringify(data, null, 2);
  }

  private apiPreview(graph: WorkflowGraph): Record<string, unknown> {
    return serializeWorkflow({
      ...graph,
      format: 'api',
      raw: {},
      nodes: graph.nodes.map((node) => ({ ...node, raw: {} })),
    });
  }

  onJsonInput(): void {
    this.jsonDirty = true;
    this.dirty = true;
    this.jsonError = '';
  }

  applyJson(): boolean {
    try {
      const parsed: unknown = JSON.parse(this.jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('顶层必须是 JSON 对象');
      }
      const data = parsed as Record<string, unknown>;
      const detected = detectFormat(data);
      let fmt: 'ui' | 'api';
      if (this.format === 'broken') {
        if (detected === 'broken') throw new Error('认不出工作流结构：UI 格式需要 nodes 数组，API 格式需要 class_type');
        fmt = detected;
      } else {
        fmt = this.view === 'api' && this.format === 'api' ? 'api' : 'ui';
        // 把 API JSON 粘进 UI 文件（或反过来）不能当成空工作流保存
        if (detected !== fmt) {
          throw new Error(
            detected === 'broken'
              ? '认不出工作流结构，未应用'
              : `这段内容是 ${detected.toUpperCase()} 格式，不能直接写进 ${fmt.toUpperCase()} 文件`,
          );
        }
      }
      const graph = parseWorkflow(data, fmt, this.defs);
      this.graph = graph;
      this.format = fmt;
      this.selectedId = null;
      this.selectedLink = null;
      this.mode = 'pipeline';
      this.refreshPositions();
      this.recalcIssues();
      this.jsonError = '';
      this.jsonDirty = false;
      this.errorText = '';
      this.recordNow();
      this.dirty = this.snapshot() !== this.savedSnapshot;
      this.flash('已应用到画布');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'JSON 解析失败';
      this.jsonError = withLine(this.jsonText, message);
      return false;
    }
  }

  resetJson(): void {
    this.jsonDirty = false;
    this.jsonError = '';
    this.syncJsonText();
    this.dirty = this.snapshot() !== this.savedSnapshot;
  }

  copyJson(): void {
    navigator.clipboard?.writeText(this.jsonText).then(
      () => this.flash('已复制'),
      () => this.flash('复制失败', true),
    );
  }

  /* ------------------------------------------------------------ 保存 */

  save(): void {
    if (this.saving || !this.file) return;
    // 输入框里的修改是 change（失焦）才提交的；Ctrl+S 不该丢掉最后几个字
    const active = document.activeElement as HTMLElement | null;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) active.blur();
    if ((this.jsonDirty || !this.graph) && this.jsonEditable) {
      if (!this.applyJson()) {
        // 错误标在文本视图里；停在画布上会让人以为保存按钮坏了
        if (this.format === 'api') this.view = 'api';
        else this.view = 'ui';
        this.flash(this.jsonError ? `JSON 有错误，未保存：${this.jsonError.slice(0, 80)}` : 'JSON 有错误，未保存', true);
        return;
      }
    }
    if (!this.graph) return;
    if (this.issueErrors) {
      this.flash('还有结构错误，先修正再保存', true);
      return;
    }
    const data = serializeWorkflow(this.graph);
    this.saving = true;
    this.errorText = '';
    this.api.saveWorkflowFile(this.file.path, data, this.file.mtime).subscribe({
      next: (res) => {
        this.saving = false;
        if (this.file) {
          this.file.mtime = res.mtime;
          this.file.size = res.size;
          this.file.format = res.format;
        }
        this.format = res.format;
        this.dirty = false;
        this.jsonDirty = false;
        this.savedSnapshot = this.snapshot();
        this.jsonError = '';
        if (this.view !== 'canvas') this.syncJsonText();
        const backupName = res.backup.split(/[\\/]/).pop() || res.backup;
        this.flash(`已保存 · 旧版本备份为 ${backupName}`);
      },
      error: (err) => {
        this.saving = false;
        this.errorText = errMsg(err, '保存失败');
      },
    });
  }

  /* ------------------------------------------------------------ 历史 */

  private snapshot(): string {
    if (!this.graph) return this.file?.raw ?? '';
    return JSON.stringify({ format: this.graph.format, data: serializeWorkflow(this.graph) });
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private queueHistory(): void {
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => {
      this.historyTimer = null;
      this.pushHistory();
    }, 350);
  }

  private recordNow(): void {
    this.graphVersion += 1;
    if (this.historyTimer) {
      clearTimeout(this.historyTimer);
      this.historyTimer = null;
    }
    this.pushHistory();
    this.dirty = this.snapshot() !== this.savedSnapshot;
  }

  private pushHistory(): void {
    if (!this.graph) return;
    const snap = this.snapshot();
    if (this.history[this.histIndex] === snap) return;
    this.history = this.history.slice(0, this.histIndex + 1);
    this.history.push(snap);
    while (this.history.length > 60) this.history.shift();
    this.histIndex = this.history.length - 1;
  }

  undo(): void {
    if (this.historyTimer) {
      clearTimeout(this.historyTimer);
      this.historyTimer = null;
      this.pushHistory();
    }
    if (this.histIndex <= 0) return;
    this.histIndex -= 1;
    this.restoreSnapshot(this.history[this.histIndex]);
  }

  redo(): void {
    if (this.histIndex >= this.history.length - 1) return;
    this.histIndex += 1;
    this.restoreSnapshot(this.history[this.histIndex]);
  }

  private restoreSnapshot(snapshot: string): void {
    try {
      const parsed = JSON.parse(snapshot) as { format: 'ui' | 'api'; data: Record<string, unknown> };
      const graph = parseWorkflow(parsed.data, parsed.format, this.defs);
      this.graph = graph;
      this.format = parsed.format;
      this.mode = parsed.format === 'api' ? 'pipeline' : this.mode;
      this.selectedId = null;
      this.selectedLink = null;
      this.refreshPositions();
      this.recalcIssues();
      this.dirty = this.snapshot() !== this.savedSnapshot;
      if (this.view !== 'canvas' && !this.jsonDirty) this.syncJsonText();
    } catch {
      this.flash('这一步无法恢复', true);
    }
  }

  /* ------------------------------------------------------------ 键盘 */

  onKey(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save();
      return;
    }
    const target = event.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (typing) return;

    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.key === 'Escape') {
      if (this.paletteOpen) this.closePalette();
      else if (this.linking) this.linking = null;
      else {
        this.selectedId = null;
        this.selectedLink = null;
      }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.view === 'canvas') {
      event.preventDefault();
      this.deleteSelected();
      return;
    }
    if (event.key.toLowerCase() === 'n' && this.view === 'canvas') {
      event.preventDefault();
      this.openPalette();
    }
  }

  /* ------------------------------------------------------------ 杂项 */

  back(): void {
    if (this.dirty && !window.confirm('有未保存的修改，确定离开？')) return;
    this.router.navigate(['/workflows']);
  }

  str(value: unknown): string {
    if (value == null) return '';
    return typeof value === 'string' ? value : String(value);
  }

  rawText(widget: GraphWidget): string {
    try {
      return JSON.stringify(widget.value);
    } catch {
      return String(widget.value);
    }
  }

  widgetText(widget: GraphWidget): string {
    const text = this.str(widget.value);
    return text.length > 80 ? `${text.slice(0, 78)}…` : text;
  }

  sizeText(size: number): string {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
  }

  private flash(message: string, isError = false): void {
    this.notice = message;
    this.noticeErr = isError;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.notice = ''), 3600);
  }
}

/** 认形态：UI 有 nodes 数组（或 workflow 包一层），API 是 class_type 扁平表。 */
function detectFormat(data: Record<string, unknown>): 'ui' | 'api' | 'broken' {
  if (Array.isArray(data['nodes'])) return 'ui';
  const inner = data['workflow'];
  if (inner && typeof inner === 'object' && Array.isArray((inner as Record<string, unknown>)['nodes'])) return 'ui';
  const values = Object.values(data);
  if (values.length && values.every((v) => v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>)['class_type'] === 'string')) {
    return 'api';
  }
  return 'broken';
}

/**
 * 正交折线 + 圆角。
 *
 * 连线只走水平/垂直线段，拐角用二次贝塞尔切一个小圆角；不做任何自由曲线。
 * 输入点必须是轴对齐的折点（x 相同或 y 相同）。
 */
function roundedPath(points: Array<[number, number]>, radius = 12): string {
  const clean: Array<[number, number]> = [];
  for (const point of points) {
    const prev = clean[clean.length - 1];
    if (prev && Math.abs(prev[0] - point[0]) < 0.1 && Math.abs(prev[1] - point[1]) < 0.1) continue;
    clean.push(point);
  }
  if (clean.length < 2) return '';
  const f = (value: number): string => String(Math.round(value * 10) / 10);
  let d = `M ${f(clean[0][0])} ${f(clean[0][1])}`;
  for (let i = 1; i < clean.length - 1; i += 1) {
    const prev = clean[i - 1];
    const cur = clean[i];
    const next = clean[i + 1];
    const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    if (inLen < 0.1 || outLen < 0.1) continue;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inX = (cur[0] - prev[0]) / inLen;
    const inY = (cur[1] - prev[1]) / inLen;
    const outX = (next[0] - cur[0]) / outLen;
    const outY = (next[1] - cur[1]) / outLen;
    const startX = cur[0] - inX * r;
    const startY = cur[1] - inY * r;
    const endX = cur[0] + outX * r;
    const endY = cur[1] + outY * r;
    d += ` L ${f(startX)} ${f(startY)} Q ${f(cur[0])} ${f(cur[1])} ${f(endX)} ${f(endY)}`;
  }
  const last = clean[clean.length - 1];
  d += ` L ${f(last[0])} ${f(last[1])}`;
  return d;
}

/** JSON.parse 的位置换成行号；错误信息本来就带 position，别让用户自己数。 */
function withLine(text: string, message: string): string {
  const match = /position\s+(\d+)/i.exec(message);
  if (!match) return message;
  const pos = Math.min(Number(match[1]), text.length);
  const line = text.slice(0, pos).split('\n').length;
  const column = pos - text.lastIndexOf('\n', pos - 1);
  return `${message}（第 ${line} 行，第 ${column} 列）`;
}
