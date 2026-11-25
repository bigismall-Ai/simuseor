import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBarModule } from '@angular/material/snack-bar';

/**
 * Material 统一入口。
 *
 * 页面只 import `UiMaterialModule` / `MatDialog` / `MatSnackBar`，不要直接
 * import `@angular/material/*`。
 *
 * 为什么包一层 NgModule 而不是直接 re-export：
 * Material 22.3 的类型声明集中在 `types/` 平铺目录，Angular 22.3 的编译器
 * 在遇到本地 barrel re-export 时会生成指向 `@angular/material/types/xxx` 的
 * 运行时 import，esbuild 无法解析。包成 NgModule 后，Material 符号在本文件内
 * 按原始子路径解析，消费者只看到本地模块。
 *
 * 【只留真正在用的模块】
 * 这里曾经挂了 18 个模块，但 `mat-tabs` / `mat-select` / `mat-checkbox` /
 * `mat-chip` / `mat-menu` / `mat-progress*` / `mat-slide-toggle` /
 * `mat-button-toggle` / `mat-autocomplete` / `matTooltip` 在整个 `src/app`
 * 里出现 0 次——对应能力由 `src/app/ui/*` 自有组件承担。NgModule 的 imports
 * 会把模块代码真正拉进包，所以未使用的模块不是「留着备用」，是纯负担。
 *
 * 保留清单（每一项都有实际调用点）：
 *   MatIcon       32 处 `<mat-icon>`（自有 SVG 图标）
 *   MatButton     `svg/` 工作台的 4 个 `matButton`
 *   MatDialog     服务注入（3 个页面）
 *   MatSnackBar   服务注入
 *   MatFormField + MatInput   `/vis/inputs` 的 Material 对照样张
 *   MatRadio      `/vis/inputs` 的单选样张
 *
 * 新增 Material 模块前先确认：自有组件确实做不了，且调用点已经存在。
 */
@NgModule({
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    MatSnackBarModule,
  ],
  exports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    MatSnackBarModule,
  ],
})
export class UiMaterialModule {}

/** 只需要 MatIcon 的场景（例如外壳导航），避免把整套 Material 拉进初始包。 */
@NgModule({
  imports: [MatIconModule],
  exports: [MatIconModule],
})
export class UiIconModule {}

// 服务是普通类，可以安全 re-export。
export { MatDialog } from '@angular/material/dialog';
export { MatSnackBar } from '@angular/material/snack-bar';
