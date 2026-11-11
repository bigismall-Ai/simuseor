import Aura from '@primeng/themes/aura';
import { definePreset } from '@primeng/themes';

/**
 * 对照实验用的 PrimeNG preset。
 *
 * 只改四处，就能把 Aura 的默认观感压向「安静的工具」而不是「企业后台」：
 *  1. 主色换成项目现有的 indigo，而不是 Aura 默认的 emerald
 *  2. surface 用 zinc（中性、无蓝调），而不是 Aura 默认的 slate 系
 *  3. 圆角整体上调一档（md 8 → 9、lg 12），接近现有样式
 *  4. focus ring 收敛成 2px solid primary
 *
 * 这四个决定不做，换库只是从「平淡」变成「整齐的平淡」。
 */
export const LabPreset = definePreset(Aura, {
  primitive: {
    borderRadius: {
      none: '0',
      xs: '3px',
      sm: '6px',
      md: '10px',
      lg: '12px',
      xl: '16px',
    },
  },
  semantic: {
    primary: {
      50: '#eef2ff',
      100: '#e0e7ff',
      200: '#c7d2fe',
      300: '#a5b4fc',
      400: '#818cf8',
      500: '#6366f1',
      600: '#4f46e5',
      700: '#4338ca',
      800: '#3730a3',
      900: '#312e81',
      950: '#1e1b4b',
    },
    focusRing: {
      width: '2px',
      style: 'solid',
      color: '{primary.color}',
      offset: '2px',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
        primary: {
          color: '{primary.600}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
      },
      dark: {
        primary: {
          color: '{primary.400}',
          contrastColor: '{primary.950}',
          hoverColor: '{primary.300}',
          activeColor: '{primary.200}',
        },
      },
    },
  },
  /**
   * 组件级微调。PrimeNG 19 的 preset 里 components 段是「按组件覆盖 token」，
   * 名字写错不会报错、只会静默失效，所以每加一条都要用截图或计算样式确认真的生效了。
   * 下面两条是实测有效的；selectbutton.root.padding 无效（被库内结构样式覆盖），已删。
   */
  components: {
    togglebutton: {
      root: { padding: '0.4rem 0.7rem' },
    },
    // 弹层圆角比卡片大一号（卡片 12 → 弹层 16），否则大面板看起来比卡片还轻
    dialog: {
      root: { borderRadius: '16px' },
    },
  },
});
