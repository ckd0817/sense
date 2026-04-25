# Sense

AI 驱动的日常活动记录与追踪 App。用自然语言描述你做的事，AI 自动结构化为时间线。

## 功能

- **对话式记录** — 告诉 AI 你在做什么，自动提取活动、时间、分类、情绪等信息
- **活动时间线** — 当日活动以时间轴卡片展示，支持编辑和左滑删除
- **待办管理** — AI 识别待办事项，支持一次性任务和每日习惯，带定时提醒
- **周视图** — 按周查看活动分布，横向滚动
- **记录提醒** — 上次记录后 N 小时自动提醒
- **数据管理** — JSON 格式导入导出

## 技术栈

- React Native + Expo SDK 55
- TypeScript
- expo-sqlite（本地数据库）
- expo-notifications（本地通知）
- OpenAI-compatible API（流式 SSE + Function Calling）

## 项目结构

```
sense/
  app/
    _layout.tsx            # 根布局
    (tabs)/
      _layout.tsx          # 底部导航（今天 / 记录 / 设置）
      index.tsx            # 今日时间线
      record.tsx           # 对话记录页
      settings.tsx         # 设置页
      history.tsx          # 周视图
  components/
    ActivityBlock.tsx      # 活动卡片
    EditRecordModal.tsx    # 编辑弹窗
    TodoSection.tsx        # 待办列表
    WeekSchedule.tsx       # 周视图组件
  lib/
    agent.ts               # AI Agent（工具定义、SSE 流式调用）
    ai.ts                  # API 连接测试
    db.ts                  # SQLite CRUD + 设置存取
    notifications.ts       # 通知调度
    time.ts                # 时间工具（toLocalISO、snapTime）
  constants/
    theme.ts               # 颜色、间距、字号等设计 token
```

## 开发

```bash
npm install
npx expo run:android
```

需要 Development Build（非 Expo Go），因为使用了 `expo-notifications` 原生模块。

## AI 配置

在设置页填写：

- **API URL** — 兼容 OpenAI 格式的接口地址（如 `https://api.openai.com/v1`）
- **API Key** — 密钥
- **Model** — 模型名（如 `gpt-4o-mini`）

支持任何 OpenAI 兼容的 API 服务。
