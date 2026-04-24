// Apple-inspired design tokens for React Native

export const Colors = {
  // Surfaces
  bg: '#F5F5F7',           // Pale Apple Gray — main background
  surface: '#FFFFFF',       // Pure White — cards, inputs
  surfaceAlt: '#F5F5F7',   // Filled backgrounds inside cards

  // Text
  text: '#1D1D1F',          // Near-Black Ink — primary text
  subtext: '#6E6E73',       // Secondary Neutral Gray
  hint: '#86868B',          // Mid Border Gray — placeholder, hint

  // Accent
  primary: '#0071E3',       // Apple Action Blue
  primaryDark: '#0066CC',   // Body Link Blue

  // Borders & dividers
  divider: '#D2D2D7',       // Soft Border Gray
  border: '#86868B',        // Mid Border Gray — inputs

  // Semantic
  success: '#34A853',

  // Timeline
  line: '#D2D2D7',
  dot: '#1D1D1F',
};

export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
};

export const R = {
  sm: 8,    // small controls
  md: 12,   // inputs, chips
  lg: 16,   // cards
  xl: 28,   // capsules, large modules
};

export const F = {
  xs: 12,   // micro UI, legal
  sm: 14,   // control labels
  md: 17,   // body primary
  lg: 21,   // link/action heading
  xl: 24,   // utility heading
  xxl: 28,  // section display
  hero: 40, // hero display
};

export const Categories: Record<string, string> = {
  '饮食': '🍜',
  '学习': '📖',
  '工作': '⚒️',
  '运动': '🦵',
  '社交': '🕯️',
  '娱乐': '🎸',
  '休息': '🌙',
  '交通': '🚶',
  '家务': '🧹',
  '购物': '🛍️',
  '个人护理': '💧',
  '其他': '·',
};

export const CategoryColors: Record<string, string> = {
  '饮食': '#FFF3E0',
  '学习': '#E3F2FD',
  '工作': '#F3E5F5',
  '运动': '#E8F5E9',
  '社交': '#FCE4EC',
  '娱乐': '#FFF8E1',
  '休息': '#EDE7F6',
  '交通': '#E0F2F1',
  '家务': '#EFEBE9',
  '购物': '#FBE9E7',
  '个人护理': '#E1F5FE',
  '其他': '#F5F5F5',
};

export const HOUR_HEIGHT = 60; // px per hour in timeline

export const REMINDER_OPTIONS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '2 小时', value: 120 },
  { label: '3 小时', value: 180 },
];

export const GRANULARITY_OPTIONS = [
  { label: '15分钟', value: 15 },
  { label: '30分钟', value: 30 },
  { label: '1小时', value: 60 },
];
