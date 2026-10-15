'use client';

import React from 'react';
import { X, Keyboard, Command } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const shortcuts = [
    {
      key: 'Space / Enter',
      action: '时点让渡 (Pass) / 结束当前阶段 / 放弃阻挡',
      desc: '高频流转核心快捷键，无需用鼠标移动到右侧点击按钮',
    },
    {
      key: 'Esc / 鼠标右键',
      action: '全局取消选中 / 撤回目标指定 / 关闭菜单与弹窗',
      desc: '对齐 YGOPro 竞技对战本能操作，右键即时撤销任何待决动作',
    },
    {
      key: '数字键 1 ~ 7',
      action: '快速选择手牌中的第 1 至第 7 张卡牌',
      desc: '快速出牌与盲打操作',
    },
    {
      key: '按键 Q ~ Y',
      action: '快速选择我方信号球序列 (第 1 至第 6 颗)',
      desc: '无需频繁移动鼠标点击，键盘流极速选球',
    },
    {
      key: '按键 X',
      action: '一键发动当前选中的三消 / 连消技能',
      desc: '选好三颗信号球后按下直接完成消除推演',
    },
    {
      key: '鼠标悬停 (Hover)',
      action: '卡牌旁实时弹出小窗全息详情，移开即自动隐藏',
      desc: '零阻碍预览，移到卡牌上即在旁边小窗显示全部效果与数值',
    },
    {
      key: 'Tab',
      action: '折叠 / 展开右侧战术终端 HUD',
      desc: '一键释放屏幕空间，尽享 100% 全宽沉浸战场',
    },
    {
      key: 'F 键',
      action: '超清卡面全屏大图检视',
      desc: '快速放大当前检视或选中的卡牌与背景故事',
    },
    {
      key: '鼠标双击',
      action: '快速执行默认操作 (手牌双击出场 / 角色双击攻击对手)',
      desc: '减少点击步骤，高频操作一触即发',
    },
    {
      key: '全息战术指示线',
      action: '选中角色或拖拽拉出激光箭头指向目标',
      desc: '直观锁定敌方角色卡位或敌方指挥官领袖',
    },
    {
      key: 'M 键',
      action: '一键静音 / 恢复作战音效',
      desc: '随时切换对战音效状态',
    },
    {
      key: 'H 键',
      action: '官方规则手册 / 新手指南',
      desc: '随时查阅对战规则、区域详解、卡牌构筑与能力关键词图鉴',
    },
    {
      key: '?',
      action: '打开 / 关闭本快捷键帮助指南',
      desc: '随时查阅作战终端快捷键',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="max-w-xl w-full rounded-2xl border border-terminalCyan/70 bg-neutral-950/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.9)] font-mono text-xs text-neutral-200 relative select-none">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-terminalBorder pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-terminalCyan" />
            <h3 className="text-base font-bold text-white tracking-wider">
              桌面级战术快捷键指南 • SHORTCUTS
            </h3>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg border border-neutral-700 text-neutral-400 hover:text-white hover:border-terminalCyan/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 快捷键列表 */}
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {shortcuts.map((sc, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2.5 rounded-xl border border-terminalBorder/60 bg-surface/60 hover:border-terminalCyan/50 transition-colors"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-white text-xs">{sc.action}</span>
                <span className="text-[11px] text-neutral-400">{sc.desc}</span>
              </div>

              <kbd className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-terminalCyan/40 text-terminalCyan font-mono font-bold text-xs shadow-sm flex-shrink-0 ml-3">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        {/* 底部按钮 */}
        <div className="mt-5 pt-3 border-t border-terminalBorder/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs shadow-md transition-transform hover:scale-105"
          >
            我知道了 (Enter / Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
