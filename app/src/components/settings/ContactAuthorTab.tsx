import { SettingsPageHeader } from '../../ui';
import { ContactCards } from '../Contact';

export function ContactAuthorTab() {
  return (
    <div>
      <SettingsPageHeader
        title="联系作者"
        description="扫码加入灵机剪影微信群，交流使用体验、功能建议与 AI 视频创作工作流；也可以通过作者微信直接联系我。"
      />
      <div className="pt-2">
        <ContactCards />
      </div>
    </div>
  );
}
