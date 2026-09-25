import { SettingsPageHeader } from '../../ui';
import { DonateCards } from '../Donate';

export function SupportAuthorTab() {
  return (
    <div>
      <SettingsPageHeader
        title="支持作者"
        description="灵机剪影是免费开源项目。如果它帮你节省了时间，欢迎扫码请作者喝杯咖啡 ☕，这会是持续维护的最大动力。"
      />
      <div className="pt-2">
        <DonateCards />
      </div>
    </div>
  );
}
