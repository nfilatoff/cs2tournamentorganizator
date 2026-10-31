import type { Me } from '../api';
import { useI18n } from '../i18n';

export function Home({ me }: { me: Me }) {
  const { t } = useI18n();
  return (
    <div className="card">
      <h1>{t('app.brand')}</h1>
      {me.kind === null && <p className="muted">{t('home.guest')}</p>}
      {me.kind === 'player' && <p>{t('home.player', { name: me.name })}</p>}
      {me.kind === 'admin' && <p>{t('home.admin')}</p>}
    </div>
  );
}
