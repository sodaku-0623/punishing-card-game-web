'use client';

import React from 'react';
import { Button, Dialog } from '@/components/ui';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  {
    key: 'Space / Enter',
    action: '时点让渡 (Pass) / 结束当前阶段 / 放弃阻挡',
    desc: '高频流转核心快捷键，无需移动鼠标点击右侧按钮',
  },
  {
    key: 'Esc / 右键',
    action: '全局取消选中 / 撤回目标指定 / 关闭菜单与弹窗',
    desc: '右键或 Esc 即时撤销任何待决动作',
  },
  {
    key: '1 ~ 7',
    action: '快速选择手牌中的第 1 至第 7 张卡牌',
    desc: '快速出牌与键盘流操作',
  },
  {
    key: 'Q ~ Y',
    action: '快速选择我方信号球序列 (第 1 至第 6 颗)',
    desc: '键盘极速选球，无需频繁点击',
  },
  {
    key: 'X',
    action: '一键发动当前选中的三消 / 连消技能',
    desc: '选好三颗信号球后按下直接完成消除抽牌',
  },
  {
    key: '悬停 (Hover)',
    action: '卡牌旁实时弹出战术详情，移开即自动隐藏',
    desc: '零阻碍预览卡牌全部效果与实时数值',
  },
  {
    key: 'Tab',
    action: '折叠 / 展开右侧战术终端 HUD',
    desc: '一键释放屏幕空间，进入全宽战场视野',
  },
  {
    key: 'F',
    action: '高清卡面全屏大图检视',
    desc: '快速放大当前检视或选中的卡牌立绘与详情',
  },
  {
    key: '鼠标双击',
    action: '快速执行默认操作 (手牌双击出场 / 角色双击攻击对手)',
    desc: '减少点击步骤，高频操作一触即发',
  },
  {
    key: '战术指示线',
    action: '选中角色或拖拽拉出弹道箭头指向目标',
    desc: '直观锁定敌方角色卡位或敌方指挥官',
  },
  {
    key: 'M',
    action: '一键静音 / 恢复作战音效',
    desc: '随时切换对战音效状态',
  },
  {
    key: 'H',
    action: '官方规则手册 / 新手指南',
    desc: '随时查阅对战规则、区域详解与关键词图鉴',
  },
  {
    key: '?',
    action: '打开 / 关闭本快捷键帮助指南',
    desc: '随时查阅作战终端快捷键',
  },
];

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="桌面级战术快捷键指南"
      subtitle="KEYBOARD SHORTCUTS"
      size="lg"
      blurBackdrop
      footer={
        <Button variant="primary" size="sm" onClick={onClose}>
          我知道了 (Esc)
        </Button>
      }
    >
      <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1 select-none">
        {SHORTCUTS.map((sc, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 p-2.5 border border-line bg-ink-950 hover:border-teal-400/50 transition-colors duration-fast"
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-semibold text-fg text-caption">{sc.action}</span>
              <span className="text-hud text-fg-muted">{sc.desc}</span>
            </div>

            <kbd className="px-2.5 py-1 bg-ink-850 border border-teal-400/40 text-teal-400 font-num font-semibold text-hud flex-shrink-0">
              {sc.key}
            </kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
};
