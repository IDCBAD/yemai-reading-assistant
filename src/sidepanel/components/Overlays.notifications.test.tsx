import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMPTY_WORKOS_CONNECTION_SETTINGS } from '../../services/workosConnection';
import { SettingsDrawer } from './Overlays';

const props: ComponentProps<typeof SettingsDrawer> = {
  open: true,
  settings: EMPTY_WORKOS_CONNECTION_SETTINGS,
  connectionIssue: null,
  bubbleEnabled: true,
  systemNotificationsEnabled: true,
  notificationPermission: 'granted',
  storageUsage: null,
  storageUsageIssue: null,
  backupStatus: null,
  backupStatusIssue: null,
  qaDirectoryState: { kind: 'unconfigured' },
  onSaveConnection: async () => undefined,
  onTestConnection: async () => undefined,
  onImportWorkosCredentials: async () => EMPTY_WORKOS_CONNECTION_SETTINGS.internalV2,
  onRemoveCredentials: async () => undefined,
  onBubbleEnabledChange: () => undefined,
  onSystemNotificationsEnabledChange: () => undefined,
  onExportBackup: async () => { throw new Error('Not used in this test'); },
  onInspectBackup: async () => { throw new Error('Not used in this test'); },
  onImportBackup: async () => { throw new Error('Not used in this test'); },
  onClose: () => undefined,
  onClearHistory: () => undefined,
  onChooseQaDirectory: async () => undefined,
  onReconnectQaDirectory: async () => undefined,
  onDisconnectQaDirectory: async () => undefined,
};

describe('SettingsDrawer task notifications', () => {
  it('names the enabled system notification switch and explains the badge fallback', () => {
    const html = renderToStaticMarkup(<SettingsDrawer {...props} />);
    expect(html).toContain('role="switch" aria-label="系统通知" aria-checked="true"');
    expect(html).toContain('任务完成、失败或需要确认时提醒。关闭后仍保留角标。');
    expect(html).not.toContain('浏览器已关闭通知');
  });

  it('keeps the preference visible when the browser denies permission and reports delivery issues', () => {
    const html = renderToStaticMarkup(<SettingsDrawer
      {...props}
      systemNotificationsEnabled={false}
      notificationPermission="denied"
      notificationIssue="本次通知未能显示。"
    />);
    expect(html).toContain('role="switch" aria-label="系统通知" aria-checked="false"');
    expect(html).toContain('role="status">浏览器已关闭通知，仍可通过角标查看。');
    expect(html).toContain('role="status">本次通知未能显示。');
  });
});
