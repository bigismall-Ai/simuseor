import { NgModule } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Material 统一入口。
 *
 * 页面只 import `UiMaterialModule` / `MatDialog` / `MatSnackBar`，不要直接
 * import `@angular/material/*`。
 *
 * 为什么包一层 NgModule 而不是直接 re-export：
 * Material 22.3 的类型声明集中在 `types/` 平铺目录，Angular 22.3 的编译器
 * 在遇到本地 barrel re-export 时会生成指向 `@angular/material/types/xxx`
 * 的运行时 import，esbuild 无法解析。包成 NgModule 后，Material 符号在
 * 本文件内按原始子路径解析，消费者只看到本地模块。
 */
@NgModule({
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  exports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
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
