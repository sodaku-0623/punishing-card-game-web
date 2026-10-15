import { describe, it, expect } from 'vitest';
import { getTestPageHtml } from '../src/test-page.js';

describe('Cloudflare Connectivity Test Page (Phase 1 静态测速终端)', () => {
  it('应生成包含完整指标展示与操作面板的 HTML 结构', () => {
    const html = getTestPageHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('《战双帕弥什》Cloudflare 连通性测试终端');

    // 必须包含核心中位数 P50 与高位波动 P95 统计指标元素
    expect(html).toContain('id="rttP50"');
    expect(html).toContain('id="rttP95"');
    expect(html).toContain('id="rttCurrent"');
    expect(html).toContain('id="rttMin"');
    expect(html).toContain('id="rttMax"');
    expect(html).toContain('id="lossRate"');
    expect(html).toContain('id="disconnectCount"');

    // 必须包含边缘节点嗅探与一键复制功能
    expect(html).toContain('id="infoColo"');
    expect(html).toContain('id="infoOrg"');
    expect(html).toContain('id="copyBtn"');
    expect(html).toContain('id="latencyChart"');
  });

  it('静态页面内不得包含任何外部第三方 CDN 脚本与外链字体（保证国内网络秒开）', () => {
    const html = getTestPageHtml();
    expect(html).not.toContain('cdnjs.cloudflare.com');
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toContain('jsdelivr.net');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });
});
